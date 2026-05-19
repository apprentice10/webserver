---
Updated: 2026-05-19 15:00

# dashboard/images.py

**Description:** Image service for Drawing Toolkit. Thin CRUD layer over the `_images` system table. No HTTP logic — called only by `routes_images.py`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–12  | `ALLOWED_MIME_TYPES` | Permitted MIME types per D-DRW-03: SVG, PNG, JPEG, PDF |
| 15–24 | `list_images(conn, tool_id)` | Returns all image records for a tool, excluding blob column |
| 27–34 | `get_image_blob(conn, image_id)` | Returns `(bytes, mime_type)` or `None` if not found |
| 37–54 | `create_image(...)` | Inserts new row; generates UUID id; returns `image_id` |
| 57–62 | `delete_image(conn, image_id)` | Deletes row; annotations cascade via `ON DELETE CASCADE` (D-DRW-14) |
| 65–74 | `replace_image_blob(conn, image_id, blob_bytes, mime_type)` | Updates only `blob` + `mime_type`; all annotations survive (D-DRW-15) |

## Decisions

- **Blob column excluded from list**: `list_images` never fetches the blob — avoids loading large BLOBs into memory on every panel open.
- **UUID primary key**: `str(uuid.uuid4())` — collision-safe without AUTOINCREMENT; text PK is fine for `_images` which is not a hot-write table.
- **`ON DELETE CASCADE` is schema-level**: `delete_image` does not explicitly delete `_annotations` rows — the SQLite FK cascade handles it. The schema must have been created with `PRAGMA foreign_keys = ON` active at runtime; `get_project_conn` sets this.
- **Blob stored as Python `bytes`**: `sqlite3` maps BLOB → `bytes` on read. `create_image` and `replace_image_blob` accept `bytes` directly. Do not pass a string or memoryview.
