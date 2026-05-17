---
# engines/sheet_v1/backend/service.py

**Description:** Core Sheet V1 business logic — engine CRUD, column read, row read, cell update, tag uniqueness. No HTTP concerns.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 27–35 | `_unique_slug(conn, base_slug)` | Appends numeric suffix until slug is unique in `_tools` |
| 40–46 | `get_engine(conn, tool_id)` | Returns single tool row as dict; raises 404 if not found |
| 47–51 | `get_engines_for_project(conn)` | Returns all non-deleted tools |
| 52–117 | `create_engine(conn, data)` | Creates tool + default system columns; optionally seeds from template |
| 118–139 | `update_engine_settings(conn, tool_id, data)` | Updates name/rev/note/query_config/icon; marks tool stale if ETL SQL changes |
| 144–152 | `get_columns(conn, tool_id)` | Returns all columns ordered by position |
| 157–200 | `get_rows(conn, tool_id, ...)` | Returns rows with optional filters; handles deleted/all modes |
| 201–248 | `create_row(conn, tool_id, data)` | Inserts row; respects position, ghost-row semantics |
| 249–335 | `update_cell(conn, tool_id, row_id, data)` | Updates cell; writes audit log; marks stale; enforces tag uniqueness |
| 336–430 | `batch_update_cells(conn, tool_id, items)` | Writes N cells in one transaction; one `push_undo("batch_edit")`; returns `{updated: [row, ...]}` |
| 440–end | `_validate_tag_unique(...)` | Ensures TAG column values remain project-unique |

## Decisions

- **No HTTP imports**: this file is pure business logic; it raises `HTTPException` only because FastAPI treats it as the error boundary. All DB access goes through `conn` passed in from the route.
- **Staleness on cell update**: `mark_tool_stale` / `mark_dependents_stale` called inside `update_cell` and `batch_update_cells` so every write path triggers ETL invalidation without callers knowing.
- **`batch_update_cells` skips silently**: invalid col_slug, missing row, or tag collision are skipped without aborting the batch. Only cells that actually changed appear in the undo entry and the response.
