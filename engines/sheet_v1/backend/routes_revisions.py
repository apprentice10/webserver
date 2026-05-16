"""
engine/routes_revisions.py
---------------------------
Revision CRUD endpoints: list, create, delete latest, revert.
Prefix: /api/project
"""

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from dashboard.project_db import get_project_conn
from dashboard.utils import now_str

router = APIRouter(prefix="/api/project", tags=["revisions"])


class RevisionCreate(BaseModel):
    description: Optional[str] = None
    author: Optional[str] = None


# ============================================================
# HELPERS
# ============================================================

def _snapshot_all_tools(conn: sqlite3.Connection, revision_id: int) -> None:
    """Capture columns + rows for every tool into _revision_snapshots."""
    tools = conn.execute("SELECT slug FROM _tools").fetchall()
    for tool in tools:
        slug = tool["slug"]
        columns = conn.execute(
            "SELECT * FROM _columns WHERE tool_slug = ? ORDER BY position",
            (slug,),
        ).fetchall()
        rows = conn.execute(f'SELECT * FROM "{slug}"').fetchall()
        conn.execute(
            "INSERT INTO _revision_snapshots (revision_id, tool_slug, columns_json, rows_json) VALUES (?, ?, ?, ?)",
            (
                revision_id,
                slug,
                json.dumps([dict(c) for c in columns]),
                json.dumps([dict(r) for r in rows]),
            ),
        )


def _latest_revision(conn: sqlite3.Connection) -> sqlite3.Row:
    row = conn.execute(
        "SELECT id, number FROM _revisions ORDER BY number DESC LIMIT 1"
    ).fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="No revisions found — corrupted project")
    return row


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/revisions")
def list_revisions(conn: sqlite3.Connection = Depends(get_project_conn)):
    rows = conn.execute(
        "SELECT id, number, created_at, description, author FROM _revisions ORDER BY number ASC"
    ).fetchall()
    current = conn.execute("SELECT MAX(number) AS n FROM _revisions").fetchone()["n"] or 0
    return {"current": current, "revisions": [dict(r) for r in rows]}


@router.post("/revision", status_code=201)
def create_revision(
    data: RevisionCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    latest = _latest_revision(conn)
    _snapshot_all_tools(conn, latest["id"])
    new_number = latest["number"] + 1
    cur = conn.execute(
        "INSERT INTO _revisions (number, created_at, description, author) VALUES (?, ?, ?, ?)",
        (new_number, now_str(), data.description or "", data.author or ""),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id, number, created_at, description, author FROM _revisions WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return dict(row)


@router.delete("/revision/{number}", status_code=200)
def delete_revision(
    number: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    latest = _latest_revision(conn)
    if latest["number"] != number:
        raise HTTPException(status_code=400, detail="Only the latest revision can be deleted")

    previous = conn.execute(
        "SELECT id, number FROM _revisions WHERE number = ?", (number - 1,)
    ).fetchone()
    if not previous:
        raise HTTPException(status_code=400, detail="Cannot delete revision 0 — no previous revision exists")

    prev_num = previous["number"]
    rev_id = latest["id"]

    # Retag live rows in all tool tables
    for (tbl,) in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\'"
    ).fetchall():
        col_names = {r[1] for r in conn.execute(f'PRAGMA table_info("{tbl}")')}
        if "rev" in col_names:
            conn.execute(f'UPDATE "{tbl}" SET rev = ? WHERE rev = ?', (prev_num, number))

    conn.execute(
        "UPDATE _audit SET revision = ? WHERE revision = ?",
        (str(prev_num), str(number)),
    )
    conn.execute("DELETE FROM _revision_snapshots WHERE revision_id = ?", (rev_id,))
    conn.execute("DELETE FROM _revisions WHERE id = ?", (rev_id,))
    conn.commit()
    return {"deleted": number, "merged_into": prev_num}


@router.get("/revision/{number}/tool/{tool_slug}")
def get_revision_snapshot(
    number: int,
    tool_slug: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    revision = conn.execute(
        "SELECT id FROM _revisions WHERE number = ?", (number,)
    ).fetchone()
    if not revision:
        raise HTTPException(status_code=404, detail=f"Revision {number} not found")

    snap = conn.execute(
        "SELECT columns_json, rows_json FROM _revision_snapshots WHERE revision_id = ? AND tool_slug = ?",
        (revision["id"], tool_slug),
    ).fetchone()
    if not snap:
        raise HTTPException(
            status_code=404,
            detail=f"No snapshot for revision {number}, tool '{tool_slug}'",
        )

    return {
        "columns": json.loads(snap["columns_json"]),
        "rows": json.loads(snap["rows_json"]),
    }


@router.post("/revision/{number}/revert", status_code=200)
def revert_revision(
    number: int,
    request: Request,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    latest = _latest_revision(conn)
    if latest["number"] == number:
        raise HTTPException(status_code=400, detail="Cannot revert to the current revision")

    target = conn.execute(
        "SELECT id, number FROM _revisions WHERE number = ?", (number,)
    ).fetchone()
    if not target:
        raise HTTPException(status_code=404, detail=f"Revision {number} not found")

    snapshots = conn.execute(
        "SELECT tool_slug, columns_json, rows_json FROM _revision_snapshots WHERE revision_id = ?",
        (target["id"],),
    ).fetchall()
    if not snapshots:
        raise HTTPException(
            status_code=404,
            detail=f"No snapshot found for revision {number}. Cannot revert.",
        )

    # Safety backup before destructive operation
    db_raw = request.query_params.get("db")
    db_path = Path(db_raw)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = db_path.parent / f"{db_path.stem}_discarded_rev{latest['number']}_{ts}.db"
    if not backup_path.exists():
        shutil.copy2(db_path, backup_path)

    # Restore each tool from snapshot
    for snap in snapshots:
        slug = snap["tool_slug"]
        columns = json.loads(snap["columns_json"])
        rows = json.loads(snap["rows_json"])

        conn.execute("DELETE FROM _columns WHERE tool_slug = ?", (slug,))
        for col in columns:
            conn.execute(
                """INSERT INTO _columns
                   (id, tool_id, tool_slug, slug, name, col_type, width, position, is_system, formula, lineage_info)
                   VALUES (:id, :tool_id, :tool_slug, :slug, :name, :col_type, :width, :position, :is_system, :formula, :lineage_info)""",
                col,
            )

        conn.execute(f'DELETE FROM "{slug}"')
        for row in rows:
            if not row:
                continue
            col_list = ", ".join(f'"{k}"' for k in row)
            placeholders = ", ".join("?" for _ in row)
            conn.execute(
                f'INSERT INTO "{slug}" ({col_list}) VALUES ({placeholders})',
                list(row.values()),
            )

    # Delete revisions and snapshots beyond the target
    beyond = conn.execute(
        "SELECT id FROM _revisions WHERE number > ?", (number,)
    ).fetchall()
    if beyond:
        beyond_ids = [r["id"] for r in beyond]
        ph = ",".join("?" for _ in beyond_ids)
        conn.execute(f"DELETE FROM _revision_snapshots WHERE revision_id IN ({ph})", beyond_ids)
        conn.execute("DELETE FROM _revisions WHERE number > ?", (number,))

    conn.commit()
    return {"reverted_to": number, "backup": backup_path.name}
