---
name: row-drag
description: Drag-to-reorder rows via gutter handle — mousedown threshold, indicator, API call
type: project
---

# engines/sheet_v1/static/js/row-ops/row-drag.js

**Description:** Drag-to-reorder via the ⠿ handle in the row gutter. Drag starts only from `.gutter-drag-handle` so regular gutter clicks (context menu, click-to-select) are unaffected.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–20  | State vars | `_isDragging`, `_dragRowId`, `_indicator`, `_targetTr`, `_dropBefore`, `_startY`, `_started` |
| 21–24 | `configure(deps)` | Injects `reloadData` from grid.js |
| 25–30 | `init()` | Attaches delegated `mousedown` on `#grid-table` |
| 31–47 | `_onMousedown(e)` | Guards for `.gutter-drag-handle`, captures row id, sets start coords |
| 48–72 | `_onMousemove(e)` | After `DRAG_THRESHOLD=5px`, creates indicator; finds nearest non-dragged row; positions indicator above/below midpoint |
| 73–100| `_onMouseup()` | Calls `ApiClient.reorderRow(dragRowId, anchorRowId, placement)` then `reloadData()` |

## Decisions

- **`DRAG_THRESHOLD = 5px`**: prevents accidental drag on gutter clicks — drag only activates after 5px vertical movement.
- **`reloadData()` on drop**: full reload is simpler than in-memory position renumbering for reorder (positions of multiple rows change). Acceptable latency for an infrequent operation.
- **Delegated listener on `#grid-table`**: handles virtualized rows that are added/removed from DOM without re-binding.
- **`position: absolute` indicator**: avoids layout reflow; z-index 9999 keeps it above all grid content.
