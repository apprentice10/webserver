"""MTO V1 — typical CRUD (list, create, rename, delete)."""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dashboard.project_db import get_project_conn

router = APIRouter()


def _require_mto_tool(tool_id: int, conn: sqlite3.Connection) -> None:
    if not conn.execute(
        "SELECT 1 FROM _tools WHERE id = ? AND tool_type = 'mto'", (tool_id,)
    ).fetchone():
        raise HTTPException(status_code=404, detail="MTO tool not found")


def _require_typical(tool_id: int, typical_id: int, conn: sqlite3.Connection) -> None:
    if not conn.execute(
        "SELECT 1 FROM mto_typicals WHERE id = ? AND tool_id = ?", (typical_id, tool_id)
    ).fetchone():
        raise HTTPException(status_code=404, detail="Typical not found")


class _RenameBody(BaseModel):
    name: str


@router.get("/{tool_id}/typicals")
def list_typicals(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_mto_tool(tool_id, conn)
    rows = conn.execute(
        "SELECT id, name, description, position FROM mto_typicals"
        " WHERE tool_id = ? ORDER BY position, id",
        (tool_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{tool_id}/typicals", status_code=201)
def create_typical(
    tool_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_mto_tool(tool_id, conn)
    row = conn.execute(
        "SELECT COALESCE(MAX(position), 0) FROM mto_typicals WHERE tool_id = ?",
        (tool_id,),
    ).fetchone()
    pos = row[0] + 1
    name = f"Typical {pos}"
    cur = conn.execute(
        "INSERT INTO mto_typicals (tool_id, name, description, position)"
        " VALUES (?, ?, '', ?)",
        (tool_id, name, pos),
    )
    conn.commit()
    return {"id": cur.lastrowid, "name": name, "description": "", "position": pos}


@router.patch("/{tool_id}/typicals/{typical_id}")
def rename_typical(
    tool_id: int,
    typical_id: int,
    body: _RenameBody,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_mto_tool(tool_id, conn)
    _require_typical(tool_id, typical_id, conn)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be empty")
    conn.execute(
        "UPDATE mto_typicals SET name = ? WHERE id = ? AND tool_id = ?",
        (name, typical_id, tool_id),
    )
    conn.commit()
    return {"id": typical_id, "name": name}


@router.delete("/{tool_id}/typicals/{typical_id}", status_code=204)
def delete_typical(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_mto_tool(tool_id, conn)
    _require_typical(tool_id, typical_id, conn)
    conn.execute("DELETE FROM mto_materials WHERE typical_id = ?", (typical_id,))
    conn.execute("DELETE FROM mto_images WHERE typical_id = ?", (typical_id,))
    conn.execute("DELETE FROM mto_tag_placements WHERE typical_id = ?", (typical_id,))
    conn.execute(
        "DELETE FROM mto_typicals WHERE id = ? AND tool_id = ?", (typical_id, tool_id)
    )
    conn.commit()
