"""
Sheet V1 — batch row and cell operations.

Implements batch_row_op (soft_delete, restore, hard_delete, keep in one transaction)
and batch_remove_override (multiple override removals in one transaction).
"""

import json
import sqlite3
from datetime import datetime, timezone
from fastapi import HTTPException

from dashboard.project_db import (
    audit, serialize_active_row, serialize_trash_row,
    get_row_overrides, get_current_revision,
)
from dashboard.utils import append_log as _append_log
from dashboard.staleness import mark_tool_stale, mark_dependents_stale
from .service_undo import push_undo


def batch_row_op(
    conn: sqlite3.Connection,
    tool_id: int,
    operation: str,
    row_ids: list,
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    if operation == "soft_delete":
        return _batch_soft_delete(conn, tool_id, slug, rev, row_ids)
    if operation == "restore":
        return _batch_restore(conn, tool_id, slug, rev, row_ids)
    if operation == "hard_delete":
        return _batch_hard_delete(conn, tool_id, slug, rev, row_ids)
    if operation == "keep":
        return _batch_keep(conn, tool_id, slug, rev, row_ids)
    raise HTTPException(status_code=400, detail=f"Unknown operation: {operation}")


def _batch_soft_delete(conn, tool_id, slug, rev, row_ids):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    undo_items = []
    updated = []

    for row_id in row_ids:
        row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
        if not row:
            continue
        row = dict(row)
        tag_val  = row.get("tag", "")
        orig_pos = row.get("__position", 0)
        log_entry = _append_log(row.get("__log"), f"[{ts} REV {rev}] REMOVED")
        row_data  = {k: v for k, v in row.items() if not k.startswith("__")}

        conn.execute(
            "INSERT INTO _trash (tool_slug, orig_pos, row_data, row_log) VALUES (?,?,?,?)",
            (slug, orig_pos, json.dumps(row_data), log_entry)
        )
        trash_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(f'DELETE FROM "{slug}" WHERE __id = ?', (row_id,))
        audit(conn, slug, "DELETE", row_tag=tag_val, change_type="delete", revision=rev)

        undo_items.append({"trash_id": trash_id, "row_tag": tag_val})
        trash_row = conn.execute("SELECT * FROM _trash WHERE id = ?", (trash_id,)).fetchone()
        updated.append(serialize_trash_row(trash_row, tool_id, None))

    if updated:
        mark_tool_stale(conn, slug)
        mark_dependents_stale(conn, slug)
    conn.commit()

    if undo_items:
        push_undo(tool_id, {
            "type": "batch_soft_delete", "tool_slug": slug, "tool_id": tool_id,
            "items": undo_items,
        })

    return {"updated": updated}


def _batch_restore(conn, tool_id, slug, rev, trash_ids):
    from .service import _validate_tag_unique
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    undo_items = []
    updated = []

    for trash_id in trash_ids:
        trash = conn.execute(
            "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, slug)
        ).fetchone()
        if not trash:
            continue
        trash = dict(trash)
        try:
            row_data = json.loads(trash["row_data"])
        except Exception:
            row_data = {}

        tag_val = row_data.get("tag", "")
        try:
            _validate_tag_unique(conn, slug, tag_val)
        except Exception:
            continue

        max_pos  = conn.execute(f'SELECT MAX(__position) FROM "{slug}"').fetchone()[0]
        next_pos = (max_pos or -1) + 1
        new_log  = _append_log(trash.get("row_log"), f"[{ts} REV {rev}] RESTORED")

        safe = {k: v for k, v in row_data.items() if not k.startswith("__") and k != "log"}
        safe.update({"rev": rev, "__position": next_pos, "__log": new_log})

        cols  = ", ".join(f'"{c}"' for c in safe)
        phs   = ", ".join("?" * len(safe))
        conn.execute(f'INSERT INTO "{slug}" ({cols}) VALUES ({phs})', list(safe.values()))
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
        audit(conn, slug, "RESTORE", row_tag=tag_val, change_type="restore", revision=rev)

        undo_items.append({"new_id": new_id, "row_tag": tag_val})
        row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)).fetchone()
        updated.append(serialize_active_row(row, tool_id, None))

    if updated:
        mark_tool_stale(conn, slug)
        mark_dependents_stale(conn, slug)
    conn.commit()

    if undo_items:
        push_undo(tool_id, {
            "type": "batch_restore", "tool_slug": slug, "tool_id": tool_id,
            "items": undo_items,
        })

    return {"updated": updated}


def _batch_hard_delete(conn, tool_id, slug, rev, trash_ids):
    deleted_ids = []

    for trash_id in trash_ids:
        trash = conn.execute(
            "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, slug)
        ).fetchone()
        if not trash:
            continue
        trash = dict(trash)
        row_data_str  = trash["row_data"]
        row_data_dict = json.loads(row_data_str)
        tag_val = row_data_dict.get("tag", "")

        audit(conn, slug, "HARD_DELETE", row_tag=tag_val,
              old_val=row_data_str, change_type="hard_delete", revision=rev)
        conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
        deleted_ids.append(trash_id)

    conn.commit()
    # No undo entry — hard delete is non-reversible (matches single-row behavior)
    return {"ok": True, "deleted_ids": deleted_ids}


def _batch_keep(conn, tool_id, slug, rev, row_ids):
    flag = conn.execute("SELECT id FROM _flags WHERE name = 'ETL: Eliminated'").fetchone()
    kept = []

    for row_id in row_ids:
        row = conn.execute(f'SELECT tag FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
        if not row:
            continue
        tag = row["tag"]
        if flag:
            conn.execute(
                "DELETE FROM _cell_flags WHERE tool_slug=? AND row_tag=? AND col_slug='' AND flag_id=?",
                (slug, tag, flag["id"])
            )
        audit(conn, slug, "KEEP_ROW", row_tag=tag, change_type="keep", revision=rev)
        kept.append({"row_id": row_id, "row_tag": tag})

    conn.commit()

    if kept and flag:
        push_undo(tool_id, {
            "type": "batch_keep", "tool_slug": slug, "tool_id": tool_id,
            "flag_id": flag["id"], "items": kept,
        })

    return {"kept": [k["row_tag"] for k in kept]}


def batch_remove_override(
    conn: sqlite3.Connection,
    tool_id: int,
    cells: list,          # list of {row_id, col_slug}
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    undo_items = []
    updated_rows = {}  # row_id → latest row data

    for cell in cells:
        row_id   = cell["row_id"]
        col_slug = cell["col_slug"]

        row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
        if not row:
            continue
        row = dict(row)
        tag_val = row.get("tag", "")

        override = conn.execute(
            "SELECT etl_value FROM _overrides WHERE tool_slug=? AND row_tag=? AND col_slug=?",
            (slug, tag_val, col_slug)
        ).fetchone()
        if not override:
            continue

        etl_value    = override["etl_value"]
        manual_value = row.get(col_slug)

        conn.execute(
            f'UPDATE "{slug}" SET "{col_slug}" = ? WHERE __id = ?', (etl_value, row_id)
        )
        conn.execute(
            "DELETE FROM _overrides WHERE tool_slug=? AND row_tag=? AND col_slug=?",
            (slug, tag_val, col_slug)
        )
        audit(conn, slug, "RESTORE", row_tag=tag_val, col_slug=col_slug,
              old_val=manual_value, new_val=etl_value, change_type="restore", revision=rev)

        undo_items.append({
            "row_id": row_id, "row_tag": tag_val, "col_slug": col_slug,
            "etl_value": etl_value, "manual_value": str(manual_value) if manual_value is not None else None,
        })
        updated_rows[row_id] = tag_val

    if updated_rows:
        mark_tool_stale(conn, slug)
        mark_dependents_stale(conn, slug)
    conn.commit()

    if undo_items:
        push_undo(tool_id, {
            "type": "batch_remove_override", "tool_slug": slug, "tool_id": tool_id,
            "items": undo_items,
        })

    result = []
    for row_id, tag_val in updated_rows.items():
        updated = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)).fetchone()
        if updated:
            overrides = get_row_overrides(conn, slug, tag_val)
            result.append(serialize_active_row(updated, tool_id, None, overrides))

    return {"updated": result}
