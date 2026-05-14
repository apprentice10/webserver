# static/engine/js/cell-save/cell-save.js

**Description:** IIFE `CellSave` — handles cell save API call and log-cell DOM patch. Extracted from `grid.js` (P4-G7). Depends on `GridRenderer` (must load first) and global `ApiClient`/`showToast`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1     | `CellSave` | IIFE wrapper |
| 3–5   | `_cfg`  | Injected deps: `getRows`, `getFilteredRows` |
| 7–9   | `configure(cfg)` | Inject deps from grid.js |
| 11–63 | `doSaveCell(inputEl, cell, newValue)` | Call API, patch local arrays, update log cell + override dot + flag badges in DOM |
| 65–70 | `updateLogCell(rowId, rowLog)` | Patch the `.cell-log-preview` element for a row without full re-render |
| 72    | `return` | Public API: `configure`, `doSaveCell`, `updateLogCell` |

## Decisions

- **Array mutation via reference**: `_cfg.getRows()` returns the live `_rows` array from grid.js. Mutating by index (`rows[idx] = updatedRow`) propagates back to grid.js state without requiring a callback. Same pattern as `RowOps`.
- **`updateLogCell` is public**: called by `grid.js::refreshRowDOM` after rollback events (`grid:rowUpdated`) in addition to the save path.
- **No `render()` call on save**: `doSaveCell` applies surgical DOM patches (override attribute, flag badges, log preview) to avoid a full virtual-scroll re-render on every keystroke save.
- **Load order**: must load after `rendering/grid-renderer.js` (uses `GridRenderer.flagBadgesHtml` and `GridRenderer.formatLogPreview`) and before `grid.js`.
