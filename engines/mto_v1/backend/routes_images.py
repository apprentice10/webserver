"""MTO V1 — image upload/download/delete for a typical (one image per typical)."""
import sqlite3
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response

from dashboard.project_db import get_project_conn

router = APIRouter()

_ALLOWED = {
    "svg": "image/svg+xml",
    "dxf": "application/octet-stream",
    "pdf": "application/pdf",
}


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _require_typical(tool_id: int, typical_id: int, conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT id FROM mto_typicals WHERE id = ? AND tool_id = ?",
        (typical_id, tool_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Typical not found")


@router.post("/{tool_id}/images/{typical_id}", status_code=201)
async def upload_image(
    tool_id: int,
    typical_id: int,
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    ext = _ext(file.filename or "")
    if ext not in _ALLOWED:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format '{ext}'. Allowed: SVG, DXF, PDF.",
        )
    content = await file.read()
    conn.execute(
        "DELETE FROM mto_images WHERE typical_id = ?",
        (typical_id,),
    )
    conn.execute(
        "INSERT INTO mto_images (typical_id, filename, format, content) VALUES (?, ?, ?, ?)",
        (typical_id, file.filename, ext, content),
    )
    conn.commit()
    return {"filename": file.filename, "format": ext, "size": len(content)}


@router.get("/{tool_id}/images/{typical_id}")
def get_image(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    row = conn.execute(
        "SELECT filename, format, content FROM mto_images WHERE typical_id = ?",
        (typical_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No image for this typical")
    mime = _ALLOWED.get(row["format"], "application/octet-stream")
    return Response(
        content=bytes(row["content"]),
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{row["filename"]}"'},
    )


@router.delete("/{tool_id}/images/{typical_id}", status_code=204)
def delete_image(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    _require_typical(tool_id, typical_id, conn)
    conn.execute("DELETE FROM mto_images WHERE typical_id = ?", (typical_id,))
    conn.commit()


@router.get("/{tool_id}/images/{typical_id}/meta")
def get_image_meta(
    tool_id: int,
    typical_id: int,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    """Returns filename and format without the BLOB — used by the frontend to know if an image exists."""
    _require_typical(tool_id, typical_id, conn)
    row = conn.execute(
        "SELECT filename, format FROM mto_images WHERE typical_id = ?",
        (typical_id,),
    ).fetchone()
    if not row:
        return {"exists": False}
    return {"exists": True, "filename": row["filename"], "format": row["format"]}
