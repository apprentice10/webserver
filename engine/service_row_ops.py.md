# engine/service_row_ops.py

**Description:** Row mutation operations — override removal, soft-delete, restore from trash, hard-delete, bulk paste, and cell rollback. Extracted from `engine/service.py` (P3-006).

## Index

| Lines | Symbol |
|-------|--------|
| 1–19  | Imports (`json`, `datetime`, `HTTPException`, project_db helpers, utils, staleness) |
| 22–64 | `remove_override(conn, tool_id, row_id, col_slug, project_id)` — restores ETL value, deletes override row |
| 67–103 | `soft_delete_row(conn, tool_id, row_id, project_id)` — moves row to `_trash` |
| 106–145 | `restore_row(conn, tool_id, trash_id, project_id)` — re-inserts from `_trash` |
| 148–162 | `hard_delete_row(conn, tool_id, trash_id, project_id)` — permanent delete from `_trash` |
| 165–210 | `paste_rows(conn, tool_id, project_id, rows_data)` — bulk insert with dup-tag skip |
| 213–257 | `rollback_cell(conn, tool_id, row_id, project_id, col_slug, entry_id)` — restores value from `_audit` |

## Decisions

- **Deferred imports from `engine.service`**: all functions use `from engine.service import get_tool` (and `_validate_tag_unique` / `get_columns` where needed) inside the function body. This avoids a circular import — `service.py` does not import from `service_row_ops.py`.
- **`_validate_tag_unique` stays in `service.py`**: called by both `create_row` (in service.py) and `restore_row` here. Keeping it in service.py and importing it here (one-way dep) is the cleanest solution without a third utility module.
