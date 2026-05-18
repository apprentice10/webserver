"""MTO V1 — materials table CRUD for a typical."""
import sqlite3
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dashboard.project_db import get_project_conn, get_current_revision
from dashboard.utils import format_log_entry, append_log

router = APIRouter()

_EDITABLE = {"part_description", "size", "material", "uom", "quantity"}
_ALL_COLUMNS = ["id", "tag", "rev", "log", "part_description", "size", "material", "uom", "quantity", "position"]


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def _require_typical(tool_id: int, typical_id: int, conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT id, name FROM mto_typicals WHERE id = ? AND tool_id = ?",
        (typical_id, tool_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Typical not found")
    return dict(row)


def _require_row(typical_id: int, row_id: int, conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT * FROM mto_materials WHERE id = ? AND typical_id = ?",
        (row_id, typical_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Material row not found")
    return dict(row)


def _utility_count(tool_id: int, typical_name: str, conn: sqlite3.Connection) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM mto_utilities WHERE tool_id = ? AND typical_name = ?",
        (tool_id, typical_name),
    ).fetchone()[0]


def _row_to_dict(row: dict, utility_count: int) -> dict:
    qty = row["quantity"] or 0
    return {**row, "total": qty * utility_count}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{tool_id}/materials/{typical_id}")
def list_materials(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    typical = _require_typical(tool_id, typical_id, conn)
    ucount = _utility_count(tool_id, typical["name"], conn)
    rows = conn.execute(
        "SELECT id, tag, rev, log, part_description, size, material, uom, quantity, position"
        " FROM mto_materials WHERE typical_id = ? ORDER BY position, id",
        (typical_id,),
    ).fetchall()
    return {
        "columns": _ALL_COLUMNS + ["total"],
        "rows": [_row_to_dict(dict(r), ucount) for r in rows],
        "utility_count": ucount,
    }


@router.post("/{tool_id}/materials/{typical_id}", status_code=201)
def add_material_row(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    rev = get_current_revision(conn)
    max_pos = conn.execute(
        "SELECT COALESCE(MAX(position), 0) FROM mto_materials WHERE typical_id = ?",
        (typical_id,),
    ).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO mto_materials (typical_id, tag, rev, position) VALUES (?, '', ?, ?)",
        (typical_id, rev, max_pos + 1),
    )
    row_id = cur.lastrowid
    # TAG = row id as string — stable, unique, used for image annotation
    conn.execute("UPDATE mto_materials SET tag = ? WHERE id = ?", (str(row_id), row_id))
    conn.commit()
    row = dict(conn.execute(
        "SELECT id, tag, rev, log, part_description, size, material, uom, quantity, position"
        " FROM mto_materials WHERE id = ?",
        (row_id,),
    ).fetchone())
    return {**row, "total": 0}


class _CellUpdate(BaseModel):
    column: str
    value: Any


@router.patch("/{tool_id}/materials/{typical_id}/{row_id}")
def update_material_cell(
    tool_id: int,
    typical_id: int,
    row_id: int,
    body: _CellUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    typical = _require_typical(tool_id, typical_id, conn)
    if body.column not in _EDITABLE:
        raise HTTPException(status_code=422, detail=f"Column '{body.column}' is not editable")
    existing = _require_row(typical_id, row_id, conn)
    rev = get_current_revision(conn)
    old_val = existing.get(body.column)
    log_entry = format_log_entry(rev, body.column, old_val, body.value)
    new_log = append_log(existing.get("log") or "", log_entry)
    conn.execute(
        f"UPDATE mto_materials SET {body.column} = ?, rev = ?, log = ? WHERE id = ?",
        (body.value, rev, new_log, row_id),
    )
    conn.commit()
    ucount = _utility_count(tool_id, typical["name"], conn)
    row = dict(conn.execute(
        "SELECT id, tag, rev, log, part_description, size, material, uom, quantity, position"
        " FROM mto_materials WHERE id = ?",
        (row_id,),
    ).fetchone())
    return _row_to_dict(row, ucount)


@router.delete("/{tool_id}/materials/{typical_id}/{row_id}", status_code=204)
def delete_material_row(
    tool_id: int,
    typical_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    _require_row(typical_id, row_id, conn)
    conn.execute("DELETE FROM mto_materials WHERE id = ? AND typical_id = ?", (row_id, typical_id))
    conn.commit()


class _ReorderBody(BaseModel):
    ordered_ids: List[int]


@router.post("/{tool_id}/materials/{typical_id}/reorder")
def reorder_materials(
    tool_id: int,
    typical_id: int,
    body: _ReorderBody,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    for pos, rid in enumerate(body.ordered_ids):
        conn.execute(
            "UPDATE mto_materials SET position = ? WHERE id = ? AND typical_id = ?",
            (pos, rid, typical_id),
        )
    conn.commit()
    return {"ok": True}
