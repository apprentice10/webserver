"""
engine/routes_flags.py
-----------------------
Flag and cell-flag endpoints. Extracted from engine/routes.py (P3-002).
Router uses the same /api/engines prefix as the main engine router.
"""

import sqlite3
from fastapi import APIRouter, Depends, HTTPException

from dashboard.project_db import get_project_conn
from . import service
from .schemas import FlagCreate, FlagUpdate, CellFlagToggleRequest, CellFlagNoteUpdate, ConditionalFlagRuleCreate

router = APIRouter(prefix="/api/engines", tags=["engine"])


@router.get("/flags")
def list_flags(conn: sqlite3.Connection = Depends(get_project_conn)):
    rows = conn.execute(
        "SELECT id, name, color, is_system FROM _flags ORDER BY is_system ASC, name ASC"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/flags", status_code=201)
def create_flag(
    data: FlagCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    try:
        cur = conn.execute(
            "INSERT INTO _flags (name, color, is_system) VALUES (?, ?, 0)",
            (data.name.strip(), data.color),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, name, color, is_system FROM _flags WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Flag '{data.name}' already exists")


@router.patch("/flags/{flag_id}")
def update_flag(
    flag_id: int,
    data: FlagUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    flag = conn.execute(
        "SELECT id, name, color, is_system FROM _flags WHERE id = ?", (flag_id,)
    ).fetchone()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")
    if flag["is_system"] and data.name is not None:
        raise HTTPException(status_code=400, detail="Cannot rename system flags")
    new_name  = data.name.strip() if data.name  is not None else flag["name"]
    new_color = data.color         if data.color is not None else flag["color"]
    try:
        conn.execute("UPDATE _flags SET name = ?, color = ? WHERE id = ?", (new_name, new_color, flag_id))
        conn.commit()
        row = conn.execute(
            "SELECT id, name, color, is_system FROM _flags WHERE id = ?", (flag_id,)
        ).fetchone()
        return dict(row)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Flag name '{new_name}' already exists")


@router.delete("/flags/{flag_id}", status_code=204)
def delete_flag(
    flag_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    flag = conn.execute(
        "SELECT id, is_system FROM _flags WHERE id = ?", (flag_id,)
    ).fetchone()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")
    if flag["is_system"]:
        raise HTTPException(status_code=400, detail="Cannot delete system flags")
    conn.execute("DELETE FROM _flags WHERE id = ?", (flag_id,))
    conn.commit()


@router.post("/{tool_id}/cell-flags/toggle", status_code=200)
def toggle_cell_flags(
    tool_id: int,
    data:    CellFlagToggleRequest = ...,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    tool      = service.get_engine(conn, tool_id)
    tool_slug = tool["slug"]

    flag = conn.execute(
        "SELECT id, is_system FROM _flags WHERE id = ?", (data.flag_id,)
    ).fetchone()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")
    if flag["is_system"]:
        raise HTTPException(status_code=400, detail="Cannot assign system flags manually")

    row_tags = [c.row_tag for c in data.cells]
    placeholders = ",".join("?" * len(row_tags))
    existing = conn.execute(
        f"""SELECT row_tag, col_slug FROM _cell_flags
            WHERE tool_slug = ? AND flag_id = ?
            AND row_tag IN ({placeholders})""",
        [tool_slug, data.flag_id] + row_tags,
    ).fetchall()

    existing_set = {(r["row_tag"], r["col_slug"]) for r in existing}
    all_have = all((c.row_tag, c.col_slug) in existing_set for c in data.cells)

    if all_have:
        for c in data.cells:
            conn.execute(
                "DELETE FROM _cell_flags WHERE tool_slug=? AND row_tag=? AND col_slug=? AND flag_id=?",
                (tool_slug, c.row_tag, c.col_slug, data.flag_id),
            )
        action = "removed"
    else:
        for c in data.cells:
            if (c.row_tag, c.col_slug) not in existing_set:
                conn.execute(
                    "INSERT OR IGNORE INTO _cell_flags (tool_slug, row_tag, col_slug, flag_id, note) VALUES (?,?,?,?,?)",
                    (tool_slug, c.row_tag, c.col_slug, data.flag_id, data.note),
                )
        action = "added"

    conn.commit()
    return {"action": action, "flag_id": data.flag_id, "cells_affected": len(data.cells)}


@router.patch("/{tool_id}/cell-flags/note", status_code=200)
def update_cell_flag_note(
    tool_id: int,
    data:    CellFlagNoteUpdate,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    tool      = service.get_engine(conn, tool_id)
    tool_slug = tool["slug"]
    for c in data.cells:
        conn.execute(
            "UPDATE _cell_flags SET note = ? WHERE tool_slug = ? AND row_tag = ? AND col_slug = ? AND flag_id = ?",
            (data.note, tool_slug, c.row_tag, c.col_slug, data.flag_id),
        )
    conn.commit()
    return {"flag_id": data.flag_id, "note": data.note, "cells_affected": len(data.cells)}


# ── Conditional flag rules ────────────────────────────────────

@router.get("/{tool_id}/flag-rules")
def list_flag_rules(
    tool_id: int,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    tool = service.get_engine(conn, tool_id)
    rows = conn.execute(
        """SELECT r.id, r.col_slug, r.flag_id, r.operator, r.value, f.name AS flag_name, f.color AS flag_color
           FROM _conditional_flag_rules r
           JOIN _flags f ON f.id = r.flag_id
           WHERE r.tool_slug = ?
           ORDER BY r.id""",
        (tool["slug"],)
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{tool_id}/flag-rules", status_code=201)
def create_flag_rule(
    tool_id: int,
    data:    ConditionalFlagRuleCreate,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    tool = service.get_engine(conn, tool_id)
    valid_ops = {"contains", "equals", "is_empty", "starts_with", "matches_wildcard"}
    if data.operator not in valid_ops:
        raise HTTPException(status_code=400, detail=f"Invalid operator '{data.operator}'")
    flag = conn.execute("SELECT id FROM _flags WHERE id = ?", (data.flag_id,)).fetchone()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")
    cur = conn.execute(
        "INSERT INTO _conditional_flag_rules (tool_slug, col_slug, flag_id, operator, value) VALUES (?,?,?,?,?)",
        (tool["slug"], data.col_slug, data.flag_id, data.operator, data.value),
    )
    conn.commit()
    row = conn.execute(
        """SELECT r.id, r.col_slug, r.flag_id, r.operator, r.value, f.name AS flag_name, f.color AS flag_color
           FROM _conditional_flag_rules r JOIN _flags f ON f.id = r.flag_id WHERE r.id = ?""",
        (cur.lastrowid,)
    ).fetchone()
    return dict(row)


@router.delete("/{tool_id}/flag-rules/{rule_id}", status_code=204)
def delete_flag_rule(
    tool_id: int,
    rule_id: int,
    conn:    sqlite3.Connection = Depends(get_project_conn),
):
    tool = service.get_engine(conn, tool_id)
    conn.execute(
        "DELETE FROM _conditional_flag_rules WHERE id = ? AND tool_slug = ?",
        (rule_id, tool["slug"])
    )
    conn.commit()
