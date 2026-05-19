---
Updated: 2026-05-19 16:00

# dashboard/annotations.py

**Description:** Annotation service for Drawing Toolkit. Thin CRUD layer over the `_annotations` system table. No HTTP logic — called only by `routes_annotations.py`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–17  | `_row_to_dict(row)` | Converts a DB row to dict; deserializes `props_json` → `props` and `style_json` → `style` |
| 20–28 | `list_annotations(conn, image_id)` | Returns all annotations for an image, ordered by `created_at` |
| 31–59 | `create_annotation(...)` | Inserts new row; generates UUID id; serializes `props` and `style` to JSON |
| 62–88 | `update_annotation(...)` | Partial update: reads current row and merges only provided fields; returns False if not found |
| 91–96 | `delete_annotation(conn, annotation_id)` | Deletes row by id; returns False if not found |

## Decisions

- **`props` and `style` deserialized at the service layer**: routes always receive plain dicts, never raw JSON strings. Keeps HTTP layer clean.
- **Partial update reads before writing**: `update_annotation` fetches the current row first and merges only explicitly-provided fields. `None` in a field means "keep existing value" — callers use this for position-only updates (drag) without re-sending the full props payload.
- **`style=None` vs `style={}` distinction preserved**: `None` means "use toolkit default style". `{}` means "explicitly empty override". The service stores `None` as SQL NULL and `{}` as `'{}'` — the renderer must honor this distinction (D-DRW-09).
- **UUID primary key**: matches `_images` convention; collision-safe without AUTOINCREMENT.
