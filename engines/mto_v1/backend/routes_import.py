"""
MTO V1 — import/export support routes.
Step 16: source DB browser. Step 17: import one typical.
"""

import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dashboard.project_db import get_project_conn

router = APIRouter()

# System columns that are never copied verbatim; handled explicitly on insert.
_SKIP_ON_COPY = {"id", "typical_id"}

_MTO_TABLES = {"mto_typicals", "mto_materials"}


def _open_source_db(db_path_str: str) -> tuple[sqlite3.Connection, Path]:
    """Open an external SQLite file with path-traversal protection."""
    raw = Path(db_path_str)
    # Resolve to absolute; rejects relative traversal tricks
    try:
        resolved = raw.resolve(strict=True)
    except (OSError, RuntimeError):
        raise HTTPException(status_code=404, detail="Source DB file not found")
    if resolved.suffix.lower() != ".db":
        raise HTTPException(status_code=400, detail="Source path must be a .db file")
    try:
        conn = sqlite3.connect(str(resolved))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot open file as SQLite database")
    return conn, resolved


def _check_mto_tables(conn: sqlite3.Connection) -> None:
    existing = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    missing = _MTO_TABLES - existing
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Not an MTO project database — missing tables: {', '.join(sorted(missing))}",
        )


@router.get("/import/list")
def list_source_typicals(db_path: str = Query(...)):
    """
    Browse an external project DB and return its MTO typicals with
    material row counts and image presence flag.
    """
    conn, _ = _open_source_db(db_path)
    try:
        _check_mto_tables(conn)
        typicals = conn.execute(
            "SELECT id, name, description, position FROM mto_typicals ORDER BY position, id"
        ).fetchall()
        result = []
        for t in typicals:
            mat_count = conn.execute(
                "SELECT COUNT(*) FROM mto_materials WHERE typical_id = ?", (t["id"],)
            ).fetchone()[0]
            img_row = conn.execute(
                "SELECT format FROM mto_images WHERE typical_id = ? LIMIT 1", (t["id"],)
            ).fetchone()
            has_image = img_row is not None
            image_format = img_row["format"].lower() if img_row else None
            result.append({
                "id": t["id"],
                "name": t["name"],
                "description": t["description"] or "",
                "position": t["position"],
                "material_count": mat_count,
                "has_image": has_image,
                "image_format": image_format,
            })
        return {"typicals": result}
    finally:
        conn.close()


class _ImportBody(BaseModel):
    source_db_path: str
    source_typical_id: int
    target_typical_name: str


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [r[1] for r in rows]


@router.post("/{tool_id}/import", status_code=201)
def import_typical(
    tool_id: int,
    body: _ImportBody,
    dest: sqlite3.Connection = Depends(get_project_conn),
):
    """
    Import one typical from an external project DB into the current project.
    Creates the target typical if it does not already exist.
    """
    if not dest.execute(
        "SELECT 1 FROM _tools WHERE id = ? AND tool_type = 'mto'", (tool_id,)
    ).fetchone():
        raise HTTPException(status_code=404, detail="MTO tool not found")

    src, _ = _open_source_db(body.source_db_path)
    try:
        _check_mto_tables(src)

        # --- read source typical ---
        src_typical = src.execute(
            "SELECT * FROM mto_typicals WHERE id = ?", (body.source_typical_id,)
        ).fetchone()
        if not src_typical:
            raise HTTPException(status_code=404, detail="Source typical not found")

        # --- find or create destination typical ---
        dest_typical = dest.execute(
            "SELECT id FROM mto_typicals WHERE tool_id = ? AND name = ?",
            (tool_id, body.target_typical_name),
        ).fetchone()

        if dest_typical:
            dest_typical_id = dest_typical["id"]
            # Clear existing data so import is idempotent
            dest.execute("DELETE FROM mto_materials WHERE typical_id = ?", (dest_typical_id,))
            dest.execute("DELETE FROM mto_images WHERE typical_id = ?", (dest_typical_id,))
            dest.execute("DELETE FROM mto_tag_placements WHERE typical_id = ?", (dest_typical_id,))
        else:
            max_pos = dest.execute(
                "SELECT COALESCE(MAX(position), 0) FROM mto_typicals WHERE tool_id = ?",
                (tool_id,),
            ).fetchone()[0]
            dest.execute(
                "INSERT INTO mto_typicals (tool_id, name, description, position) VALUES (?,?,?,?)",
                (tool_id, body.target_typical_name, dict(src_typical).get("description") or "", max_pos + 1),
            )
            dest_typical_id = dest.execute("SELECT last_insert_rowid()").fetchone()[0]

        # --- copy materials (map by column name, skip id/typical_id) ---
        src_mat_cols = set(_table_columns(src, "mto_materials")) - _SKIP_ON_COPY
        dest_mat_cols = set(_table_columns(dest, "mto_materials")) - _SKIP_ON_COPY
        shared_cols = [c for c in _table_columns(src, "mto_materials") if c in src_mat_cols & dest_mat_cols]

        src_rows = src.execute(
            f"SELECT {', '.join(shared_cols)} FROM mto_materials WHERE typical_id = ? ORDER BY position, id",
            (body.source_typical_id,),
        ).fetchall()

        placeholders = ", ".join("?" for _ in shared_cols)
        col_list = ", ".join(shared_cols)
        for row in src_rows:
            dest.execute(
                f"INSERT INTO mto_materials (typical_id, {col_list}) VALUES (?, {placeholders})",
                (dest_typical_id, *[row[c] for c in shared_cols]),
            )

        # --- copy image (if present) ---
        src_image = src.execute(
            "SELECT filename, format, content FROM mto_images WHERE typical_id = ? LIMIT 1",
            (body.source_typical_id,),
        ).fetchone()
        if src_image:
            dest.execute(
                "INSERT INTO mto_images (typical_id, filename, format, content) VALUES (?,?,?,?)",
                (dest_typical_id, src_image["filename"], src_image["format"], src_image["content"]),
            )

        # --- copy tag placements ---
        src_placements = src.execute(
            "SELECT tag, label_x, label_y, arrow_x, arrow_y FROM mto_tag_placements WHERE typical_id = ?",
            (body.source_typical_id,),
        ).fetchall()
        for p in src_placements:
            dest.execute(
                "INSERT INTO mto_tag_placements (typical_id, tag, label_x, label_y, arrow_x, arrow_y)"
                " VALUES (?,?,?,?,?,?)",
                (dest_typical_id, p["tag"], p["label_x"], p["label_y"], p["arrow_x"], p["arrow_y"]),
            )

        dest.commit()
        return {"typical_id": dest_typical_id, "name": body.target_typical_name}

    finally:
        src.close()


_MIME = {"svg": "image/svg+xml", "pdf": "application/pdf", "dxf": "application/dxf"}


@router.get("/import/image")
def get_import_image(db_path: str = Query(...), typical_id: int = Query(...)):
    """Return the raw image BLOB from an external source DB (used for import panel thumbnails)."""
    from fastapi.responses import Response

    conn, _ = _open_source_db(db_path)
    try:
        _check_mto_tables(conn)
        row = conn.execute(
            "SELECT format, content FROM mto_images WHERE typical_id = ? LIMIT 1",
            (typical_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No image for this typical")
        mime = _MIME.get(row["format"].lower(), "application/octet-stream")
        return Response(content=bytes(row["content"]), media_type=mime)
    finally:
        conn.close()
