# static/engine/js/selection/selection-manager.js

**Description:** Manages all range selection state and behaviour for the grid: mouse drag, shift-click extend, Ctrl+click additive, column/row header click-to-select, range highlight, readout chip, and selection query helpers.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–14  | State vars | `_ranges`, `_activeDragIdx`, `_isDragging`, `_isAdditive`, `_getFilteredRowCount` |
| 15–19 | `configure(fn)` | Inject `() => _filteredRows.length` getter from GridManager.init() |
| 22–38 | `initGlobal()` | Registers document mouseup, range readout chip, column header click — call once from GridManager.init() |
| 40–60 | `_initRangeReadout()` | Creates `.range-readout` chip; mousemove + mouseup handlers |
| 62–75 | `_initColumnHeaderSelection()` | Thead click → selectColumn(); registered once |
| 78–96 | `attachCellListeners()` | Per-render: registers mousedown/mouseenter on data `<td>`, click on gutter `<td>` |
| 99–133 | `_onTdMousedown(e)` | Shift-extend / Ctrl-additive / fresh drag logic |
| 135–142 | `_onTdMouseenter(e)` | Extends active drag range |
| 145–165 | `updateHighlight()` | Removes `.cell-selected` from all tds, re-applies from `_ranges` |
| 167–176 | `clearRange()` | Resets all selection state; removes `.cell-selected` and `selecting` class |
| 178–194 | `selectColumn(colIdx, additive)` | Selects all rows in one column; uses `_getFilteredRowCount()` |
| 196–208 | `selectRow(rowIdx, additive)` | Selects all columns in one row; calls `ColumnsManager.getColumns()` |
| 210–222 | `selectAll()` | Selects entire dataset: range (0,0)→(rowCount-1, colCount-1); uses `_getFilteredRowCount()` and `ColumnsManager.getColumns()` |
| 224–228 | `collapseToCell(r, c)` | Replaces selection with a single-cell range; used by openContextMenu |
| 229–235 | `setRanges(ranges)` | Replaces `_ranges` with an arbitrary array of range objects; used by FindReplace to highlight all matches |
| 217–229 | `isSingleCellSelection()` | Returns true if 0 or 1 unique cells are selected across all ranges |
| 231–245 | `getSelectedRowIds(filteredRows)` | Returns unique row ids for all selected rows |
| 247–268 | `getSelectedCells(filteredRows, columns)` | Returns `[{row_tag, col_slug}]` for all selected cells; skips log/rev |
| 283–299 | Public return | `configure`, `initGlobal`, `attachCellListeners`, `updateHighlight`, `clearRange`, `selectColumn`, `selectRow`, `selectAll`, `collapseToCell`, `isSingleCellSelection`, `getSelectedCells`, `getSelectedRowIds`, `getRanges`, `getFirstRange`, `getSelectionForPaste` |

## Decisions

- **`configure(fn)` pattern**: `_getFilteredRowCount` is injected as a getter closure at grid init time (same pattern as `EtlPersistence.configure(toolType)` in P4-E4). Avoids SelectionManager directly importing GridManager state while keeping `selectColumn` row-count-correct on every click.
- **`attachCellListeners()` called every render**: data `<td>` elements are re-created by virtual scroll on every render. Document-level and header listeners registered once in `initGlobal()` are not re-registered.
- **`getSelectedCells` / `getSelectedRowIds` receive `filteredRows` as parameter**: pure functions — no closure access to grid state (consistent with D13 pattern from history subsystem).
- **`collapseToCell` does not call `updateHighlight`'s full loop when called from openContextMenu**: the menu opens immediately after; the next `render()` / `_attachListeners()` call will call `updateHighlight()` anyway. The current implementation does call `updateHighlight()` for correctness on right-click-outside-selection scenarios.
