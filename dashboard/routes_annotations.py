"""
dashboard/routes_annotations.py
---------------------------------
Updated: 2026-05-19 16:00
Annotation endpoints for Drawing Toolkit.
Mounted at /api/engines/{slug}/tools/{tool_id}/images/{image_id}/annotations/
"""

import sqlite3
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dashboard.annotations import (
    create_annotation,
    delete_annotation,
    list_annotations,
    update_annotation,
)
from dashboard.project_db import get_project_conn

router = APIRouter(prefix="/api/engines", tags=["annotations"])


class AnnotationCreate(BaseModel):
    type: str
    props: Dict[str, Any]
    row_key: Optional[str] = None
    page: Optional[int] = None
    style: Optional[Dict[str, Any]] = None


class AnnotationUpdate(BaseModel):
    props: Optional[Dict[str, Any]] = None
    row_key: Optional[str] = None
    page: Optional[int] = None
    style: Optional[Dict[str, Any]] = None


VALID_TYPES = {"pin", "arrow", "rectangle", "text"}


@router.get("/{slug}/tools/{tool_id}/images/{image_id}/annotations")
def list_tool_annotations(
    slug: str,
    tool_id: str,
    image_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    return list_annotations(conn, image_id)


@router.post("/{slug}/tools/{tool_id}/images/{image_id}/annotations")
def create_tool_annotation(
    slug: str,
    tool_id: str,
    image_id: str,
    body: AnnotationCreate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    if body.type not in VALID_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid annotation type '{body.type}'. Allowed: {sorted(VALID_TYPES)}",
        )
    annotation_id = create_annotation(
        conn, image_id, body.type, body.props, body.row_key, body.page, body.style
    )
    return {"ok": True, "id": annotation_id}


@router.patch("/{slug}/tools/{tool_id}/images/{image_id}/annotations/{annotation_id}")
def update_tool_annotation(
    slug: str,
    tool_id: str,
    image_id: str,
    annotation_id: str,
    body: AnnotationUpdate,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    if not update_annotation(conn, annotation_id, body.props, body.row_key, body.page, body.style):
        raise HTTPException(status_code=404, detail="Annotation not found")
    return {"ok": True, "id": annotation_id}


@router.delete("/{slug}/tools/{tool_id}/images/{image_id}/annotations/{annotation_id}")
def delete_tool_annotation(
    slug: str,
    tool_id: str,
    image_id: str,
    annotation_id: str,
    conn: sqlite3.Connection = Depends(get_project_conn),
):
    if not delete_annotation(conn, annotation_id):
        raise HTTPException(status_code=404, detail="Annotation not found")
    return {"ok": True, "id": annotation_id}
