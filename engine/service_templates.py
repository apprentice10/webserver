"""
engine/service_templates.py
----------------------------
Template CRUD — per-project _templates table.
"""

import sqlite3
from fastapi import HTTPException


def get_templates(
    conn: sqlite3.Connection,
    type_slug: str = None,
) -> list[dict]:
    if type_slug:
        rows = conn.execute(
            "SELECT * FROM _templates WHERE type_slug = ? ORDER BY id DESC",
            (type_slug,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM _templates ORDER BY id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_template(
    conn: sqlite3.Connection,
    type_slug: str,
    name: str,
    etl_sql: str = "",
    description: str = "",
) -> dict:
    cur = conn.execute(
        "INSERT INTO _templates (type_slug, name, etl_sql, description) VALUES (?, ?, ?, ?)",
        (type_slug, name, etl_sql or "", description or ""),
    )
    conn.commit()
    return dict(conn.execute(
        "SELECT * FROM _templates WHERE id = ?", (cur.lastrowid,)
    ).fetchone())


def delete_template(conn: sqlite3.Connection, template_id: int) -> None:
    row = conn.execute(
        "SELECT id FROM _templates WHERE id = ?", (template_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    conn.execute("DELETE FROM _templates WHERE id = ?", (template_id,))
    conn.commit()
