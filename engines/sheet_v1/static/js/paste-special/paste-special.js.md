---
name: paste-special.js
description: Ctrl+Shift+V smart paste dialog — column mapper with auto-match, header detection, preview table, and confirm paste
type: module
---

# paste-special/paste-special.js

**Description:** Opens a modal dialog on Ctrl+Shift+V that shows a preview of clipboard data and lets the user map incoming columns to sheet columns before pasting. Auto-matches columns by name. Reusable for future CSV import.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–6   | State  | `_matrix` — parsed clipboard data; `_cfg` injected from GridManager |
| 8–9   | `configure(opts)` | Injects `getFilteredRows`, `updateRowData`, `render` |
| 11    | `init()` | Registers `keydown` listener for Ctrl+Shift+V |
| 13–20 | `_onKeydown(e)` | Checks `e.code === 'KeyV' && e.shiftKey`; calls `open()` |
| 22–33 | `open()` | Reads clipboard via `navigator.clipboard.readText()`, parses, renders modal |
| 35–38 | `close()` | Hides modal, clears `_matrix` |
| 40–82 | `confirm()` | Reads column mapping from DOM dropdowns, writes cells via `ApiClient.updateCell` starting at current selection anchor |
| 84–99 | `_renderModal()` | Populates `#ps-preview`, `#ps-mapper`, `#ps-header-toggle`; shows overlay |
| 101–107 | `_detectHeaderRow(sheetCols)` | Returns true if the first clipboard row contains column name/slug matches |
| 109–117 | `_buildPreview(hasHeader)` | Renders first 5 rows as an HTML table; marks header row |
| 119–134 | `_buildMapper(incomingLen, sheetCols, hasHeader)` | Renders one dropdown per incoming column with auto-matched selection |
| 136–141 | `_autoMatch(headerVal, cols)` | Case-insensitive match against `col.name` or `col.slug` |
| 143–146 | `_updateRowCount()` | Updates `#ps-row-count` text based on header toggle state |
| 148–165 | `_parseClipboard` / `_csvSplit` | TSV or CSV parsing (same logic as paste.js) |

## Decisions

- **`e.code === 'KeyV'` instead of `e.key === 'v'`**: `e.key` with Shift held returns 'V' (uppercase), so `e.code` is more reliable here.
- **Paste destination = current selection anchor**: `confirm()` uses `SelectionManager.getRanges()[0].start` as the top-left paste origin. If nothing is selected, defaults to row 0.
- **Column mapper is header-first**: if no header detected, columns auto-map positionally (incoming col 0 → sheet col 0). This matches Excel's paste-special behavior for headerless data.
- **Unmatched columns default to `__ignore__`**: highlighted in the dropdown label so the user notices potential data loss before confirming.
- **Reusable structure**: `_parseClipboard` and `_buildMapper` are pure functions that accept a matrix; the dialog can be opened programmatically from a future CSV import feature via `open()`.
