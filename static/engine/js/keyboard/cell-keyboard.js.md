# static/engine/js/keyboard/cell-keyboard.js

**Description:** Keyboard navigation and cell edit-mode state machine extracted from `grid.js` (P4-G2). Owns the `_editingInput` state variable and all cell/ghost-row event handlers.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–10  | state  | `_editingInput`, `_cfg` |
| 12–15 | `configure(opts)` | Injects grid.js dependencies; must be called before first user interaction |
| 17–18 | `isEditing()` | Returns `true` when a cell is in edit mode; used by `_initCopyToClipboard` |
| 22–32 | `enterEditMode(input)` | Blurs any previous edit, clears selection, removes `readonly`, focuses+selects |
| 36–57 | `_scrollRowIntoView(rowIdx)` | Scrolls container to bring `rowIdx` into view; calls `forceRender` if the row is not yet in the DOM |
| 59–102 | `_moveFocus(input, dCol, dRow)` | Arrow/Tab/Enter navigation: maps `data-row-idx`/`data-col-idx` coords to next cell or ghost row |
| 106–112 | `onCellFocus` | Saves `originalValue`; adds `.selected` to row |
| 114–127 | `onCellBlur` | Restores readonly; calls `cfg.normalizeCells` + `cfg.doSaveCell` if value changed |
| 129–131 | `onCellDblClick` | Delegates to `enterEditMode` |
| 133–141 | `onCellPaste` | Single-cell paste in select mode: enters edit mode and sets value |
| 143–175 | `onCellKeydown` | Enter/Escape/Tab/Arrows/printable-key dispatch |
| 179–188 | `onGhostKeydown` | Enter/Tab triggers `cfg.createFromGhost`; Escape clears |
| 190–194 | `onGhostBlur` | Triggers `cfg.createFromGhost` if tag non-empty |

## configure() contract

```js
CellKeyboard.configure({
    getFilteredRows:  () => _filteredRows,   // current visible rows snapshot
    getRowHeight:     _getRowHeight,         // CSS --row-h reader
    normalizeCells:   _normalizeCellsFromInput,  // input → [{row_tag, col_slug}]
    doSaveCell:       _doSaveCell,           // async (inputEl, cell, newValue)
    createFromGhost:  _createFromGhost,      // async (tag)
    forceRender:      render,                // called by _scrollRowIntoView when row not in DOM
});
```

## Decisions

- **`_editingInput` moved here from grid.js** (P4-G2): the edit-mode state machine (`enterEditMode`, `onCellBlur`, `isEditing`) is a self-contained cluster; owning `_editingInput` prevents grid.js from reaching into the module's state.
- **Dependency injection via `configure()`**: follows the same pattern as `SelectionManager.configure()` (P4-G1). Grid.js retains row-data ownership (`_rows`, `_filteredRows`); this module accesses them through injected getters/callbacks only.
- **Regular `function` declarations for handlers**: event handlers are attached via `addEventListener`, so `this` must refer to the DOM element. Arrow functions would capture the wrong `this`.
- **`_scrollRowIntoView` lives here, not in grid.js**: it is only called from `_moveFocus`; keeping them together avoids an outbound call back into grid.js. The `forceRender` injection handles the one case where a render is needed.
