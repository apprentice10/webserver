---
# engines/sheet_v1/backend/service_columns.py

**Description:** Column CRUD operations for Sheet V1 — add, update, delete, reorder, resize.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 16–59 | `add_column(conn, tool_id, data)` | Adds column to `_columns`; adds corresponding column to `_rows` via `ALTER TABLE` |
| 60–71 | `_remove_col_from_model(model, alias)` | Strips a column alias from an ETL model dict (used before column deletion) |
| 72–86 | `_rename_col_in_model(model, old, new)` | Renames alias references inside an ETL model dict |
| 87–174 | `update_column(conn, tool_id, col_id, data)` | Updates column metadata; renames SQL column if slug changes; patches ETL model references |
| 175–225 | `delete_column(conn, tool_id, col_id)` | Drops SQL column from `_rows`; removes from ETL model; blocks deletion of system columns |
| 226–236 | `reorder_columns(conn, tool_id, col_ids)` | Bulk-updates `position` for all columns |
| 237–end | `update_column_width(conn, tool_id, col_id, width)` | Updates `width` field only |

## Decisions

- **`ALTER TABLE` for add/rename/drop**: SQLite ALTER TABLE is used directly. Rename requires a full table rebuild (copy → rename → copy back) because SQLite does not support `ALTER COLUMN`.
- **ETL model patching on rename**: `_rename_col_in_model` patches the stored JSON model so compiled ETL SQL does not break when a column is renamed.
- **System columns are protected**: `delete_column` refuses to delete columns whose `is_system` flag is set.
