"""
dashboard/images.py
-------------------
Updated: 2026-05-19 15:00
Image service for Drawing Toolkit — CRUD on _images rows.
Blobs are stored directly in SQLite per D-DRW-02.
"""

import sqlite3
import uuid
from typing import Optional, Tuple

ALLOWED_MIME_TYPES = {"image/svg+xml", "image/png", "image/jpeg", "application/pdf"}


def list_images(conn: sqlite3.Connection, tool_id: str) -> list:
    rows = conn.execute(
        "SELECT id, tool_id, name, mime_type, source_width, source_height, created_at"
        " FROM _images WHERE tool_id = ? ORDER BY created_at",
        (tool_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_image_blob(conn: sqlite3.Connection, image_id: str) -> Optional[Tuple[bytes, str]]:
    row = conn.execute(
        "SELECT blob, mime_type FROM _images WHERE id = ?", (image_id,)
    ).fetchone()
    if row is None:
        return None
    return bytes(row["blob"]), row["mime_type"]


def create_image(
    conn: sqlite3.Connection,
    tool_id: str,
    name: str,
    mime_type: str,
    blob_bytes: bytes,
    source_width: Optional[int] = None,
    source_height: Optional[int] = None,
) -> str:
    image_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO _images (id, tool_id, name, mime_type, blob, source_width, source_height)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (image_id, tool_id, name, mime_type, blob_bytes, source_width, source_height),
    )
    conn.commit()
    return image_id


def delete_image(conn: sqlite3.Connection, image_id: str) -> bool:
    cur = conn.execute("DELETE FROM _images WHERE id = ?", (image_id,))
    conn.commit()
    return cur.rowcount > 0


def replace_image_blob(
    conn: sqlite3.Connection,
    image_id: str,
    blob_bytes: bytes,
    mime_type: str,
) -> bool:
    # Preserves name, source_width, source_height, and all annotations (D-DRW-15)
    cur = conn.execute(
        "UPDATE _images SET blob = ?, mime_type = ? WHERE id = ?",
        (blob_bytes, mime_type, image_id),
    )
    conn.commit()
    return cur.rowcount > 0
