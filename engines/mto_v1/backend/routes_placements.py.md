# backend/routes_placements.py

**Description:** MTO V1 tag placement endpoints — save (upsert), load, and delete TAG annotations for a typical's image.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `PlacementIn` | 11 | Pydantic model: tag + label_x/y + arrow_x/y (all 0–1 fractions of viewport) |
| `_require_typical` | 19 | Guard — 404 if typical_id doesn't belong to tool_id |
| `list_placements` | `GET /{tool_id}/placements/{typical_id}` | Returns all placements for a typical as JSON list |
| `upsert_placement` | `POST /{tool_id}/placements/{typical_id}` | Delete-then-insert by tag (no UNIQUE constraint — avoids migration) |
| `delete_placement` | `DELETE /{tool_id}/placements/{typical_id}/{tag}` | Removes one placement by tag name |

## Decisions

- Upsert implemented as DELETE + INSERT (not `ON CONFLICT`) because `mto_tag_placements` has no UNIQUE constraint on `(typical_id, tag)` — adding one would require a schema migration.
- Coordinates are stored as 0–1 fractions of the viewport element dimensions (decided at Step 13 — scales on resize and re-upload).
- DELETE cascade on typical deletion is handled by `routes_typicals.py` explicitly and by the FK `ON DELETE CASCADE` in the DDL.
