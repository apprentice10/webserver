"""MTO V1 — grid-api v1 Core contract for mto_materials (scoped to a typical)."""
import sqlite3
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dashboard.project_db import get_project_conn, get_current_revision
from dashboard.utils import format_log_entry, append_log

router = APIRouter()

_EDITABLE = {"part_description", "size", "material", "uom", "quantity"}

_DEFAULT_COLUMNS = [
    {"name": "TAG",         "slug": "tag",              "col_type": "text",   "width": 80,  "position": 0, "is_system": 1},
    {"name": "Description", "slug": "part_description", "col_type": "text",   "width": 220, "position": 1, "is_system": 0},
    {"name": "Size",        "slug": "size",              "col_type": "text",   "width": 100, "position": 2, "is_system": 0},
    {"name": "Material",    "slug": "material",          "col_type": "text",   "width": 120, "position": 3, "is_system": 0},
    {"name": "UOM",         "slug": "uom",               "col_type": "text",   "width": 80,  "position": 4, "is_system": 0},
    {"name": "Qty",         "slug": "quantity",          "col_type": "number", "width": 80,  "position": 5, "is_system": 0},
    {"name": "Total",       "slug": "total",             "col_type": "number", "width": 80,  "position": 6, "is_system": 1},
]


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


def _serialize_row(row: dict, utility_count: int = 0) -> dict:
    qty = row.get("quantity") or 0
    return {
        "id":              row["id"],
        "position":        row["position"],
        "is_deleted":      False,
        "row_log":         row.get("log") or "",
        "tag":             row.get("tag") or "",
        "rev":             str(row["rev"]) if row.get("rev") is not None else "",
        "log":             row.get("log") or "",
        "part_description": row.get("part_description") or "",
        "size":            row.get("size") or "",
        "material":        row.get("material") or "",
        "uom":             row.get("uom") or "",
        "quantity":        qty,
        "total":           qty * utility_count,
    }


def _ensure_columns(tool_id: int, conn: sqlite3.Connection) -> None:
    count = conn.execute(
        "SELECT COUNT(*) FROM mto_material_columns WHERE tool_id = ?", (tool_id,)
    ).fetchone()[0]
    if count == 0:
        for col in _DEFAULT_COLUMNS:
            conn.execute(
                "INSERT INTO mto_material_columns (tool_id, name, slug, col_type, width, position, is_system)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (tool_id, col["name"], col["slug"], col["col_type"],
                 col["width"], col["position"], col["is_system"]),
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Columns
# ---------------------------------------------------------------------------

@router.get("/{tool_id}/materials/{typical_id}/columns")
def list_columns(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    _ensure_columns(tool_id, conn)
    rows = conn.execute(
        "SELECT id, tool_id, name, slug, col_type, width, position, is_system"
        " FROM mto_material_columns WHERE tool_id = ? ORDER BY position",
        (tool_id,),
    ).fetchall()
    return [dict(r) | {"formula": None} for r in rows]


class _ColPatch(BaseModel):
    name: Optional[str] = None
    col_type: Optional[str] = None
    width: Optional[int] = None


@router.patch("/{tool_id}/materials/{typical_id}/columns/{col_id}")
def update_column(
    tool_id: int,
    typical_id: int,
    col_id: int,
    body: _ColPatch,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    col = conn.execute(
        "SELECT * FROM mto_material_columns WHERE id = ? AND tool_id = ?",
        (col_id, tool_id),
    ).fetchone()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    if body.name is not None:
        conn.execute("UPDATE mto_material_columns SET name = ? WHERE id = ?", (body.name, col_id))
    if body.col_type is not None:
        conn.execute("UPDATE mto_material_columns SET col_type = ? WHERE id = ?", (body.col_type, col_id))
    if body.width is not None:
        conn.execute("UPDATE mto_material_columns SET width = ? WHERE id = ?", (body.width, col_id))
    conn.commit()
    row = conn.execute(
        "SELECT id, tool_id, name, slug, col_type, width, position, is_system"
        " FROM mto_material_columns WHERE id = ?", (col_id,)
    ).fetchone()
    return dict(row) | {"formula": None}


class _WidthBody(BaseModel):
    width: int


@router.patch("/{tool_id}/materials/{typical_id}/columns/{col_id}/width")
def set_column_width(
    tool_id: int,
    typical_id: int,
    col_id: int,
    body: _WidthBody,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    conn.execute(
        "UPDATE mto_material_columns SET width = ? WHERE id = ? AND tool_id = ?",
        (body.width, col_id, tool_id),
    )
    conn.commit()
    return {"ok": True}


class _ReorderColsBody(BaseModel):
    order: List[int]


@router.put("/{tool_id}/materials/{typical_id}/columns/reorder")
def reorder_columns(
    tool_id: int,
    typical_id: int,
    body: _ReorderColsBody,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    for pos, col_id in enumerate(body.order):
        conn.execute(
            "UPDATE mto_material_columns SET position = ? WHERE id = ? AND tool_id = ?",
            (pos, col_id, tool_id),
        )
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Rows — Read & Create
# ---------------------------------------------------------------------------

@router.get("/{tool_id}/materials/{typical_id}/rows")
def list_rows(
    tool_id: int,
    typical_id: int,
    include_deleted: bool = False,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    typical = _require_typical(tool_id, typical_id, conn)
    ucount = _utility_count(tool_id, typical["name"], conn)
    rows = conn.execute(
        "SELECT id, tag, rev, log, part_description, size, material, uom, quantity, position"
        " FROM mto_materials WHERE typical_id = ? ORDER BY position, id",
        (typical_id,),
    ).fetchall()
    return [_serialize_row(dict(r), ucount) for r in rows]


class _CreateRowBody(BaseModel):
    cells: Optional[dict] = None


@router.post("/{tool_id}/materials/{typical_id}/rows", status_code=201)
def create_row(
    tool_id: int,
    typical_id: int,
    body: _CreateRowBody = None,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    typical = _require_typical(tool_id, typical_id, conn)
    rev = get_current_revision(conn)
    max_pos = conn.execute(
        "SELECT COALESCE(MAX(position), 0) FROM mto_materials WHERE typical_id = ?",
        (typical_id,),
    ).fetchone()[0]
    cells = (body.cells if (body and body.cells) else {}) or {}
    cur = conn.execute(
        "INSERT INTO mto_materials (typical_id, tag, rev, position,"
        " part_description, size, material, uom, quantity)"
        " VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)",
        (typical_id, rev, max_pos + 1,
         cells.get("part_description", ""), cells.get("size", ""),
         cells.get("material", ""), cells.get("uom", ""),
         cells.get("quantity", 0)),
    )
    row_id = cur.lastrowid
    conn.execute("UPDATE mto_materials SET tag = ? WHERE id = ?", (str(row_id), row_id))
    conn.commit()
    row = dict(conn.execute(
        "SELECT id, tag, rev, log, part_description, size, material, uom, quantity, position"
        " FROM mto_materials WHERE id = ?", (row_id,)
    ).fetchone())
    ucount = _utility_count(tool_id, typical["name"], conn)
    return _serialize_row(row, ucount)


# ---------------------------------------------------------------------------
# Rows — Cell Update
# ---------------------------------------------------------------------------

class _CellUpdate(BaseModel):
    slug: str
    value: Any


@router.patch("/{tool_id}/materials/{typical_id}/rows/{row_id}/cell")
def update_cell(
    tool_id: int,
    typical_id: int,
    row_id: int,
    body: _CellUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    typical = _require_typical(tool_id, typical_id, conn)
    if body.slug not in _EDITABLE:
        raise HTTPException(status_code=422, detail=f"'{body.slug}' is not editable")
    existing = _require_row(typical_id, row_id, conn)
    rev = get_current_revision(conn)
    old_val = existing.get(body.slug)
    log_entry = format_log_entry(rev, body.slug, old_val, body.value)
    new_log = append_log(existing.get("log") or "", log_entry)
    conn.execute(
        f"UPDATE mto_materials SET {body.slug} = ?, rev = ?, log = ? WHERE id = ?",
        (body.value, rev, new_log, row_id),
    )
    conn.commit()
    ucount = _utility_count(tool_id, typical["name"], conn)
    row = dict(conn.execute(
        "SELECT id, tag, rev, log, part_description, size, material, uom, quantity, position"
        " FROM mto_materials WHERE id = ?", (row_id,)
    ).fetchone())
    return _serialize_row(row, ucount)


# ---------------------------------------------------------------------------
# Rows — Delete / Restore / Hard-Delete
# ---------------------------------------------------------------------------

@router.post("/{tool_id}/materials/{typical_id}/rows/{row_id}/delete")
def soft_delete_row(
    tool_id: int,
    typical_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    row = _require_row(typical_id, row_id, conn)
    conn.execute("DELETE FROM mto_materials WHERE id = ? AND typical_id = ?", (row_id, typical_id))
    conn.commit()
    return {"ok": True}


@router.post("/{tool_id}/materials/{typical_id}/rows/{row_id}/restore")
def restore_row(
    tool_id: int,
    typical_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    # No soft-delete in MTO materials — no-op
    raise HTTPException(status_code=404, detail="Row not found")


@router.post("/{tool_id}/materials/{typical_id}/rows/{row_id}/hard-delete")
def hard_delete_row(
    tool_id: int,
    typical_id: int,
    row_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    _require_row(typical_id, row_id, conn)
    conn.execute("DELETE FROM mto_materials WHERE id = ? AND typical_id = ?", (row_id, typical_id))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Rows — Reorder (drag-to-reorder contract)
# ---------------------------------------------------------------------------

class _ReorderBody(BaseModel):
    anchor_row_id: int
    placement: str  # "before" | "after"


@router.post("/{tool_id}/materials/{typical_id}/rows/{row_id}/reorder")
def reorder_row(
    tool_id: int,
    typical_id: int,
    row_id: int,
    body: _ReorderBody,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    _require_row(typical_id, row_id, conn)
    _require_row(typical_id, body.anchor_row_id, conn)

    rows = conn.execute(
        "SELECT id FROM mto_materials WHERE typical_id = ? ORDER BY position, id",
        (typical_id,),
    ).fetchall()
    ids = [r["id"] for r in rows]

    ids.remove(row_id)
    anchor_idx = ids.index(body.anchor_row_id)
    insert_at = anchor_idx + 1 if body.placement == "after" else anchor_idx
    ids.insert(insert_at, row_id)

    for pos, rid in enumerate(ids):
        conn.execute(
            "UPDATE mto_materials SET position = ? WHERE id = ? AND typical_id = ?",
            (pos, rid, typical_id),
        )
    conn.commit()
    return {"ok": True}
