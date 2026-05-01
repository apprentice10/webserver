---
# static/engine/js/grid.js

**Description:** Main grid rendering and interaction: row/cell render, keyboard nav, cell save, soft/hard delete/restore, toggle LOG/REV, context menu, filters, ghost row, range selection, clipboard copy.

## Index (~1010 lines)

| Lines    | Section |
|----------|---------|
| 1–55     | State variables + `init()` |
| 56–200   | Rendering (`render`, `_flagBadgesHtml`, `_renderRow`, `_renderCell`, `_renderGhostRow`) |
| 186–270  | Event listeners (`_attachListeners`, `_onCellFocus`, `_onCellBlur`, `_onCellKeydown`, `_onCellDblClick`, `_onCellPaste`) |
| 271–365  | Keyboard nav (`_moveFocus`) + edit mode (`_enterEditMode`) |
| 366–560  | Range selection (`_initRangeSelection`, `_onTdMousedown`, `_onTdMouseenter`, `_updateRangeHighlight`, `_clearRange`, `_initColumnHeaderSelection`, `_selectColumn`, `_selectRow`, `_initCopyToClipboard`) |
| 561–650  | Ghost row (`_onGhostKeydown`, `_onGhostBlur`, `_createFromGhost`) |
| 651–750  | Cell save (`_saveCell`, `_updateLogCell`) |
| 751–820  | Soft-delete / restore / hard-delete |
| 821–880  | Toggle deleted/LOG/REV + context menu |
| 880–960  | Filters, search, appendRows, `showRowLog`, `showCellLog` |
| 960–1075 | Range LOG (`_isSingleCellSelection`, `showRangeLog`), Utility |
| 1075–1200 | Flag submenu helpers (`_getSelectedCells`, `_flagCheckState`, `_populateFlagsSubmenu`), public API |

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
| `_editingInput` | `HTMLInputElement\|null` | Currently active input in edit mode (not readonly); `null` = select mode |
| `_ranges` | `Range[]` | Active selections: `[{start:{r,c}, end:{r,c}}, …]`; r/c are indices into `_filteredRows` / `ColumnsManager.getColumns()` |
| `_activeDragIdx` | `number` | Index into `_ranges` of the range being dragged; `-1` = no drag |
| `_isDragging` | `boolean` | True while mouse button is held during range drag |
| `_isAdditive` | `boolean` | True when Ctrl was held at mousedown (ranges accumulate) |
| `_ctxFlagsCache` | `Array\|null` | Non-system flags list cached for the duration of one context menu open; `null` = reload on next hover |

**Row object shape** (`Row`): plain object from API — `{id, tag, is_deleted, row_log, [col_slug]: value, …}`. Access cell value as `row[col.slug]`.

**Column object shape**: returned by `ColumnsManager.getColumns()` — `{slug, name, type, position, …}`. Index in the array == `data-col-idx` on `<td>`.

## `init()` call sequence

```
ColumnsManager.loadColumns()
ColumnsManager.renderHeader()
ApiClient.loadRows(true)   → _rows
_applyFilters()            → _filteredRows
render()
PasteManager.init()
_initContextMenu()
_initRangeSelection()
_initColumnHeaderSelection()
_initCopyToClipboard()     ← add new global keydown shortcuts here
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
GridManager.showRowLog(rowId)
GridManager.showCellLog(rowId, colSlug)  // opens sidebar with filtered cell log
GridManager.showRangeLog()               // opens sidebar with aggregated log for current _ranges
GridManager.openContextMenu(e, rowId)
GridManager.getRange()                 // first range or null
GridManager.getRanges()                // all ranges (copy)
GridManager.clearRange()
GridManager.selectColumn(colIdx, additive)
GridManager.selectRow(rowIdx, additive)
```

## Decisions

- **Flag badges**: `_flagBadgesHtml(flags)` helper renders `.cell-flag-badges > .cell-flag-dot*` HTML. Cell-level flags attach `data-has-flags="true"` on `<td>` (triggers `position:relative` in CSS) and inject the badge span inside the td after the input. Row-level flags (`col_slug=''`) render badges in the row-num `<td>` with class `row-num-flags`.
- **Toggle LOG/REV via CSS class**: `.log-hidden` / `.rev-hidden` on `#data-grid` — no `render()` call. CSS: `.data-grid.log-hidden [data-slug="log"] { display: none; }`.
- **Ghost row**: phantom row at grid bottom for fast row insertion without a modal.
- **Context menu**: managed entirely in `grid.js`, not a separate module. Right-click on a cell that is **inside** the current `_ranges` selection keeps the range intact (range context menu). Right-click on a cell **outside** any range collapses `_ranges` to that single cell before opening the menu. Right-click on the `row-num` cell (no `data-col-idx`) is treated as outside any range.
- **Flag submenu**: fly-out submenu on the "🏷 Flags" context menu item. Flags are loaded lazily via `ApiClient.listFlags()` on `mouseenter`, filtered to `is_system=0`, cached in `_ctxFlagsCache` (reset to `null` on each `openContextMenu` and `_closeContextMenu`). Toggle uses `_getSelectedCells()` to collect all cells in `_ranges` (skipping `log`/`rev` columns). Toggle semantics: ALL cells have flag → remove from all; ANY missing → add to missing. Local `_rows` state is patched immediately after the API call (no full reload). `flagsSnap` captures the cache before `_closeContextMenu()` nulls it. Event delegation via the existing `menu.addEventListener("click")` catches dynamically injected `.ctx-flag-item[data-action="toggle-flag"]` items.
- **Edit mode guard**: `_editingInput !== null` means a cell is in edit mode. Always check this before intercepting keyboard shortcuts to avoid stealing input from the user.
- **Range selection coordinates**: each data `<td>` has `data-row-idx` (index in `_filteredRows`) and `data-col-idx` (index in `ColumnsManager.getColumns()`). `_ranges` is an array of `{start:{r,c}, end:{r,c}}`. Cleared by `render()`, `_enterEditMode()`, and Escape.
- **Ctrl+C copy**: `_initCopyToClipboard()` intercepts `Ctrl+C`/`Cmd+C` on `document` when `_ranges` is non-empty and `_editingInput` is null. Computes the bounding box across all ranges, builds a tab-separated string (rows joined by `\n`), writes to clipboard via `navigator.clipboard.writeText()`. Cells in the bounding box but outside any selected range (discontinuous Ctrl+click) are written as empty strings.
