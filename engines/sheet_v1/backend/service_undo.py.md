---
name: service_undo
description: In-memory undo/redo buffer for Sheet V1 — session lifetime, never persisted
type: project
---

# engines/sheet_v1/backend/service_undo.py

**Description:** Manages per-tool undo/redo stacks in server process memory. Covers cell edits, batch cell edits, row inserts (ghost row, insert above/below, copy-insert), soft deletes, hard deletes, and new batch ops (batch_soft_delete, batch_restore, batch_keep, batch_remove_override). Resets on server restart or page reload.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 11–12 | `_undo_stacks`, `_redo_stacks` | Module-level dicts keyed by tool_id |
| 19–26 | `push_undo(tool_id, entry)` | Called by service functions on new user edits — appends to undo, clears redo |
| 28–32 | `get_stack_sizes(tool_id)` | Returns `{can_undo, can_redo}` booleans |
| 34–50 | `_pop_undo`, `_pop_redo`, `_push_redo`, `_push_undo_internal` | Internal stack primitives |
| 53–70 | `_apply_cell` | Updates cell + writes audit without going through service.update_cell |
| 72–76 | `_delete_active_row` | Deletes row directly from active table (bypass trash) |
| 78–99 | `_insert_from_snapshot(conn, tool_slug, row_data, rev)` | Inserts row from plain dict; validates tag uniqueness |
| 101–125 | `_restore_from_trash(conn, tool_slug, trash_id, rev)` | Restores from `_trash`; appends RESTORED log entry |
| 127–150 | `_soft_delete_to_trash(conn, tool_slug, row_id, rev)` | Soft-deletes into `_trash`; appends REMOVED log entry |
| 153–end | `do_undo(conn, tool_id)`, `do_redo(conn, tool_id)` | Public operations: pop, execute, push inverse |

## Decisions

- **`batch_edit` type**: entry shape `{type, tool_slug, tool_id, cells: [{row_id, col_slug, old_val, new_val, row_tag}]}`. Undo iterates cells in reverse, redo in forward order. One `conn.commit()` covers all cells — atomic.
- **`_push_undo_internal` vs `push_undo`**: `push_undo` clears redo (for new user edits). `_push_undo_internal` does not clear redo — used inside `do_redo` so multi-step redo chains are preserved.
- **DB helpers bypass service functions**: calling `service.update_cell` from inside undo would push another undo entry, corrupting the stack. All undo/redo DB work goes through private helpers.
- **`row_insert` redo uses `row_id: None`**: when undo deletes an inserted row, the original `__id` is gone. The redo entry keeps `row_id: None`; on redo, `_insert_from_snapshot` creates a new row with a new `__id`, which is stored back into the undo entry for the next potential undo.
- **Redo after soft_delete undo**: the restored row gets a new `__id`; we push `soft_delete_redo` with that new id so redo can soft-delete the right row.
- **Hard delete redo**: soft-deletes the recreated row then immediately hard-deletes from trash (two-step within one transaction).
- **Batch undo types**: `batch_soft_delete` / `batch_restore` / `batch_keep` / `batch_remove_override` — each entry has an `items` list. Undo iterates all items in one transaction. Redo entries use `_soft_delete_to_trash` / `_restore_from_trash` helpers (same as single-row ops).
- **`batch_keep` undo/redo is idempotent by design**: the same entry is pushed to both undo and redo stacks since the operation and its inverse differ only in INSERT vs DELETE of `_cell_flags` rows.
