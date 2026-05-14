# engine/service_columns.py

**Description:** Column CRUD operations — add, update, delete, reorder, resize. Extracted from `engine/service.py` (P3-005). `get_columns` was NOT moved here to avoid a circular import (`service_row_ops` needs it via service).

## Index

| Lines | Symbol |
|-------|--------|
| 1–19  | Imports (`sqlite3`, `json`, `HTTPException`, `SYSTEM_COLUMNS`, `add_column_to_table`, `_slugify`) |
| 22–55 | `add_column(conn, tool_id, name, slug, col_type, width, position)` — deferred import of `get_tool` from `engine.service` |
| 58–68 | `_remove_col_from_model(model, alias)` — strips output column from ETL model |
| 71–82 | `_rename_col_in_model(model, old_alias, new_alias)` — renames alias in ETL model |
| 85–148 | `update_column(conn, tool_id, column_id, data)` — bidirectional ETL sync on rename |
| 151–187 | `delete_column(conn, tool_id, column_id)` — bidirectional ETL sync on delete |
| 190–197 | `reorder_columns(conn, tool_id, col_ids)` — positions start at 2 |
| 200–210 | `update_column_width(conn, tool_id, column_id, width)` — clamped 40–800 |

## Decisions

- **`get_tool` deferred import**: `add_column` imports `get_tool` from `engine.service` inside the function body to avoid the circular import that would result from a top-level import (service.py does not import from service_columns.py).
- **`get_columns` not extracted here**: stays in `service.py` because `create_row` and `paste_rows` (also in service.py) call it, and extracting it would require service.py to import from service_columns.py → circular dep.
- **Bidirectional ETL logic**: `_remove_col_from_model` and `_rename_col_in_model` are private helpers for the ETL sync paths in `delete_column`/`update_column`. They live here because they are only consumed by those two functions.
