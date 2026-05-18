"""MTO V1 — utilities read endpoint (read-only; ETL is the only writer)."""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException

from dashboard.project_db import get_project_conn

router = APIRouter()

_EXCLUDED = {"id", "tool_id", "typical_name"}


def _require_mto_tool(tool_id: int, conn: sqlite3.Connection) -> None:
    if not conn.execute(
        "SELECT 1 FROM _tools WHERE id = ? AND tool_type = 'mto'", (tool_id,)
    ).fetchone():
        raise HTTPException(status_code=404, detail="MTO tool not found")


@router.get("/{tool_id}/utilities")
def get_utilities(
    tool_id: int,
    typical_name: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_mto_tool(tool_id, conn)
    pragma = conn.execute("PRAGMA table_info(mto_utilities)").fetchall()
    columns = [row[1] for row in pragma if row[1] not in _EXCLUDED]
    if not columns:
        return {"columns": [], "rows": []}
    col_sql = ", ".join(columns)
    rows = conn.execute(
        f"SELECT {col_sql} FROM mto_utilities"
        " WHERE tool_id = ? AND typical_name = ? ORDER BY id",
        (tool_id, typical_name),
    ).fetchall()
    return {
        "columns": columns,
        "rows": [dict(zip(columns, r)) for r in rows],
    }
