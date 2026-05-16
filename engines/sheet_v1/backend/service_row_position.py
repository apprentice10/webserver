"""
service_row_position.py
-----------------------
Row position operations: insert at position, copy-and-insert, reorder.
Companion: service_row_position.py.md
"""

import json
import uuid
import sqlite3
from fastapi import HTTPException

from dashboard.project_db import audit, serialize_active_row, get_current_revision
from dashboard.staleness import mark_tool_stale, mark_dependents_stale
from .service_undo import push_undo


def insert_row_at_position(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    placement: str,
    project_id: int,
) -> dict:
    """Insert a new empty row above or below row_id."""
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    ref = conn.execute(
        f'SELECT __position FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not ref:
        raise HTTPException(status_code=404, detail="Row not found")

    ref_pos = ref["__position"]
    new_pos = ref_pos if placement == "above" else ref_pos + 1

    conn.execute(
        f'UPDATE "{slug}" SET __position = __position + 1 WHERE __position >= ?',
        (new_pos,)
    )

    tag_val = f"NEW-{uuid.uuid4().hex[:8].upper()}"
    conn.execute(
        f'INSERT INTO "{slug}" (tag, rev, __position) VALUES (?, ?, ?)',
        (tag_val, rev, new_pos)
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    audit(conn, slug, "INSERT", row_tag=tag_val,
          new_val=f'{{"tag":"{tag_val}","rev":{rev}}}',
          change_type="insert", revision=rev)
    conn.commit()

    row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)).fetchone()
    row_snapshot = {k: v for k, v in dict(row).items() if not k.startswith("__")}
    push_undo(tool_id, {
        "type": "row_insert", "tool_slug": slug, "tool_id": tool_id,
        "row_id": new_id, "row_tag": tag_val, "row_snapshot": row_snapshot,
    })
    return serialize_active_row(row, tool_id, project_id)


def copy_row_insert(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    project_id: int,
) -> dict:
    """Duplicate user-column values into a new row inserted immediately below row_id."""
    from .service import get_engine, get_columns
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]
    rev  = get_current_revision(conn)

    src = conn.execute(
        f'SELECT * FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    if not src:
        raise HTTPException(status_code=404, detail="Row not found")
    src = dict(src)

    new_pos = src["__position"] + 1
    conn.execute(
        f'UPDATE "{slug}" SET __position = __position + 1 WHERE __position >= ?',
        (new_pos,)
    )

    valid_cols = {c["slug"] for c in get_columns(conn, tool_id)
                  if c["slug"] not in ("rev", "log")}

    tag_val   = f"CPY-{uuid.uuid4().hex[:8].upper()}"
    copy_data = {"tag": tag_val, "rev": rev, "__position": new_pos}
    for k, v in src.items():
        if k in valid_cols and k not in ("tag", "rev"):
            copy_data[k] = v

    cols_str     = ", ".join(f'"{c}"' for c in copy_data)
    placeholders = ", ".join("?" * len(copy_data))
    conn.execute(
        f'INSERT INTO "{slug}" ({cols_str}) VALUES ({placeholders})',
        list(copy_data.values())
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    audit(conn, slug, "INSERT", row_tag=tag_val, new_val=json.dumps(copy_data),
          change_type="copy_insert", revision=rev)
    mark_tool_stale(conn, slug)
    mark_dependents_stale(conn, slug)
    conn.commit()

    row = conn.execute(f'SELECT * FROM "{slug}" WHERE __id = ?', (new_id,)).fetchone()
    row_snapshot = {k: v for k, v in dict(row).items() if not k.startswith("__")}
    push_undo(tool_id, {
        "type": "row_insert", "tool_slug": slug, "tool_id": tool_id,
        "row_id": new_id, "row_tag": tag_val, "row_snapshot": row_snapshot,
    })
    return serialize_active_row(row, tool_id, project_id)


def reorder_row(
    conn: sqlite3.Connection,
    tool_id: int,
    row_id: int,
    anchor_row_id: int,
    placement: str,
    project_id: int,
) -> dict:
    """Move row_id to just before/after anchor_row_id."""
    from .service import get_engine
    tool = get_engine(conn, tool_id)
    slug = tool["slug"]

    src = conn.execute(
        f'SELECT __position FROM "{slug}" WHERE __id = ?', (row_id,)
    ).fetchone()
    anc = conn.execute(
        f'SELECT __position FROM "{slug}" WHERE __id = ?', (anchor_row_id,)
    ).fetchone()
    if not src or not anc:
        raise HTTPException(status_code=404, detail="Row not found")

    P = src["__position"]
    T = anc["__position"]

    if placement == "before":
        target = T if P > T else T - 1
    else:
        target = T + 1 if P > T else T

    if P == target:
        return {"ok": True, "row_id": row_id, "position": P}

    if target > P:
        conn.execute(
            f'UPDATE "{slug}" SET __position = __position - 1 '
            f'WHERE __position > ? AND __position <= ?',
            (P, target)
        )
    else:
        conn.execute(
            f'UPDATE "{slug}" SET __position = __position + 1 '
            f'WHERE __position >= ? AND __position < ?',
            (target, P)
        )

    conn.execute(
        f'UPDATE "{slug}" SET __position = ? WHERE __id = ?',
        (target, row_id)
    )
    conn.commit()
    return {"ok": True, "row_id": row_id, "position": target}
