"""
Sheet V1 — in-memory undo/redo buffers (server process lifetime).

Never persisted. Resets on server restart / page reload.
"""

import json
import sqlite3
from datetime import datetime, timezone
from fastapi import HTTPException
from dashboard.project_db import audit, get_current_revision
from dashboard.utils import append_log as _append_log

MAX_STACK = 50

_undo_stacks: dict[int, list] = {}
_redo_stacks: dict[int, list] = {}


# ── Public: called by service functions on new user edits ──────────────────

def push_undo(tool_id: int, entry: dict) -> None:
    """Record a reversible operation. Clears redo (any new edit kills redo chain)."""
    stack = _undo_stacks.setdefault(tool_id, [])
    stack.append(entry)
    if len(stack) > MAX_STACK:
        stack.pop(0)
    _redo_stacks[tool_id] = []


def get_stack_sizes(tool_id: int) -> dict:
    return {
        "can_undo": bool(_undo_stacks.get(tool_id)),
        "can_redo": bool(_redo_stacks.get(tool_id)),
    }


# ── Internal stack helpers ──────────────────────────────────────────────────

def _pop_undo(tool_id: int):
    s = _undo_stacks.get(tool_id)
    return s.pop() if s else None


def _pop_redo(tool_id: int):
    s = _redo_stacks.get(tool_id)
    return s.pop() if s else None


def _push_redo(tool_id: int, entry: dict) -> None:
    s = _redo_stacks.setdefault(tool_id, [])
    s.append(entry)
    if len(s) > MAX_STACK:
        s.pop(0)


def _push_undo_internal(tool_id: int, entry: dict) -> None:
    """Push to undo without clearing redo — used inside do_redo only."""
    s = _undo_stacks.setdefault(tool_id, [])
    s.append(entry)
    if len(s) > MAX_STACK:
        s.pop(0)


# ── DB helpers (bypass service functions to avoid re-pushing undo) ──────────

def _apply_cell(conn, tool_slug, row_id, col_slug, value, rev,
                row_tag, old_for_audit, new_for_audit, change_type):
    conn.execute(
        f'UPDATE "{tool_slug}" SET "{col_slug}" = ?, rev = ? WHERE __id = ?',
        (value, rev, row_id)
    )
    audit(conn, tool_slug, "UPDATE", row_tag=row_tag, col_slug=col_slug,
          old_val=old_for_audit, new_val=new_for_audit,
          change_type=change_type, revision=rev)


def _delete_active_row(conn, tool_slug, row_id, row_tag, rev, change_type="undo"):
    conn.execute(f'DELETE FROM "{tool_slug}" WHERE __id = ?', (row_id,))
    audit(conn, tool_slug, "DELETE", row_tag=row_tag,
          change_type=change_type, revision=rev)


def _insert_from_snapshot(conn, tool_slug: str, row_data: dict, rev: int) -> tuple[int, str]:
    """Insert a row from a plain-values dict. Returns (new_row_id, tag_val)."""
    from .service import _validate_tag_unique

    tag_val = row_data.get("tag", "")
    _validate_tag_unique(conn, tool_slug, tag_val)

    max_pos = conn.execute(f'SELECT MAX(__position) FROM "{tool_slug}"').fetchone()[0]
    next_pos = (max_pos or -1) + 1

    safe = {k: v for k, v in row_data.items() if not k.startswith("__") and k != "log"}
    safe["rev"] = rev
    safe["__position"] = next_pos

    cols = ", ".join(f'"{c}"' for c in safe)
    phs  = ", ".join("?" * len(safe))
    conn.execute(f'INSERT INTO "{tool_slug}" ({cols}) VALUES ({phs})', list(safe.values()))
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    audit(conn, tool_slug, "INSERT", row_tag=tag_val,
          new_val=json.dumps(safe), change_type="undo_hard_delete", revision=rev)
    return new_id, tag_val


def _restore_from_trash(conn, tool_slug: str, trash_id: int, rev: int) -> tuple[int, str]:
    """Restore row from _trash. Returns (new_row_id, tag_val)."""
    from .service import _validate_tag_unique

    trash = conn.execute(
        "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, tool_slug)
    ).fetchone()
    if not trash:
        raise HTTPException(status_code=404, detail="Trash entry not found for undo")
    trash = dict(trash)

    row_data = json.loads(trash["row_data"])
    tag_val  = row_data.get("tag", "")
    _validate_tag_unique(conn, tool_slug, tag_val)

    max_pos  = conn.execute(f'SELECT MAX(__position) FROM "{tool_slug}"').fetchone()[0]
    next_pos = (max_pos or -1) + 1
    ts       = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    new_log  = _append_log(trash.get("row_log"), f"[{ts} REV {rev}] RESTORED (undo)")

    safe = {k: v for k, v in row_data.items() if not k.startswith("__") and k != "log"}
    safe["rev"]          = rev
    safe["__position"]   = next_pos
    safe["__log"]        = new_log

    cols = ", ".join(f'"{c}"' for c in safe)
    phs  = ", ".join("?" * len(safe))
    conn.execute(f'INSERT INTO "{tool_slug}" ({cols}) VALUES ({phs})', list(safe.values()))
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
    audit(conn, tool_slug, "RESTORE", row_tag=tag_val, change_type="undo", revision=rev)
    return new_id, tag_val


def _soft_delete_to_trash(conn, tool_slug: str, row_id: int, rev: int) -> tuple[int, str]:
    """Move row to _trash. Returns (trash_id, tag_val)."""
    row = conn.execute(f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found for redo")
    row = dict(row)

    tag_val   = row.get("tag", "")
    ts        = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    log_entry = _append_log(row.get("__log"), f"[{ts} REV {rev}] REMOVED (redo)")
    row_data  = {k: v for k, v in row.items() if not k.startswith("__")}
    orig_pos  = row.get("__position", 0)

    conn.execute(
        "INSERT INTO _trash (tool_slug, orig_pos, row_data, row_log) VALUES (?,?,?,?)",
        (tool_slug, orig_pos, json.dumps(row_data), log_entry)
    )
    trash_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute(f'DELETE FROM "{tool_slug}" WHERE __id = ?', (row_id,))
    audit(conn, tool_slug, "DELETE", row_tag=tag_val, change_type="redo", revision=rev)
    return trash_id, tag_val


# ── Public undo / redo ──────────────────────────────────────────────────────

def do_undo(conn: sqlite3.Connection, tool_id: int) -> dict:
    entry = _pop_undo(tool_id)
    if not entry:
        raise HTTPException(status_code=400, detail="Nothing to undo")

    rev       = get_current_revision(conn)
    t         = entry["type"]
    tool_slug = entry["tool_slug"]

    if t == "cell_edit":
        _apply_cell(conn, tool_slug, entry["row_id"], entry["col_slug"],
                    entry["old_val"], rev, entry["row_tag"],
                    old_for_audit=entry["new_val"], new_for_audit=entry["old_val"],
                    change_type="undo")
        conn.commit()
        _push_redo(tool_id, entry)
        return {**get_stack_sizes(tool_id),
                "type": "cell_edit", "row_id": entry["row_id"], "col_slug": entry["col_slug"]}

    if t == "row_insert":
        _delete_active_row(conn, tool_slug, entry["row_id"], entry["row_tag"], rev)
        conn.commit()
        _push_redo(tool_id, {**entry, "row_id": None})
        return {**get_stack_sizes(tool_id),
                "type": "row_insert_undone", "row_tag": entry["row_tag"]}

    if t == "soft_delete":
        new_id, tag = _restore_from_trash(conn, tool_slug, entry["trash_id"], rev)
        conn.commit()
        _push_redo(tool_id, {
            "type": "soft_delete_redo", "tool_slug": tool_slug, "tool_id": tool_id,
            "row_id": new_id, "row_tag": tag,
        })
        return {**get_stack_sizes(tool_id),
                "type": "soft_delete_undone", "row_id": new_id, "row_tag": tag}

    if t == "hard_delete":
        row_data = entry["row_data"] if isinstance(entry["row_data"], dict) else json.loads(entry["row_data"])
        new_id, tag = _insert_from_snapshot(conn, tool_slug, row_data, rev)
        conn.commit()
        _push_redo(tool_id, {
            "type": "hard_delete_redo", "tool_slug": tool_slug, "tool_id": tool_id,
            "row_id": new_id, "row_tag": tag, "row_data": entry["row_data"],
        })
        return {**get_stack_sizes(tool_id),
                "type": "hard_delete_undone", "row_id": new_id, "row_tag": tag}

    raise HTTPException(status_code=500, detail=f"Unknown undo type: {t}")


def do_redo(conn: sqlite3.Connection, tool_id: int) -> dict:
    entry = _pop_redo(tool_id)
    if not entry:
        raise HTTPException(status_code=400, detail="Nothing to redo")

    rev       = get_current_revision(conn)
    t         = entry["type"]
    tool_slug = entry["tool_slug"]

    if t == "cell_edit":
        _apply_cell(conn, tool_slug, entry["row_id"], entry["col_slug"],
                    entry["new_val"], rev, entry["row_tag"],
                    old_for_audit=entry["old_val"], new_for_audit=entry["new_val"],
                    change_type="redo")
        conn.commit()
        _push_undo_internal(tool_id, entry)
        return {**get_stack_sizes(tool_id),
                "type": "cell_edit", "row_id": entry["row_id"], "col_slug": entry["col_slug"]}

    if t == "row_insert":
        row_data = entry["row_snapshot"]
        new_id, tag = _insert_from_snapshot(conn, tool_slug, row_data, rev)
        conn.commit()
        _push_undo_internal(tool_id, {**entry, "row_id": new_id})
        return {**get_stack_sizes(tool_id),
                "type": "row_insert_redone", "row_id": new_id, "row_tag": tag}

    if t == "soft_delete_redo":
        trash_id, tag = _soft_delete_to_trash(conn, tool_slug, entry["row_id"], rev)
        conn.commit()
        _push_undo_internal(tool_id, {
            "type": "soft_delete", "tool_slug": tool_slug, "tool_id": tool_id,
            "trash_id": trash_id, "row_tag": tag,
        })
        return {**get_stack_sizes(tool_id),
                "type": "soft_delete_redone", "row_tag": tag}

    if t == "hard_delete_redo":
        trash_id, tag = _soft_delete_to_trash(conn, tool_slug, entry["row_id"], rev)
        conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
        conn.commit()
        _push_undo_internal(tool_id, {
            "type": "hard_delete", "tool_slug": tool_slug, "tool_id": tool_id,
            "row_data": entry["row_data"], "row_tag": tag,
        })
        return {**get_stack_sizes(tool_id),
                "type": "hard_delete_redone", "row_tag": tag}

    raise HTTPException(status_code=500, detail=f"Unknown redo type: {t}")
