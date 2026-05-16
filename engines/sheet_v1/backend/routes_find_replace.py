"""
Sheet V1 — find/replace and column autocomplete endpoints.
"""

import sqlite3
from fastapi import APIRouter, Depends, Query
from dashboard.project_db import get_project_conn
from .service_find_replace import find_replace_cells, get_column_values
from .schemas import FindReplaceRequest

router = APIRouter(prefix="/api/engines", tags=["engine"])


@router.post("/{tool_id}/find_replace")
def find_replace(
    tool_id: int,
    body: FindReplaceRequest,
    db: str = Query(...),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return find_replace_cells(
        conn, tool_id, None,
        search=body.search,
        replacement=body.replacement,
        match_case=body.match_case,
        match_entire_cell=body.match_entire_cell,
        scope=body.scope,
    )


@router.get("/{tool_id}/column_values/{col_slug}")
def column_values(
    tool_id: int,
    col_slug: str,
    prefix: str = Query(""),
    limit: int = Query(20, ge=1, le=100),
    db: str = Query(...),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return get_column_values(conn, tool_id, col_slug, prefix, limit)
