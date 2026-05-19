"""
dashboard/routes_toolkit.py
---------------------------
Updated: 2026-05-19 10:00
Shared toolkit endpoints — engine-agnostic, project-DB backed.
Handles per-instance config fetch, catalog table bootstrap, and catalog snapshot.
"""

import json
import re
import sqlite3
from fastapi import APIRouter, Depends
from dashboard.project_db import get_project_conn

router = APIRouter(prefix="/api/engines", tags=["toolkit"])


def _catalog_table(tool_id: str) -> str:
    return "catalog_" + re.sub(r"[^a-zA-Z0-9]", "_", str(tool_id))


@router.get("/{slug}/tools/{tool_id}/toolkit-config")
def get_toolkit_config(
    slug: str,
    tool_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    """
    Return toolkit config + catalog snapshot for a tool instance.
    Side-effect: bootstraps catalog_{tool_id} table (idempotent).
    Response: { config: { [toolkit_id]: {...} }, catalog_snapshot: { [tag]: {...} } }
    """
    tbl = _catalog_table(tool_id)
    conn.execute(f"""CREATE TABLE IF NOT EXISTS {tbl} (
        tag       TEXT PRIMARY KEY NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{{}}'
    )""")
    conn.commit()

    rows = conn.execute(
        "SELECT toolkit_id, config_json FROM _toolkit_config WHERE tool_id = ?",
        (tool_id,)
    ).fetchall()
    config = {}
    for row in rows:
        try:
            config[row["toolkit_id"]] = json.loads(row["config_json"])
        except Exception:
            config[row["toolkit_id"]] = {}

    catalog_rows = conn.execute(f"SELECT tag, data_json FROM {tbl}").fetchall()
    catalog_snapshot = {}
    for r in catalog_rows:
        try:
            catalog_snapshot[r["tag"]] = json.loads(r["data_json"])
        except Exception:
            catalog_snapshot[r["tag"]] = {}

    return {"config": config, "catalog_snapshot": catalog_snapshot}
