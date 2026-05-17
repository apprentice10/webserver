---
name: service_row_batch
description: Batch row and cell operations for Sheet V1 — single transaction, single undo entry per user action
type: module
---

# engines/sheet_v1/backend/service_row_batch.py

**Description:** Implements `batch_row_op` and `batch_remove_override`. Extracted from `service_row_ops.py` to keep each file under 400 lines. All operations execute in a single SQLite transaction and push exactly one undo entry.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 22–39 | `batch_row_op(conn, tool_id, operation, row_ids)` | Dispatcher: routes to `_batch_soft_delete`, `_batch_restore`, `_batch_hard_delete`, or `_batch_keep` |
| 41–75 | `_batch_soft_delete` | Moves N active rows to `_trash` in one transaction; returns `{updated: [trash_rows]}` |
| 77–120 | `_batch_restore` | Restores N trash rows to active table in one transaction; returns `{updated: [active_rows]}` |
| 122–140 | `_batch_hard_delete` | Deletes N trash rows permanently; returns `{ok, deleted_ids}`; no undo entry |
| 142–162 | `_batch_keep` | Removes ETL:Eliminated flag from N rows; returns `{kept: [row_tags]}` |
| 164–212 | `batch_remove_override` | Clears override for N cells in one transaction; returns `{updated: [active_rows]}` |

## Decisions

- **Skips rows not found**: each loop iteration does a `continue` for missing rows/trash entries instead of raising HTTPException — batch semantics (partial success is OK, caller counts `updated` length).
- **`_validate_tag_unique` skip on collision**: if a tag already exists on restore, that trash entry is skipped silently. Prevents the whole batch from aborting due to a single duplicate tag.
- **`batch_keep` undo entry includes `flag_id`**: the undo handler needs the flag ID to re-insert `_cell_flags` rows without a DB lookup.
- **`batch_remove_override` stores both `etl_value` and `manual_value`**: undo restores the manual value back into the cell and re-inserts the override record; redo re-applies the removal.
- **Hard delete has no undo entry**: consistent with single-row `hard_delete_row` behavior.
