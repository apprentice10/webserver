# static/engine/js/etl_canvas_preview.js

**Description:** Floating data-preview panel IIFE for the visual ETL canvas. Shows a scrollable table of the data flowing through a clicked edge, rendered by `EtlCanvasEditor` after a partial ETL preview API call.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_panelEl`, `_bodyEl`, `_titleEl` | state | Cached DOM references (lazily resolved on first call) |
| `_els()` | internal | Populates the cached DOM references from `#ecv-preview-panel`, `#ecv-preview-body`, `#ecv-preview-title` |
| `_esc(s)` | internal | HTML-escapes a value for safe insertion |
| `_position(x, y)` | internal | Clamps panel position within canvas-wrap bounds; shows the panel |
| `_tableHtml(data)` | internal | Builds a two-part HTML string: row count info bar + scrollable `<table>` (max 50 rows) |
| `show(data, x, y, fromId)` | public | Shows panel at `(x,y)` relative to `#ecv-canvas-wrap`; `data === null` renders a loading state |
| `showError(msg, x, y)` | public | Shows panel in error state (red message) |
| `close()` | public | Hides the panel |

## Decisions

- **Null `data` = loading state**: `EtlCanvasEditor._onEdgeClick` calls `show(null, ...)` immediately to show a spinner, then calls `show(data, ...)` again once the API responds. This avoids a blank panel during the fetch.
- **50-row cap**: Preview truncates at 50 rows (client-side slice). The API itself returns all rows for the partial model; truncation is only for display.
- **Positioned inside `#ecv-canvas-wrap`**: The panel uses `position: absolute` inside the canvas wrap, so it is unaffected by the canvas inner transform (pan/zoom). Coordinates passed by the editor are already relative to the wrap.
- **Lazy DOM resolution**: `_els()` is called on first use rather than at module load, since the DOM is not ready when the IIFE executes.
