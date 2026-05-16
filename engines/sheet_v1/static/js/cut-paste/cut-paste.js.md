---
name: cut-paste.js
description: Cut (Ctrl+X) state manager — marks cells with dashed border, captures values, pastes them to destination on Ctrl+V then clears source
type: module
---

# cut-paste/cut-paste.js

**Description:** Implements Ctrl+X cut state for grid cells. Stores cut cell values, applies `.cell-cut` dashed-border visual after each render, and intercepts the native paste event (capture phase) to write values to the destination and clear the source.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–10  | State  | `_cutCells` — `[{rowId, row_tag, col_slug, value}]` or null; `_cfg` injected from GridManager |
| 12–13 | `configure(opts)` | Injects `getFilteredRows`, `getAllRows`, `updateRowData`, `render` |
| 15    | `isActive()` | Returns true when cut state is active |
| 17–21 | `cancelCut()` | Clears cut state and re-renders to remove dashed borders |
| 23–32 | `applyVisual()` | Queries all `input.cell-input` elements, toggles `.cell-cut` on their parent TDs; called by GridManager after every render |
| 34–37 | `init()` | Registers `keydown` (capture) for Ctrl+X/Escape and `paste` (capture) for interception |
| 39–72 | `_onKeydown(e)` | Escape → cancel cut; Ctrl+X → capture selection + build cut cells + copy TSV to clipboard |
| 74–145 | `_onPaste(e)` | If cut active and focus is on a cell input: prevent default, stop propagation, write values to destination, clear sources |
| 147–172 | `_copyToClipboard` | Builds TSV matrix from cut cells and writes to system clipboard via `navigator.clipboard.writeText` |

## Decisions

- **Capture phase for paste**: `document.addEventListener('paste', _onPaste, true)` ensures CutPaste fires before PasteManager (bubble phase). `stopImmediatePropagation()` prevents PasteManager from also handling the event.
- **applyVisual() post-render**: called explicitly by GridManager after each `render()` because virtual scroll re-creates DOM elements; there is no persistent DOM node to keep the class on.
- **Source clear after destination write**: source cells are cleared only after all destination writes succeed; cells that overlap between source and destination (e.g. moving a selection onto itself) are skipped to avoid data loss.
- **Escape does not cancel during edit mode**: `CellKeyboard.isEditing()` guards the Escape handler so the user can edit a destination cell without losing the cut state.
- **TSV to clipboard**: values are also written to the system clipboard so the user can paste into Excel if desired.
