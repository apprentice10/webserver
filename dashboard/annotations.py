"""
dashboard/annotations.py
------------------------
Updated: 2026-05-19 16:00
Annotation service for Drawing Toolkit — CRUD on _annotations rows.
No HTTP logic — called only by routes_annotations.py.
"""

import json
import sqlite3
import uuid
from typing import Any, Dict, Optional


def _row_to_dict(row) -> Dict[str, Any]:
    d = dict(row)
    d["props"] = json.loads(d.pop("props_json") or "{}")
    raw_style = d.pop("style_json")
    d["style"] = json.loads(raw_style) if raw_style else None
    return d


def list_annotations(conn: sqlite3.Connection, image_id: str) -> list:
    rows = conn.execute(
        "SELECT id, image_id, type, row_key, page, props_json, style_json, created_at"
        " FROM _annotations WHERE image_id = ? ORDER BY created_at",
        (image_id,),
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


def create_annotation(
    conn: sqlite3.Connection,
    image_id: str,
    type_: str,
    props: Dict[str, Any],
    row_key: Optional[str] = None,
    page: Optional[int] = None,
    style: Optional[Dict[str, Any]] = None,
) -> str:
    annotation_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO _annotations (id, image_id, type, row_key, page, props_json, style_json)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            annotation_id,
            image_id,
            type_,
            row_key,
            page,
            json.dumps(props),
            json.dumps(style) if style is not None else None,
        ),
    )
    conn.commit()
    return annotation_id


def update_annotation(
    conn: sqlite3.Connection,
    annotation_id: str,
    props: Optional[Dict[str, Any]] = None,
    row_key: Optional[str] = None,
    page: Optional[int] = None,
    style: Optional[Dict[str, Any]] = None,
) -> bool:
    row = conn.execute(
        "SELECT props_json, style_json, row_key, page FROM _annotations WHERE id = ?",
        (annotation_id,),
    ).fetchone()
    if row is None:
        return False

    new_props = json.dumps(props) if props is not None else row["props_json"]
    new_style = json.dumps(style) if style is not None else row["style_json"]
    new_row_key = row_key if row_key is not None else row["row_key"]
    new_page = page if page is not None else row["page"]

    conn.execute(
        "UPDATE _annotations SET props_json = ?, style_json = ?, row_key = ?, page = ?"
        " WHERE id = ?",
        (new_props, new_style, new_row_key, new_page, annotation_id),
    )
    conn.commit()
    return True


def delete_annotation(conn: sqlite3.Connection, annotation_id: str) -> bool:
    cur = conn.execute("DELETE FROM _annotations WHERE id = ?", (annotation_id,))
    conn.commit()
    return cur.rowcount > 0
