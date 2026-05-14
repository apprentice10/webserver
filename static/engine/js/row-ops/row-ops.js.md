# static/engine/js/row-ops/row-ops.js

**Description:** Extracted row mutation cluster from grid.js (P4-G5). Handles soft-delete, restore, hard-delete, keep-row, and override removal — all require API calls followed by local state updates and a re-render.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–18 | `configure(deps)` | Injects 6 dependencies from grid.js: `getRows`, `getFilteredRows`, `updateRow`, `removeRows`, `applyFilters`, `render` |
| 20–44 | `softDeleteRow(rowId)` | Deletes selected or specified rows (reversible); confirms first |
| 46–56 | `restoreRow(rowId)` | Restores a soft-deleted row |
| 58–84 | `hardDeleteRow(rowId)` | Permanently deletes selected or specified rows; confirms first |
| 86–98 | `keepRow(rowId)` | Removes the ETL: Eliminated cell flag from a row |
| 100–118 | `_doRemoveOverride(cells)` | Removes manual overrides from one or more cells (private batch impl) |
| 120–124 | `removeOverride(rowId, colSlug)` | Single-cell wrapper over `_doRemoveOverride` (context menu path) |

## Decisions

- **configure() pattern**: Dependencies injected via `configure()` rather than closure access, consistent with CellKeyboard, ContextMenu, SelectionManager. `updateRow(id, data)` updates `_rows` only; `_applyFilters()` rebuilds `_filteredRows`. `removeRows(idSet)` filters both arrays (used by hardDelete which skips _applyFilters).
- **Utils.showToast instead of global alias**: The `showToast` global alias is defined at the bottom of grid.js; this module uses `Utils.showToast` directly to avoid the dependency.
- **SelectionManager accessed globally**: `SelectionManager.getSelectedRowIds()` called directly — it is a global IIFE loaded before this module (same pattern as CellKeyboard).
- **keepRow mutates in-place**: The row object in `_rows` is mutated directly (cell_flags array filtered) rather than waiting for a server response, because the `keepRow` API returns no updated row data. Acceptable since the server is the source of truth on next load.
