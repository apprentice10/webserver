"""
dashboard/routes_toolkit.py
---------------------------
Shared toolkit-config endpoints — engine-agnostic, project-DB backed.
"""

import json
import sqlite3
from fastapi import APIRouter, Depends, HTTPException
from dashboard.project_db import get_project_conn

router = APIRouter(prefix="/api/engines", tags=["toolkit"])


@router.get("/{slug}/tools/{tool_id}/toolkit-config")
def get_toolkit_config(
    slug: str,
    tool_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    """Return merged toolkit config for a tool instance: { [toolkit_id]: parsed_config }."""
    rows = conn.execute(
        "SELECT toolkit_id, config_json FROM _toolkit_config WHERE tool_id = ?",
        (tool_id,)
    ).fetchall()
    result = {}
    for row in rows:
        try:
            result[row["toolkit_id"]] = json.loads(row["config_json"])
        except Exception:
            result[row["toolkit_id"]] = {}
    return result
