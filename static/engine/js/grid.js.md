---
# static/engine/js/grid.js

**Description:** Main grid orchestration: virtual scroll render, cell save, toggle LOG/REV, context menu wrapper, filters, ghost row. Row/cell HTML delegated to `GridRenderer` (P4-G4). Range selection delegated to `SelectionManager` (P4-G1). Keyboard nav + edit mode delegated to `CellKeyboard` (P4-G2). Context menu + flag submenu delegated to `ContextMenu` (P4-G3). Row mutation ops delegated to `RowOps` (P4-G5). Clipboard copy delegated to `ClipboardManager` (P4-G6).

## Index (~515 lines)

| Lines    | Section |
|----------|---------|
| 1–97     | State variables + `init()` — includes `RowOps.configure()`, `SelectionManager.configure()`, `CellKeyboard.configure()`, `ContextMenu.configure()`, `ClipboardManager.configure()+init()`, `grid:rowUpdated` listener |
| 97–165   | Rendering: `OVERSCAN`, `_getRowHeight`, `render` (virtual scroll), `_initVirtualScroll` — HTML generation delegated to `GridRenderer.*` |
| 165–215  | Event listeners (`_attachListeners`), search shortcut (`_initSearchShortcut`) |
| 215–255  | Ghost row (`_createFromGhost`) |
| 255–315  | Cell save (`_doSaveCell`, `_updateLogCell`) |
| 315–340  | Toggle deleted/LOG/REV, context menu wrapper (`openContextMenu` → `ContextMenu.open`) |
| 340–410  | Search (`search`), filters (`_applyFilters`), `appendRows` |
| 410–515  | Utility (`_showError`, `_normalizeCellsFromInput`, `updateRowData`, `getRowById`, `getRowByTag`, `refreshRowDOM`), public API |

## State variables

| Variable | Type | Description |
|---|---|---|
| `_rows` | `Row[]` | All rows including deleted |
| `_filteredRows` | `Row[]` | Rows after search/deleted filter — indices used by `data-row-idx` |
| `_showDeleted` | `boolean` | Whether deleted rows are visible |
| `_searchQuery` | `string` | Current lowercase search string |
| `_ctxRowId` | `number\|null` | Row ID of the open context menu |
| `_ctxColSlug` | `string\|null` | Col slug of an overridden cell for the remove-override action |
| `_ctxColSlugLog` | `string\|null` | Col slug of any data cell for the cell-log sidebar action |
| `_editingInput` | — | Moved to `CellKeyboard` (P4-G2); use `CellKeyboard.isEditing()` |
| `_rafPending`    | `boolean`     | Virtual scroll: true while a `requestAnimationFrame` render is already queued; prevents RAF stacking on fast scroll |

> `_logSidebarCtx` removed in P4-H6 → moved to `HistoryPanel`.
> `_ranges`, `_activeDragIdx`, `_isDragging`, `_isAdditive` removed in P4-G1 → moved to `SelectionManager`.
> `_editingInput` removed in P4-G2 → moved to `CellKeyboard`.
> `_ctxRowId`, `_ctxColSlug`, `_ctxColSlugLog`, `_ctxFlagsCache` removed in P4-G3 → moved to `ContextMenu`.
> `_flagBadgesHtml`, `_renderRow`, `_renderCell`, `_renderGhostRow`, `_formatLogPreview` removed in P4-G4 → moved to `GridRenderer`.
> `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `keepRow`, `removeOverride`, `_doRemoveOverride` removed in P4-G5 → moved to `RowOps`.

**Row object shape** (`Row`): plain object from API — `{id, tag, is_deleted, row_log, [col_slug]: value, …}`. Access cell value as `row[col.slug]`.

**Column object shape**: returned by `ColumnsManager.getColumns()` — `{slug, name, type, position, …}`. Index in the array == `data-col-idx` on `<td>`.

## `init()` call sequence

```
ColumnsManager.loadColumns()
ColumnsManager.renderHeader()
ApiClient.loadRows(true)   → _rows
_applyFilters()            → _filteredRows
_initVirtualScroll()       → attaches scroll listener + MutationObserver
render()
SelectionManager.configure(() => _filteredRows.length)
CellKeyboard.configure({...})  ← injects getFilteredRows, doSaveCell, createFromGhost, forceRender
PasteManager.init()
_initContextMenu()
SelectionManager.initGlobal()  ← registers mouseup, range readout chip, column header click
ClipboardManager.configure({...}) + ClipboardManager.init()  ← Ctrl+C copy; uses CellKeyboard.isEditing()
_initSearchShortcut()
document.addEventListener('grid:rowUpdated', ...)  ← dispatched by RollbackService after rollback
```

To add a new global keyboard shortcut: create a new `_initXxx()` and call it from `init()`. Do **not** add global shortcuts inside `_onCellKeydown` (that handler only fires on focused `.cell-input` elements).

## Public API

```js
GridManager.init()
GridManager.render()
GridManager.appendRows(newRows)        // used by PasteManager after paste
GridManager.updateRowData(rowId, row)  // patch local cache without re-render
GridManager.getRowById(rowId)
GridManager.softDeleteRow(rowId)
GridManager.restoreRow(rowId)
GridManager.hardDeleteRow(rowId)
GridManager.toggleDeleted()
GridManager.toggleLog()
GridManager.toggleRev()
GridManager.search(query)
GridManager.openContextMenu(e, rowId)
GridManager.getRange()                 // first range or null
GridManager.getRanges()                // all ranges (copy)
GridManager.getAllRows()               // snapshot of _rows (all, including deleted) — used by HistoryActions
GridManager.refreshRowDOM(rowId, row)  // update one row in cache + DOM — called via grid:rowUpdated event
GridManager.clearRange()
GridManager.selectColumn(colIdx, additive)
GridManager.selectRow(rowIdx, additive)
```

## Selection → Operation pipeline

All data-mutating operations follow this pipeline:

```
_ranges → _normalizeCellsFromInput | _getSelectedCells() → cells[] → operation(cells, options?)
```

| Helper | Purpose |
|--------|---------|
| `_normalizeCellsFromInput(inputEl)` | Converts a focused `<input>` element to `[{row_tag, col_slug}]`. Used by `_onCellBlur` when `_ranges` is empty (cleared on entering edit mode). |
| `_getSelectedCells()` | Iterates `_ranges`, maps grid coordinates to `[{row_tag, col_slug}]`, deduplicates, skips `log`/`rev` columns. Single source of truth for all range-aware operations. |

Operation layer (private, accept `cells[]`):

| Function | Description |
|----------|-------------|
| `_doSaveCell(inputEl, cell, newValue)` | Save one cell's value via API; `cell = {row_tag, col_slug}`. |
| `_doRemoveOverride(cells)` | Remove ETL override from all supplied cells in a loop. |

Legacy compat wrappers (keep old `(rowId, colSlug)` signature for internal context menu calls):

| Wrapper | Delegates to |
|---------|-------------|
| `removeOverride(rowId, colSlug)` | `_doRemoveOverride([{row_tag, col_slug}])` |

## Decisions

- **Flag badges**: `_flagBadgesHtml(flags)` helper renders `.cell-flag-badges > .cell-flag-dot*` HTML. Cell-level flags attach `data-has-flags="true"` on `<td>` (triggers `position:relative` in CSS) and inject the badge span inside the td after the input. Row-level flags (`col_slug=''`) render badges in the row-num `<td>` with class `row-num-flags`.
- **Toggle LOG/REV via CSS class**: `.log-hidden` / `.rev-hidden` on `#data-grid` — no `render()` call. CSS: `.data-grid.log-hidden [data-slug="log"] { display: none; }`.
- **Ghost row**: phantom row at grid bottom for fast row insertion without a modal.
- **Context menu**: managed entirely in `grid.js`, not a separate module. Right-click on a cell that is **inside** the current `_ranges` selection keeps the range intact (range context menu). Right-click on a cell **outside** any range collapses `_ranges` to that single cell before opening the menu. Right-click on the `row-num` cell (no `data-col-idx`) is treated as outside any range.
- **Flag submenu**: fly-out submenu on the "🏷 Flags" context menu item. Flags are loaded lazily via `ApiClient.listFlags()` on `mouseenter`, filtered to `is_system=0`, cached in `_ctxFlagsCache` (reset to `null` on each `openContextMenu` and `_closeContextMenu`). Toggle uses `_getSelectedCells()` to collect all cells in `_ranges` (skipping `log`/`rev` columns). Toggle semantics: ALL cells have flag → remove from all; ANY missing → add to missing. Local `_rows` state is patched immediately after the API call (no full reload). `flagsSnap` captures the cache before `_closeContextMenu()` nulls it. Event delegation via the existing `menu.addEventListener("click")` catches dynamically injected `.ctx-flag-item[data-action="toggle-flag"]` items.
- **Edit mode guard**: `_editingInput !== null` means a cell is in edit mode. Always check this before intercepting keyboard shortcuts to avoid stealing input from the user.
- **Range selection coordinates**: each data `<td>` has `data-row-idx` (index in `_filteredRows`) and `data-col-idx` (index in `ColumnsManager.getColumns()`). `_ranges` is an array of `{start:{r,c}, end:{r,c}}`. Cleared by `_enterEditMode()` and Escape. `render()` does NOT clear `_ranges` — it preserves them across virtual scroll repaints and calls `_updateRangeHighlight()` at the end to re-apply CSS to the newly rendered DOM.
- **Virtual scrolling**: `render()` computes a visible window (`scrollTop / rowH ± OVERSCAN`) and renders only that slice of `_filteredRows` between two spacer `<tr class="vs-spacer">` rows. All data remains in `_rows` / `_filteredRows`. Column copy reads `_filteredRows` directly, unaffected. `_moveFocus()` uses `data-row-idx` from `<td>` (absolute index) and calls `_scrollRowIntoView(rowIdx)` to bring out-of-viewport rows into the DOM before focusing. `_createFromGhost` sets `container.scrollTop` to the new row's position before `render()` so the row is always in the rendered window.
- **Ctrl+C copy**: delegated to `ClipboardManager` (P4-G6). See `clipboard/clipboard-manager.js.md`.
