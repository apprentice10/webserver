"""MTO V1 — tag placement save/load/delete for a typical."""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dashboard.project_db import get_project_conn

router = APIRouter()


class PlacementIn(BaseModel):
    tag: str
    label_x: float
    label_y: float
    arrow_x: float
    arrow_y: float


def _require_typical(tool_id: int, typical_id: int, conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT id FROM mto_typicals WHERE id = ? AND tool_id = ?",
        (typical_id, tool_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Typical not found")


@router.get("/{tool_id}/placements/{typical_id}")
def list_placements(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    rows = conn.execute(
        "SELECT tag, label_x, label_y, arrow_x, arrow_y FROM mto_tag_placements WHERE typical_id = ?",
        (typical_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{tool_id}/placements/{typical_id}", status_code=201)
def upsert_placement(
    tool_id: int,
    typical_id: int,
    body: PlacementIn,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    conn.execute(
        "DELETE FROM mto_tag_placements WHERE typical_id = ? AND tag = ?",
        (typical_id, body.tag),
    )
    conn.execute(
        "INSERT INTO mto_tag_placements (typical_id, tag, label_x, label_y, arrow_x, arrow_y) VALUES (?, ?, ?, ?, ?, ?)",
        (typical_id, body.tag, body.label_x, body.label_y, body.arrow_x, body.arrow_y),
    )
    conn.commit()
    return {"tag": body.tag, "typical_id": typical_id}


@router.delete("/{tool_id}/placements/{typical_id}/{tag}", status_code=204)
def delete_placement(
    tool_id: int,
    typical_id: int,
    tag: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    conn.execute(
        "DELETE FROM mto_tag_placements WHERE typical_id = ? AND tag = ?",
        (typical_id, tag),
    )
    conn.commit()
