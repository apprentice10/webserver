"""MTO V1 — export routes: conflict-check and export-execute."""

import sqlite3
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dashboard.project_db import get_project_conn

router = APIRouter()

_SKIP_ON_COPY = {"id", "typical_id"}
_REQUIRED_DEST_TABLES = {"mto_typicals", "mto_materials", "mto_images", "mto_tag_placements"}


def _open_dest_db(db_path_str: str) -> sqlite3.Connection:
    """Open an external SQLite DB for writing with path-traversal protection."""
    raw = Path(db_path_str)
    try:
        resolved = raw.resolve(strict=True)
    except (OSError, RuntimeError):
        raise HTTPException(status_code=404, detail="Destination DB file not found")
    if resolved.suffix.lower() != ".db":
        raise HTTPException(status_code=400, detail="Destination path must be a .db file")
    try:
        conn = sqlite3.connect(str(resolved))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot open destination file as SQLite database")
    existing = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    missing = _REQUIRED_DEST_TABLES - existing
    if missing:
        conn.close()
        raise HTTPException(
            status_code=422,
            detail=f"Destination is not an MTO project database — missing tables: {', '.join(sorted(missing))}",
        )
    return conn


def _dest_tool_id(conn: sqlite3.Connection) -> int:
    """Return the first MTO tool_id found in the destination DB."""
    row = conn.execute("SELECT id FROM _tools WHERE tool_type = 'mto' LIMIT 1").fetchone()
    if not row:
        raise HTTPException(
            status_code=422,
            detail="Destination DB has no MTO tool instance — open the destination project first.",
        )
    return row["id"]


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


# ── Check endpoint ────────────────────────────────────────────────────────────

@router.get("/export/check")
def export_check(
    dest_db_path: str = Query(...),
    names: list[str] = Query(default=[]),
):
    """Return which of the given typical names already exist in the destination DB."""
    if not names:
        return {"conflicts": []}
    conn = _open_dest_db(dest_db_path)
    try:
        placeholders = ", ".join("?" for _ in names)
        rows = conn.execute(
            f"SELECT name FROM mto_typicals WHERE name IN ({placeholders})", names
        ).fetchall()
        return {"conflicts": [r["name"] for r in rows]}
    finally:
        conn.close()


# ── Export endpoint ───────────────────────────────────────────────────────────

class _ExportBody(BaseModel):
    dest_db_path: str
    typical_ids: list[int]
    conflict_strategy: Literal["overwrite", "rename"] = "overwrite"
    rename_map: dict[str, str] = {}  # str(typical_id) → new target name


@router.post("/{tool_id}/export")
def export_typicals(
    tool_id: int,
    body: _ExportBody,
    src: sqlite3.Connection = Depends(get_project_conn),
):
    """Export one or more typicals from the current MTO tool to an external project DB."""
    if not src.execute(
        "SELECT 1 FROM _tools WHERE id = ? AND tool_type = 'mto'", (tool_id,)
    ).fetchone():
        raise HTTPException(status_code=404, detail="MTO tool not found")

    dest = _open_dest_db(body.dest_db_path)
    results = []
    try:
        dest_tool = _dest_tool_id(dest)
        src_mat_cols = set(_table_columns(src, "mto_materials")) - _SKIP_ON_COPY
        dest_mat_cols = set(_table_columns(dest, "mto_materials")) - _SKIP_ON_COPY
        shared_cols = [c for c in _table_columns(src, "mto_materials") if c in src_mat_cols & dest_mat_cols]

        for tid in body.typical_ids:
            src_typ = src.execute(
                "SELECT * FROM mto_typicals WHERE id = ? AND tool_id = ?", (tid, tool_id)
            ).fetchone()
            if not src_typ:
                results.append({"typical_id": tid, "name": None, "ok": False, "error": "Typical not found"})
                continue
            target_name = body.rename_map.get(str(tid)) or src_typ["name"]
            try:
                _copy_one(src, dest, tid, src_typ, dest_tool, target_name,
                          body.conflict_strategy, shared_cols)
                results.append({"typical_id": tid, "name": target_name, "ok": True})
            except ValueError as exc:
                results.append({"typical_id": tid, "name": target_name, "ok": False, "error": str(exc)})

        dest.commit()
    finally:
        dest.close()

    return {"results": results}


def _copy_one(
    src: sqlite3.Connection,
    dest: sqlite3.Connection,
    src_typical_id: int,
    src_typ,
    dest_tool_id: int,
    target_name: str,
    conflict_strategy: str,
    shared_mat_cols: list[str],
) -> None:
    dest_row = dest.execute(
        "SELECT id FROM mto_typicals WHERE name = ? AND tool_id = ?",
        (target_name, dest_tool_id),
    ).fetchone()

    if dest_row:
        if conflict_strategy != "overwrite":
            raise ValueError(f'"{target_name}" already exists in the destination')
        dest_tid = dest_row["id"]
        dest.execute("DELETE FROM mto_materials WHERE typical_id = ?", (dest_tid,))
        dest.execute("DELETE FROM mto_images WHERE typical_id = ?", (dest_tid,))
        dest.execute("DELETE FROM mto_tag_placements WHERE typical_id = ?", (dest_tid,))
        dest.execute(
            "UPDATE mto_typicals SET description = ? WHERE id = ?",
            (src_typ["description"] or "", dest_tid),
        )
    else:
        max_pos = dest.execute(
            "SELECT COALESCE(MAX(position), 0) FROM mto_typicals WHERE tool_id = ?",
            (dest_tool_id,),
        ).fetchone()[0]
        cur = dest.execute(
            "INSERT INTO mto_typicals (tool_id, name, description, position) VALUES (?,?,?,?)",
            (dest_tool_id, target_name, src_typ["description"] or "", max_pos + 1),
        )
        dest_tid = cur.lastrowid

    if shared_mat_cols:
        col_list = ", ".join(shared_mat_cols)
        phs = ", ".join("?" for _ in shared_mat_cols)
        for row in src.execute(
            f"SELECT {col_list} FROM mto_materials WHERE typical_id = ? ORDER BY position, id",
            (src_typical_id,),
        ).fetchall():
            dest.execute(
                f"INSERT INTO mto_materials (typical_id, {col_list}) VALUES (?, {phs})",
                (dest_tid, *[row[c] for c in shared_mat_cols]),
            )

    src_img = src.execute(
        "SELECT filename, format, content FROM mto_images WHERE typical_id = ? LIMIT 1",
        (src_typical_id,),
    ).fetchone()
    if src_img:
        dest.execute(
            "INSERT INTO mto_images (typical_id, filename, format, content) VALUES (?,?,?,?)",
            (dest_tid, src_img["filename"], src_img["format"], bytes(src_img["content"])),
        )

    for p in src.execute(
        "SELECT tag, label_x, label_y, arrow_x, arrow_y FROM mto_tag_placements WHERE typical_id = ?",
        (src_typical_id,),
    ).fetchall():
        dest.execute(
            "INSERT INTO mto_tag_placements (typical_id, tag, label_x, label_y, arrow_x, arrow_y)"
            " VALUES (?,?,?,?,?,?)",
            (dest_tid, p["tag"], p["label_x"], p["label_y"], p["arrow_x"], p["arrow_y"]),
        )
