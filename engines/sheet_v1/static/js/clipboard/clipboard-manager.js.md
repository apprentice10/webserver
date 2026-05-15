# static/engine/js/clipboard/clipboard-manager.js

**Description:** Handles Ctrl+C / Cmd+C clipboard copy for the grid. Extracted from `grid.js` (P4-G6). Reads the current selection bounding box and writes tab-separated cell values to the system clipboard.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–8   | state  | `_getRanges`, `_isEditing`, `_getColumns`, `_getFilteredRows` — injected via `configure()` |
| 10–14 | `configure(deps)` | Injects all four dependencies; called once from `grid.js init()` before `init()` |
| 16–57 | `init()` | Registers `document keydown` listener for `Ctrl+C`/`Cmd+C` |

## Decisions

- **Dependency injection via `configure()`**: all four external references (`getRanges`, `isEditing`, `getColumns`, `getFilteredRows`) are injected rather than accessed as globals. Consistent with the pattern established by `SelectionManager`, `CellKeyboard`, `ContextMenu`, and `RowOps`.
- **Bounding-box copy**: cells in the bounding box but outside any selected range (discontinuous Ctrl+click selection) are written as empty strings. Matches Excel/Google Sheets behaviour.
- **Edit-mode guard**: `_isEditing()` short-circuits before `e.preventDefault()` so the browser's normal copy of the active input text is preserved while a cell is in edit mode.
- **`getFilteredRows` snapshot**: the getter is called once per keydown event and stored in a local `filteredRows` — no closure capture of `_filteredRows` directly (module knows nothing about grid.js internals).
