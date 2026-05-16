"""
engine/service_row_ops.py
--------------------------
Row mutation operations: override removal, soft-delete, restore, hard-delete,
bulk paste, and cell rollback. Extracted from engine/service.py (P3-006).
"""

import json
import sqlite3
from datetime import datetime, timezone
from fastapi import HTTPException

from dashboard.project_db import (
    audit,
    serialize_active_row, serialize_trash_row,
    get_row_overrides, get_current_revision,
)
from dashboard.utils import format_log_entry as _format_log_entry, append_log as _append_log
from dashboard.staleness import mark_tool_stale, mark_dependents_stale


def remove_override(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    col_slug: str,
    project_id: int
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]

    row = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    row = dict(row)

    tag_val = row.get("tag", "")
    override = conn.execute(
        "SELECT etl_value FROM _overrides WHERE tool_slug = ? AND row_tag = ? AND col_slug = ?",
        (slug, tag_val, col_slug)
    ).fetchone()
    if not override:
        raise HTTPException(status_code=404, detail="No override found for this cell")

    etl_value = override["etl_value"]
    rev = get_current_revision(conn)
    conn.execute(
        f'UPDATE "{slug}" SET "{col_slug}" = ? WHERE __id = ?',
        (etl_value, row_id)
    )
    conn.execute(
        "DELETE FROM _overrides WHERE tool_slug = ? AND row_tag = ? AND col_slug = ?",
        (slug, tag_val, col_slug)
    )
    audit(conn, slug, "RESTORE", row_tag=tag_val, col_slug=col_slug,
          old_val=row.get(col_slug), new_val=etl_value,
          change_type="restore", revision=rev)
    conn.commit()

    updated = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    overrides = get_row_overrides(conn, slug, tag_val)
    return serialize_active_row(updated, tool_id, project_id, overrides)


def soft_delete_row(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    row = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    row = dict(row)

    tag_val = row.get("tag", "")
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    log_entry = _append_log(row.get("__log"), f"[{ts} REV {rev}] REMOVED")

    row_data = {k: v for k, v in row.items() if not k.startswith("__")}
    orig_pos = row.get("__position", 0)

    conn.execute(
        "INSERT INTO _trash (tool_slug, orig_pos, row_data, row_log) VALUES (?,?,?,?)",
        (slug, orig_pos, json.dumps(row_data), log_entry)
    )
    trash_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute(f'DELETE FROM "{slug}" WHERE __id = ?', (row_id,))

    audit(conn, slug, "DELETE", row_tag=tag_val, change_type="delete", revision=rev)
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    trash_row = conn.execute(
        "SELECT * FROM _trash WHERE id = ?", (trash_id,)
    ).fetchone()
    return serialize_trash_row(trash_row, tool_id, project_id)


def restore_row(
    conn: sqlite3.Connection,
    tool_id: int,
    trash_id: int,
    project_id: int
) -> dict:
    from .service import get_engine, _validate_tag_unique
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    trash = conn.execute(
        "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, slug)
    ).fetchone()
    if not trash:
        raise HTTPException(status_code=404, detail="Trash row not found")
    trash = dict(trash)

    try:
        row_data = json.loads(trash["row_data"])
    except Exception:
        row_data = {}

    tag_val = row_data.get("tag", "")
    _validate_tag_unique(conn, slug, tag_val)

    max_pos = conn.execute(
        f'SELECT MAX(__position) FROM "{slug}"'
    ).fetchone()[0]
    next_pos = (max_pos or -1) + 1

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    new_log = _append_log(trash.get("row_log"), f"[{ts} REV {rev}] RESTORED")

    safe_data = {k: v for k, v in row_data.items()
                 if not k.startswith("__") and k != "log"}
    safe_data["rev"] = rev
    safe_data["__position"] = next_pos
    safe_data["__log"] = new_log

    cols_str = ", ".join(f'"{c}"' for c in safe_data)
    placeholders = ", ".join("?" * len(safe_data))
    conn.execute(
        f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
        list(safe_data.values())
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
    audit(conn, slug, "RESTORE", row_tag=tag_val, change_type="restore", revision=rev)
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)).fetchone()
    return serialize_active_row(row, tool_id, project_id)


def hard_delete_row(
    conn: sqlite3.Connection,
    tool_id: int,
    trash_id: int,
    project_id: int
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]

    trash = conn.execute(
        "SELECT * FROM _trash WHERE id = ? AND tool_slug = ?", (trash_id, slug)
    ).fetchone()
    if not trash:
        raise HTTPException(status_code=404, detail="Trash row not found")

    conn.execute("DELETE FROM _trash WHERE id = ?", (trash_id,))
    conn.commit()
    return {"ok": True, "deleted_id": trash_id}


def paste_rows(
    conn: sqlite3.Connection,
    tool_id: int,
    project_id: int,
    rows_data: list[dict]
) -> dict:
    from .service import get_engine, get_columns
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    valid_cols = {c["slug"] for c in get_columns(conn, tool_id)
                  if c["slug"] not in ("log",)}

    max_pos = conn.execute(
        f'SELECT MAX(__position) FROM "{slug}"'
    ).fetchone()[0]
    next_pos = (max_pos or -1) + 1

    inserted = []
    skipped  = []

    for row_data in rows_data:
        tag_val = (row_data.get("tag") or "").strip()
        if not tag_val:
            skipped.append({"reason": "empty TAG", "data": row_data})
            continue

        if conn.execute(
            f'SELECT 1 FROM "{slug}" WHERE tag = ?', (tag_val,)
        ).fetchone():
            skipped.append({"reason": f"TAG '{tag_val}' already exists", "data": row_data})
            continue

        insert_data = {"tag": tag_val, "rev": rev, "__position": next_pos}
        for k, v in row_data.items():
            if k in valid_cols and k not in ("tag", "rev"):
                insert_data[k] = str(v).strip() if v is not None else None

        cols_str = ", ".join(f'"{c}"' for c in insert_data)
        placeholders = ", ".join("?" * len(insert_data))
        conn.execute(
            f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
            list(insert_data.values())
        )
        new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        audit(conn, slug, "INSERT", row_tag=tag_val, new_val=tag_val,
              change_type="bulk_paste", revision=rev)
        next_pos += 1

        row = conn.execute(
            f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)
        ).fetchone()
        inserted.append(serialize_active_row(row, tool_id, project_id))

    if inserted:
        mark_tool_stale(conn, slug)
        mark_dependents_stale(conn, slug)
    conn.commit()
    return {"inserted": inserted, "skipped": skipped}


def rollback_cell(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int,
    col_slug: str,
    entry_id: int
) -> dict:
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    tool_slug = tool["slug"]
    rev = get_current_revision(conn)

    if col_slug in ("rev", "log"):
        raise HTTPException(status_code=400, detail="Cannot rollback system column")

    entry = conn.execute(
        "SELECT * FROM _audit WHERE id = ? AND tool_slug = ?",
        (entry_id, tool_slug)
    ).fetchone()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit entry not found")

    row = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    row = dict(row)
    tag_val = row.get("tag", "")
    restore_value = dict(entry)["old_val"]
    current_value = row.get(col_slug)

    conn.execute(
        f'UPDATE "{tool_slug}" SET "{col_slug}" = ?, rev = ? WHERE __id = ?',
        (restore_value, rev, row_id)
    )

    log_entry = _format_log_entry(rev, col_slug, current_value, restore_value)
    new_log = _append_log(row.get("__log"), f"[ROLLBACK] {log_entry}")
    conn.execute(
        f'UPDATE "{tool_slug}" SET __log = ? WHERE __id = ?',
        (new_log, row_id)
    )

    audit(conn, tool_slug, "ROLLBACK", row_tag=tag_val, col_slug=col_slug,
          old_val=current_value, new_val=restore_value, change_type="rollback", revision=rev)
    mark_tool_stale(conn, tool_slug)
    mark_dependents_stale(conn, tool_slug)
    conn.commit()

    updated = conn.execute(
        f'SELECT * FROM "{tool_slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    overrides = get_row_overrides(conn, tool_slug, tag_val)
    return serialize_active_row(updated, tool_id, project_id, overrides)
