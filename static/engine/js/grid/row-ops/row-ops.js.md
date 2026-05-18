# static/engine/js/row-ops/row-ops.js

**Description:** Extracted row mutation cluster from grid.js (P4-G5). Handles soft-delete, restore, hard-delete, keep-row, and override removal — all require API calls followed by local state updates and a re-render.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–18 | `configure(deps)` | Injects 6 dependencies from grid.js: `getRows`, `getFilteredRows`, `updateRow`, `removeRows`, `applyFilters`, `render` |
| 20–44 | `softDeleteRow(rowId)` | Deletes selected or specified rows (reversible); confirms first |
| 46–69 | `restoreRow(rowId)` | Restores selected deleted rows or the clicked row; batched toast |
| 71–100 | `hardDeleteRow(rowId)` | Permanently deletes selected or specified rows; confirms first |
| 102–131 | `keepRow(rowId)` | Removes ETL: Eliminated flag from selected qualifying rows or clicked row; batched toast |
| 133–153 | `_doRemoveOverride(cells)` | Removes manual overrides from one or more cells (private batch impl) |
| 155–164 | `removeOverride(rowId, colSlug)` | Range-aware: uses selection if non-empty, else falls back to single-cell path |

## Decisions

- **configure() pattern**: Dependencies injected via `configure()` rather than closure access, consistent with CellKeyboard, ContextMenu, SelectionManager. `updateRow(id, data)` updates `_rows` only; `_applyFilters()` rebuilds `_filteredRows`. `removeRows(idSet)` filters both arrays (used by hardDelete which skips _applyFilters).
- **Utils.showToast instead of global alias**: The `showToast` global alias is defined at the bottom of grid.js; this module uses `Utils.showToast` directly to avoid the dependency.
- **SelectionManager accessed globally**: `SelectionManager.getSelectedRowIds()` and `SelectionManager.getSelectedCells()` called directly — global IIFE loaded before this module (same pattern as CellKeyboard).
- **All row ops now use batch endpoints**: `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `keepRow` all call `ApiClient.batchRowOp(operation, rowIds)` → `POST /rows/batch-op`. `removeOverride` calls `ApiClient.batchRemoveOverride(cells)` → `POST /rows/batch-remove-override`. Single network round-trip, atomic transaction, one undo entry per user action.
- **keepRow response shape**: server returns `{kept: [row_tag, ...]}` (not full row data). Client uses row_tags to find rows in `_rows` and mutate `cell_flags` in-place — same strategy as before migration.
- **hardDeleteRow removes by deleted_ids from response**: `_removeRows` is called with `res.deleted_ids` (the trash IDs the server actually deleted), not the original `rowIds` selection — handles skipped rows gracefully.
- **Range-aware operations (Group O)**: `restoreRow`, `keepRow`, and `removeOverride` now read the active selection and filter to qualifying rows/cells only. If no qualifying selection, they fall back to the right-clicked row/cell — same pattern as `softDeleteRow`/`hardDeleteRow`. `removeOverride` uses `getSelectedCells` (not `getSelectedRowIds`) because it needs col_slug per cell.
- **ColumnsManager accessed globally**: `removeOverride` calls `ColumnsManager.getColumns()` directly, consistent with how context-menu.js already uses it for the same purpose.
