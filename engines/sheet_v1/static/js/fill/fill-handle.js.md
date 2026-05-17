---
name: fill-handle.js
description: Drag fill handle — small square at selection bottom-right; drag down to fill rows, drag right to fill columns; numeric series auto-detected
type: module
---

# fill/fill-handle.js

**Description:** Renders a 7px fill handle at the bottom-right corner of the active selection. Drag down fills extra rows; drag right fills extra columns. Numeric series are continued with the detected step; text values repeat cyclically.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–9   | State  | `_handle`, `_indicator` — DOM elements created in init; `_isDragging`, `_selBounds`, `_cfg` |
| 11–12 | `configure(opts)` | Injects `getFilteredRows`, `getRowHeight`, `updateRowData`, `render` |
| 14–26 | `init()` | Creates `.fill-handle` and `.fill-indicator` divs, appends to body; registers mousedown + document mouseup for position updates |
| 28–48 | `update()` | Finds all `.cell-selected` TDs, computes bounding box, positions handle at bottom-right; called by GridManager after render and by document mouseup |
| 50–58 | `_onMousedown(e)` | Starts drag, shows indicator, registers mousemove/mouseup on document; cancels cut state if active |
| 60–73 | `_onMousemove(e)` | Updates `_indicator` rectangle during drag; direction determined by dx vs dy from selection corner |
| 75–140 | `_onMouseup(e)` | Determines fill count via `elementFromPoint` (target TD's data-row-idx/col-idx) with pixel fallback; collects fill tuples then sends one `ApiClient.batchUpdate` call |
| 142–153 | `_detectStep(vals)` | Returns the common numeric diff if all consecutive pairs share it, else null |
| 155–163 | `_fillValue(srcVals, step, i)` | Returns fill value for offset i: numeric increment (with detected step or default 1) or cyclic text repeat |

## Decisions

- **`elementFromPoint` for fill count**: more accurate than pixel-division since column widths vary. Falls back to `dy / rowHeight` for rows when the target is out of the rendered virtual-scroll window.
- **Fixed position overlay**: both `.fill-handle` and `.fill-indicator` use `position: fixed` to overlay on top of the grid without disturbing layout. Updated on every `render()` + every document mouseup.
- **Numeric increment default 1 for single-cell**: if only one source cell is selected and it's numeric, each fill step adds 1. This matches Excel. If multiple source cells are selected and all diffs are equal, that diff is used as the step.
- **Cyclic text repeat**: `i % srcVals.length` so a 2-cell source `["A", "B"]` fills as A, B, A, B…
- **CutPaste.cancelCut() on drag start**: prevents the user accidentally pasting cut cells into the fill destination.
- **Single batchUpdate call**: all fill tuples are collected before sending; one `ApiClient.batchUpdate(cells)` → `POST /rows/batch-update`. Eliminates N round-trips, makes fill atomic, and collapses undo to one entry. Cell tuple shape is `{row_id, col_slug, value}` to match the batch endpoint schema.
