---
# static/engine/js/grid.js

**Description:** Main grid orchestration: virtual scroll render, toggle LOG/REV, context menu wrapper, filters, ghost row. Row/cell HTML delegated to `GridRenderer` (P4-G4). Range selection delegated to `SelectionManager` (P4-G1). Keyboard nav + edit mode delegated to `CellKeyboard` (P4-G2). Context menu + flag submenu delegated to `ContextMenu` (P4-G3). Row mutation ops delegated to `RowOps` (P4-G5). Clipboard copy delegated to `ClipboardManager` (P4-G6). Cell save delegated to `CellSave` (P4-G7).

## Index (~560 lines)

| Lines    | Section |
|----------|---------|
| 1–105    | State variables + `init()` — includes `CellSave.configure()`, `RowOps.configure()`, `SelectionManager.configure()`, `CellKeyboard.configure()`, `ContextMenu.configure()`, `ClipboardManager.configure()+init()`, `_initFindReplace()`, `_initAutocomplete()`, `grid:rowUpdated` listener |
| 105–170  | Rendering: `OVERSCAN`, `_getRowHeight`, `render` (virtual scroll), `_initVirtualScroll` — HTML generation delegated to `GridRenderer.*` |
| 170–220  | Event listeners (`_attachListeners`), `scrollToRow`, `_initSearchShortcut` |
| 220–270  | `_initFindReplace` (Ctrl+H), `_initAutocomplete`, `_initSelectAll` |
| 270–310  | Ghost row (`_createFromGhost`) |
| 310–350  | Toggle deleted/LOG/REV, context menu wrapper (`openContextMenu` → `ContextMenu.open`) |
| 350–420  | Search (`search`), filters (`_applyFilters`), `appendRows` |
| 420–520  | Utility (`_showError`, `_normalizeCellsFromInput`, `updateRowData`, `getRowById`, `getRowByTag`, `refreshRowDOM`), public API |

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
> `_doSaveCell`, `_updateLogCell` removed in P4-G7 → moved to `CellSave`.
> `_ranges`, `_activeDragIdx`, `_isDragging`, `_isAdditive` removed in P4-G1 → moved to `SelectionManager`.
> `_editingInput` removed in P4-G2 → moved to `CellKeyboard`.
> `_ctxRowId`, `_ctxColSlug`, `_ctxColSlugLog`, `_ctxFlagsCache` removed in P4-G3 → moved to `ContextMenu`.
> `_flagBadgesHtml`, `_renderRow`, `_renderCell`, `_renderGhostRow`, `_formatLogPreview` removed in P4-G4 → moved to `GridRenderer`.
> `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `keepRow`, `removeOverride`, `_doRemoveOverride` removed in P4-G5 → moved to `RowOps`.

**Row object shape** (`Row`): plain object from API — `{id, tag, is_deleted, row_log, [col_slug]: value, …}`. Access cell value as `row[col.slug]`.

**Column object shape**: returned by `ColumnsManager.getColumns()` — `{slug, name, type, position, …}`. Index in the array == `data-col-idx` on `<td>`.

## `init({ endpointBase })` call sequence

```
ApiClient.configure({ endpointBase })  ← stores base for all grid-contract fetch calls
ColumnsManager.loadColumns()
ColumnsManager.renderHeader()
ApiClient.loadRows(true)   → _rows
_applyFilters()            → _filteredRows
_initVirtualScroll()       → attaches scroll listener + MutationObserver
render()
SelectionManager.configure(() => _filteredRows.length)
CellSave.configure({getRows, getFilteredRows})
CellKeyboard.configure({...})  ← injects getFilteredRows, doSaveCell (→ CellSave.doSaveCell), createFromGhost, forceRender
PasteManager.init()
_initContextMenu()
SelectionManager.initGlobal()  ← registers mouseup, range readout chip, column header click
ClipboardManager.configure({...}) + ClipboardManager.init()  ← Ctrl+C copy; uses CellKeyboard.isEditing()
_initSearchShortcut()
document.addEventListener('grid:rowUpdated', ...)  ← dispatched by RollbackService after rollback
```

To add a new global keyboard shortcut: create a new `_initXxx()` and call it from `init()`. Do **not** add global shortcuts inside `_onCellKeydown` (that handler only fires on focused `.cell-input` elements). Existing shortcuts: `/` → search, `Ctrl+A` → `SelectionManager.selectAll()` (`_initSelectAll`), `Ctrl+H` → `FindReplace.open()` (`_initFindReplace`), `Ctrl+X` → `CutPaste` (`_initCut`), `Ctrl+Shift+V` → `PasteSpecial.open()` (`_initPasteSpecial`).

**CutPaste / PasteSpecial / FillHandle integration**: `render()` calls `CutPaste.applyVisual()` and `FillHandle.update()` after `SelectionManager.updateHighlight()`. Each module is configured in its own `_initXxx()` helper (called from `init()`). All three accept `{getFilteredRows, updateRowData, render}` plus module-specific extras.

**SortFilterManager integration**: `init()` loads sort/filter state in parallel with rows (single `Promise.all`), then calls `SortFilterManager.loadState()` before `_applyFilters()`. The `_applyFilters()` function calls `SortFilterManager.applyToRows()` after the search filter (column filters + sort apply last). `applySort()` is a thin wrapper: `_applyFilters() + render()`, exposed on the public API for `SortFilterManager` callbacks.

## Public API

```js
GridManager.init({ endpointBase })     // required — passed down to ApiClient.configure
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
GridManager.selectAll()                    // Ctrl+A — selects all filteredRows × all columns
GridManager.scrollToRow(rowIdx)            // scroll container so rowIdx is visible + render
GridManager.getFilteredRows()              // snapshot of _filteredRows (active rows only)
GridManager.applySort()                    // re-run _applyFilters() + render(); called by SortFilterManager after state change
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
| `CellSave.doSaveCell(inputEl, cell, newValue)` | Save one cell's value via API; `cell = {row_tag, col_slug}`. Delegated to `CellSave` (P4-G7). |
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
