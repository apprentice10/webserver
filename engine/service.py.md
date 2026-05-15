---
# engine/service.py

**Description:** Core Table Engine business logic — tool CRUD, column listing, row CRUD (get/create/update-cell), and shared helpers. After Phase 3 decomposition, column mutations live in `engine/service_columns.py`, row mutations in `engine/service_row_ops.py`, and template CRUD in `engine/service_templates.py`.

## Index (~345 lines)

| Lines | Section |
|-------|---------|
| 1–25  | Imports (`json`, `sqlite3`, `HTTPException`, project_db helpers, utils, staleness) |
| 28–34 | `_unique_slug(conn, base_slug)` — deduplicates tool slugs |
| 37–130 | Tool CRUD: `get_tool`, `get_tools_for_project`, `create_tool`, `update_tool_settings` |
| 133–140 | `get_columns(conn, tool_id)` — stays here; called internally by `create_row` and `paste_rows` |
| 143–345 | Row CRUD: `get_rows`, `create_row`, `update_cell`, `_validate_tag_unique` |

## Decisions

- **`get_columns` not extracted to `service_columns.py`**: `create_row` and `paste_rows` call it internally. Extracting it would require a circular import (service_columns → service → service_columns). Keeping it here avoids that.
- **`_validate_tag_unique` stays here**: called by `create_row` (here) and `restore_row` (in service_row_ops.py). service_row_ops.py imports it via a deferred `from engine.service import _validate_tag_unique` — one-way dep, no circular.
- **Staleness helpers**: `mark_tool_stale` and `mark_dependents_stale` imported from `engine/staleness.py`.
- **Column and row mutation ops split out in Phase 3**: see `engine/service_columns.py`, `engine/service_row_ops.py`, `engine/service_templates.py`.
- **Row `rev` set from `_revisions` (Q2)**: `create_row` and `update_cell` use `get_current_revision(conn)` — not `tool["rev"]` (that is the tool-level document rev string 'A/B/…', unrelated). `update_cell` stamps `rev` on the row in the same UPDATE as the cell value.
