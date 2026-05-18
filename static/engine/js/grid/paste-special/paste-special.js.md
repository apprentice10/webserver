---
name: paste-special.js
description: Ctrl+Shift+V smart paste dialog with 3 tabs — column mapper, paste text (positional), transpose
type: module
---

# paste-special/paste-special.js

**Description:** Opens a modal dialog on Ctrl+Shift+V with three paste modes selectable via tabs. All three use `ApiClient.batchUpdate` for atomic undo. Reusable programmatically via `open()`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–6   | State  | `_matrix` — parsed clipboard data; `_activeTab` — current tab id; `_cfg` injected |
| 8–9   | `configure(opts)` | Injects `getFilteredRows`, `updateRowData`, `render` |
| 11    | `init()` | Registers `keydown` listener for Ctrl+Shift+V |
| 13–20 | `_onKeydown(e)` | Guards then calls `open()` |
| 22–33 | `open()` | Reads clipboard, parses, calls `_renderModal()` |
| 35–38 | `close()` | Hides modal, clears `_matrix` |
| 40–43 | `switchTab(tab)` | Toggles `.ps-tab-active` on buttons and show/hide tab panels |
| 45–56 | `confirm()` | Branches on `_activeTab` to mapper/text/transpose handler |
| 58–90 | `_confirmMapper()` | Original column-mapper logic: reads dropdowns, builds updates, calls `_doBatchPaste` |
| 92–114 | `_confirmText()` | Positional paste: anchor = selection top-left, writes row-by-row across editable cols |
| 116–135 | `_confirmTranspose()` | Swaps rows↔cols: `_matrix[srcRow][srcCol]` → dest `(startRow+srcCol, startCol+srcRow)` |
| 137–153 | `_doBatchPaste(updates)` | Shared executor: `close()`, `batchUpdate`, dispatch `undo:updated`, render, toast |
| 155–175 | `_renderModal()` | Populates all three tab panels, resets to mapper tab |
| 177–188 | `_renderTextInfo/TransposeInfo()` | Updates info text when switching to text/transpose tabs |
| 190–240 | Helper functions | `_detectHeaderRow`, `_buildPreview`, `_buildMapper`, `_autoMatch`, `_updateRowCount`, `_parseClipboard`, `_csvSplit` |

## Decisions

- **`e.code === 'KeyV'` instead of `e.key === 'v'`**: Shift held returns 'V' uppercase; `e.code` is layout-independent.
- **Paste destination = current selection anchor**: all three tabs use `SelectionManager.getRanges()[0].start` as top-left origin.
- **Tab 1 (mapper)**: column-mapper with header detection and auto-match. Header row is skipped when "first row is header" is checked.
- **Tab 2 (paste text)**: raw positional paste, no mapping, anchor = selection top-left. Equivalent to Ctrl+V but opened via dialog.
- **Tab 3 (transpose)**: `_matrix[srcRow][srcCol]` maps to `(startRow+srcCol, startCol+srcRow)`. No mapper.
- **`_doBatchPaste` shared**: all three tabs converge to a single `[{rowId, slug, value}]` array and call the same executor. Consistent undo behavior across all modes.
- **`_activeTab` resets to `'mapper'` on every `open()`**: prevents stale tab state if user reopens the dialog.
