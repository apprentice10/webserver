"""
dashboard/routes_images.py
---------------------------
Updated: 2026-05-19 15:00
Image endpoints for Drawing Toolkit.
Mounted at /api/engines/{slug}/tools/{tool_id}/images/
"""

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from dashboard.images import (
    ALLOWED_MIME_TYPES,
    create_image,
    delete_image,
    get_image_blob,
    list_images,
    replace_image_blob,
)
from dashboard.project_db import get_project_conn

router = APIRouter(prefix="/api/engines", tags=["images"])


@router.get("/{slug}/tools/{tool_id}/images")
def list_tool_images(
    slug: str,
    tool_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return list_images(conn, tool_id)


@router.post("/{slug}/tools/{tool_id}/images/upload")
async def upload_image(
    slug: str,
    tool_id: str,
    file: UploadFile = File(...),
    name: str = Form(...),
    source_width: Optional[int] = Form(None),
    source_height: Optional[int] = Form(None),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{mime_type}'. Allowed: {sorted(ALLOWED_MIME_TYPES)}",
        )
    blob_bytes = await file.read()
    image_id = create_image(conn, tool_id, name, mime_type, blob_bytes, source_width, source_height)
    return {"ok": True, "id": image_id, "name": name, "mime_type": mime_type}


@router.get("/{slug}/tools/{tool_id}/images/{image_id}/blob")
def get_blob(
    slug: str,
    tool_id: str,
    image_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    result = get_image_blob(conn, image_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Image not found")
    blob_bytes, mime_type = result
    return Response(content=blob_bytes, media_type=mime_type)


@router.delete("/{slug}/tools/{tool_id}/images/{image_id}")
def delete_tool_image(
    slug: str,
    tool_id: str,
    image_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    if not delete_image(conn, image_id):
        raise HTTPException(status_code=404, detail="Image not found")
    return {"ok": True, "id": image_id}


@router.patch("/{slug}/tools/{tool_id}/images/{image_id}")
async def replace_tool_image(
    slug: str,
    tool_id: str,
    image_id: str,
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    mime_type = file.content_type or ""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{mime_type}'. Allowed: {sorted(ALLOWED_MIME_TYPES)}",
        )
    blob_bytes = await file.read()
    if not replace_image_blob(conn, image_id, blob_bytes, mime_type):
        raise HTTPException(status_code=404, detail="Image not found")
    return {"ok": True, "id": image_id, "mime_type": mime_type}
