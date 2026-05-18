"""
MTO V1 — tool instance CRUD endpoints.
Create, open, and delete MTO tool instances in the project DB.
"""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from dashboard.project_db import get_project_conn
from dashboard.utils import slugify

router = APIRouter()


class MtoCreate(BaseModel):
    name: str
    icon: Optional[str] = "🔩"


def _get_tool(conn: sqlite3.Connection, tool_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM _tools WHERE id = ? AND tool_type = 'mto'", (tool_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="MTO tool not found")
    return dict(row)


def _unique_slug(conn: sqlite3.Connection, base: str) -> str:
    slug = base
    n = 1
    while conn.execute("SELECT 1 FROM _tools WHERE slug = ?", (slug,)).fetchone():
        n += 1
        slug = f"{base}_{n}"
    return slug


@router.post("/")
def create_mto_tool(
    data: MtoCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    slug = _unique_slug(conn, slugify(data.name))
    max_pos = conn.execute("SELECT COALESCE(MAX(position), -1) FROM _tools").fetchone()[0]
    conn.execute(
        """INSERT INTO _tools (slug, name, tool_type, engine_version, icon, rev, position)
           VALUES (?, ?, 'mto', '1.0', ?, 'A', ?)""",
        (slug, data.name, data.icon or "🔩", max_pos + 1),
    )
    tool_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    return dict(conn.execute("SELECT * FROM _tools WHERE id = ?", (tool_id,)).fetchone())


@router.get("/{tool_id}")
def open_mto_tool(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    tool = _get_tool(conn, tool_id)
    typicals = conn.execute(
        "SELECT id, name, description, position FROM mto_typicals WHERE tool_id = ? ORDER BY position, id",
        (tool_id,),
    ).fetchall()
    return {**tool, "typicals": [dict(r) for r in typicals]}


@router.delete("/{tool_id}")
def delete_mto_tool(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _get_tool(conn, tool_id)
    # mto_materials, mto_images, mto_tag_placements cascade via FK on typical_id
    conn.execute("DELETE FROM mto_typicals WHERE tool_id = ?", (tool_id,))
    conn.execute("DELETE FROM mto_utilities WHERE tool_id = ?", (tool_id,))
    conn.execute("DELETE FROM _tools WHERE id = ?", (tool_id,))
    conn.commit()
    return {"ok": True}
