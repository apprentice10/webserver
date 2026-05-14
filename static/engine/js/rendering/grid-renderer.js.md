---
# static/engine/js/rendering/grid-renderer.js

**Description:** Pure HTML generators for grid rows, cells, ghost row, flag badges, and log preview. Extracted from `grid.js` in P4-G4. No state, no DOM reads — all inputs are explicit parameters.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 10–27 | `flagBadgesHtml(flags, overrideEtlValue)` | Renders `.cell-flag-badges` span with colored dots. Checks `FlagsManager.getHiddenIds()` / `isHiddenByName('manual_edit')`. |
| 29–33 | `formatLogPreview(rowLog)` | Returns first line of `row_log` as escaped HTML; returns `—` placeholder if empty. |
| 35–67 | `renderCell(row, col, isDeleted, rowIdx, colIdx)` | Renders a single `<td>`. Special-cases `log` (preview div + click handler) and `rev`/deleted (readonly). |
| 69–91 | `renderRow(row, columns, rowIndex)` | Renders a full `<tr>` including gutter, rev badge, row-level flag dots, and all cells. |
| 93–115 | `renderGhostRow(columns)` | Renders the empty ghost row at grid bottom for quick row insertion. |

## Decisions

- **Explicit params only**: all five functions receive their inputs as parameters — no closure access to `_rows`, `_filteredRows`, or any grid.js state. This makes them independently testable and reusable.
- **`FlagsManager` reference in `flagBadgesHtml`**: guarded by `typeof FlagsManager !== "undefined"` so the function degrades gracefully when `flags.js` is absent (e.g., unit test contexts).
- **`GridManager.getAllRows()` in `renderCell` template string**: this is a string literal embedded in an `onclick` attribute — the call happens at click time, not at render time. No runtime coupling to `GridManager` is introduced.
- **`_escHtml`/`_escAttr` aliases dropped**: `Utils.escHtml` / `Utils.escAttr` used directly — no aliases needed.
