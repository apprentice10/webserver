"""
Sheet V1 — undo/redo endpoints.
"""

import sqlite3
from fastapi import APIRouter, Depends, Query
from dashboard.project_db import get_project_conn
from .service_undo import do_undo, do_redo, get_stack_sizes

router = APIRouter(prefix="/api/engines", tags=["engine"])


@router.post("/{tool_id}/undo")
def undo(
    tool_id: int,
    db: str = Query(...),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return do_undo(conn, tool_id)


@router.post("/{tool_id}/redo")
def redo(
    tool_id: int,
    db: str = Query(...),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return do_redo(conn, tool_id)


@router.get("/{tool_id}/undo-state")
def undo_state(tool_id: int, db: str = Query(...)):
    return get_stack_sizes(tool_id)
