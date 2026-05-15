# static/engine/js/context-menu/context-menu.js

**Description:** Right-click context menu — open/close, item dispatch (delete/restore/hard-delete/keep-row/override/history/flags), flag submenu rendering. All grid.js state is injected via `configure()`; no direct access to grid globals.

## Index

| Lines     | Description |
|-----------|-------------|
| 1–35      | State (`_ctxRowId`, `_ctxColSlug`, `_ctxColSlugLog`, `_ctxFlagsCache`) + injected dep vars |
| 37–42     | `configure({getRows, getFilteredRows, applyFilters, render, softDeleteRow, restoreRow, hardDeleteRow, keepRow, removeOverride})` |
| 47–140    | `init()` — attaches click / document click / keydown / flags-trigger mouseenter listeners |
| 144–198   | `open(e, rowId, fromDeleted)` — positions menu, sets item visibility, resets flag cache |
| 200–208   | `_close()` — hides menu, clears all `_ctx*` state |
| 213–227   | `_flagCheckState(flagId, cells)` — returns `"none"` / `"some"` / `"all"` |
| 229–246   | `_populateFlagsSubmenu(flags, cells)` — renders flag items into `#ctx-flags-list` |
| 248–256   | `removeFlagFromCells(flagId)` — removes a flag from all rows in local cache, calls `_render()` |

## Decisions

- **configure() injection**: follows the same pattern as `CellKeyboard.configure()` (P4-G2). Grid state (`_rows`, `_filteredRows`) is accessed via getter closures, not snapshots, so mutations made inside this module are reflected immediately. Row-mutating ops (`softDeleteRow`, etc.) are injected as function references from grid.js so they can access grid-local state.
- **`FlagsManager` not injected**: `FlagsManager.show()` is called inside a click handler (runtime only, not at configure time). `FlagsManager` is a global IIFE loaded after this module; late binding via global reference is safe here, same as the prior grid.js pattern.
- **`openContextMenu` kept in grid.js public API**: `_renderRow` template strings reference `GridManager.openContextMenu(...)` directly in the HTML; renaming that in the public API would break existing HTML. `GridManager.openContextMenu` is a one-line wrapper that calls `ContextMenu.open`.
- **`removeFlagFromCells` in public API**: called by `flags.js` (FlagsManager) when a flag is deleted; must remain accessible as `GridManager.removeFlagFromCells`. It now delegates to `ContextMenu.removeFlagFromCells`.
