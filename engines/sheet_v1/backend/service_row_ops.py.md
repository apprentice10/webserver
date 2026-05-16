---
# engines/sheet_v1/backend/service_row_ops.py

**Description:** Row mutation operations for Sheet V1 — soft/hard delete, restore, keep, override removal, paste, rollback.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 22–69 | `remove_override(conn, tool_id, row_id)` | Removes ETL override flag from a row; re-marks tool stale |
| 70–113 | `soft_delete_row(conn, tool_id, row_id)` | Sets `__deleted_at`; marks dependents stale |
| 114–171 | `restore_row(conn, tool_id, trash_id)` | Clears `__deleted_at`; re-marks stale |
| 172–192 | `hard_delete_row(conn, tool_id, row_id)` | Physical DELETE from `_rows`; no audit trail |
| 193–255 | `paste_rows(conn, tool_id, data)` | Bulk-inserts or bulk-updates rows from clipboard paste data |
| 256–end | `rollback_cell(conn, tool_id, row_id, data)` | Reverts a cell to a previous audit-log value |

## Decisions

- **Soft-delete via `__deleted_at`**: rows are logically deleted so ETL can inspect them and audit history is preserved. Hard delete is only used for ghost rows and paste cleanup.
- **`paste_rows` upsert**: if a row `__id` already exists the row is updated in-place; missing `__id` inserts a new row. This matches Excel paste semantics.
