"""
dashboard/routes_catalog.py
---------------------------
Updated: 2026-05-19 10:00
Catalog CRUD endpoints — engine-agnostic, tool-local.
catalog_{tool_id} table is bootstrapped by routes_toolkit.py on first init.
"""

import json
import re
import sqlite3
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dashboard.project_db import get_project_conn

router = APIRouter(prefix="/api/engines", tags=["catalog"])


def _catalog_table(tool_id: str) -> str:
    return "catalog_" + re.sub(r"[^a-zA-Z0-9]", "_", str(tool_id))


class CatalogEntry(BaseModel):
    tag: str
    data: Dict[str, Any]
    force: bool = False


@router.get("/{slug}/tools/{tool_id}/catalog/rows")
def get_catalog_rows(
    slug: str,
    tool_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    """Return all catalog entries as grid-compatible row dicts."""
    tbl = _catalog_table(tool_id)
    rows = conn.execute(
        f"SELECT rowid, tag, data_json FROM {tbl} ORDER BY tag"
    ).fetchall()
    result = []
    for r in rows:
        row: Dict[str, Any] = {"__id": r["rowid"], "tag": r["tag"]}
        try:
            row.update(json.loads(r["data_json"]))
        except Exception:
            pass
        result.append(row)
    return result


@router.post("/{slug}/tools/{tool_id}/catalog/entry")
def upsert_catalog_entry(
    slug: str,
    tool_id: str,
    entry: CatalogEntry,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    """
    Upsert a catalog entry by TAG.
    If TAG exists and force=False: returns { ok: false, exists: true, conflict: true }.
    If force=True or new TAG: inserts/replaces; returns { ok: true, exists: bool }.
    """
    if not entry.tag:
        raise HTTPException(status_code=400, detail="tag must not be empty")

    tbl = _catalog_table(tool_id)
    existing = conn.execute(
        f"SELECT tag FROM {tbl} WHERE tag = ?", (entry.tag,)
    ).fetchone()

    if existing and not entry.force:
        return {"ok": False, "exists": True, "conflict": True, "tag": entry.tag}

    conn.execute(
        f"INSERT OR REPLACE INTO {tbl} (tag, data_json) VALUES (?, ?)",
        (entry.tag, json.dumps(entry.data)),
    )
    conn.commit()
    return {"ok": True, "exists": bool(existing), "tag": entry.tag}


@router.delete("/{slug}/tools/{tool_id}/catalog/entry/{tag}")
def delete_catalog_entry(
    slug: str,
    tool_id: str,
    tag: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    """Remove a catalog entry by TAG."""
    tbl = _catalog_table(tool_id)
    existing = conn.execute(
        f"SELECT tag FROM {tbl} WHERE tag = ?", (tag,)
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Catalog entry not found")
    conn.execute(f"DELETE FROM {tbl} WHERE tag = ?", (tag,))
    conn.commit()
    return {"ok": True, "tag": tag}
