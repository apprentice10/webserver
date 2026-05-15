# static/engine/js/history/history-panel.js

**Description:** IIFE `HistoryPanel` — sidebar orchestration for row, cell, and range audit history. Owns `_logSidebarCtx` state; calls `HistoryApi`, `HistoryRenderer`, `SidebarManager`, and `RollbackService`.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 1 | IIFE declaration — `HistoryPanel` |
| 3 | `_logSidebarCtx` — private `{rowId, colSlug}` or null |
| 5–52 | `showRowLog(rowId, row)` — fetch full-row audit, group by col_slug, render tree |
| 54–79 | `showCellLog(rowId, colSlug, row)` — fetch single-cell audit, render flat list |
| 81–147 | `showRangeLog(ranges, filteredRows, columns)` — fetch multi-cell audit, render by col/row |
| 149 | `return { showRowLog, showCellLog, showRangeLog }` |

## Decisions

- **Explicit parameters (D13):** All three functions receive the data they need as parameters. No closure access to `grid.js` state (`_rows`, `_ranges`, `_filteredRows`). Grid.js resolves state before calling.
- **`RollbackService` forward reference:** `RollbackService.bindRollbackButtons()` is called after rendering. `rollback-service.js` (P4-H4) loads after this file but before any user interaction, so the reference is safe at runtime.
- **`_logSidebarCtx` is write-only for now:** Tracks current context for potential future use (e.g., sidebar refresh after external state change). Not read anywhere in this release; exposed to submodules only if needed.
- **`filteredRows` used for tag lookup in `showRangeLog`:** All tags in `colCellMap` are sourced from `filteredRows` during range iteration, so looking them up in `filteredRows` is equivalent to using `_rows` for this purpose.
- **`exportLog` button calls `HistoryRenderer.exportLog()`:** Wired directly (P4-H6). No dependency on `GridManager` for export.
