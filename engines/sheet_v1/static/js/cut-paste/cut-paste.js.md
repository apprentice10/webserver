---
name: cut-paste.js
description: Cut (Ctrl+X) state manager — marks cells with dashed border, captures values, pastes them to destination via batchUpdate then clears source
type: module
---

# cut-paste/cut-paste.js

**Description:** Implements Ctrl+X cut state for grid cells. Stores cut cell values, applies `.cell-cut` dashed-border visual after each render, and intercepts the native paste event (capture phase) to write values to the destination and clear the source. Uses `ApiClient.batchUpdate` so the entire cut+paste is one undo entry.

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
| 74–170 | `_onPaste(e)` | If cut active: prevent default, stop propagation, call batchUpdate for destinations, then batchUpdate for source clears, dispatch `undo:updated` |
| 172–200 | `triggerCut()` | Programmatic cut trigger used by context menu — mirrors Ctrl+X without a keyboard event |
| 202–220 | `_copyToClipboard` | Builds TSV matrix from cut cells and writes to system clipboard |

## Decisions

- **Capture phase for paste**: `document.addEventListener('paste', _onPaste, true)` ensures CutPaste fires before PasteManager (bubble phase). `stopImmediatePropagation()` prevents PasteManager from also handling the event.
- **applyVisual() post-render**: called explicitly by GridManager after each `render()` because virtual scroll re-creates DOM elements; there is no persistent DOM node to keep the class on.
- **batchUpdate for atomicity**: two `batchUpdate` calls (destinations, then source clears) produce two undo entries. Accepted trade-off: if source-clear fails, destination is still written and one undo entry exists for it. Data is never lost.
- **`undo:updated` dispatched once**: after both batch calls settle, not per-cell.
- **Escape does not cancel during edit mode**: `CellKeyboard.isEditing()` guards the Escape handler.
- **TSV to clipboard**: values also written to system clipboard for Excel interop.
- **`triggerCut()`**: same logic as `_onKeydown` Ctrl+X branch, without the keyboard event guard. Used by the context menu.
