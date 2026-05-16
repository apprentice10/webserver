# static/engine/js/etl_canvas.js

**Description:** IIFE module for the per-tool ETL Canvas page. Loads a tool's
`etl_model` JSON and renders each source and transformation step as a draggable
node card with SVG bezier edges showing the data flow. Supports pan, zoom, and
ETL run for the current tool.

## Index

| Lines | Symbol / Section |
|-------|-----------------|
| 1–7   | Module docstring |
| 9–28  | State: `_projectId`, `_toolId`, `_model`, `_positions`, `_pan`, `_zoom`, drag state |
| 30–43 | localStorage helpers: `_posKey`, `_loadPositions`, `_savePositions` |
| 46–66 | `_buildGraph` — converts model to `{nodes, edges}`; sources get `kind:"source"`, transforms get `kind:"transform"` |
| 68–92 | `_sourceDetail`, `_transformLabel`, `_transformDetail`, `_condSummary` — display string helpers |
| 95–138 | `_autoLayout` — BFS-based layered layout (same algorithm as `etl_design.js`) |
| 141–219 | `_applyTransform`, `_nodeIcon`, `_nodeClass`, `_renderNodes`, `_renderEdges`, `_render`, `_esc` |
| 222–234 | `_initNodeDrag` — mousedown handler per node card |
| 237–291 | `_initCanvas` — pan (mousedown/mousemove/mouseup), zoom (wheel) |
| 294–310 | `_loadToolInfo` — fetches tool name + project name for breadcrumbs |
| 313–361 | `init(projectId, toolId)` — entry point |
| 363–378 | `run()` — POSTs to `etl/run-saved`, shows toast |
| 380–385 | `_showToast` — falls back to console if Utils not loaded |
| 388    | Public API export |

## Decisions

- **Same BFS layout as `etl_design.js`:** Sources land in layer 0, each
  transformation is placed at `max(layer of inputs) + 1`. The algorithm is
  duplicated (not shared) to keep both modules self-contained IIFEs.

- **`_buildGraph` normalises sources and transforms into a single node list:**
  Both have `id`; sources have no edges (inputs = []), transforms carry their
  `inputs` array. This lets the same layout and render code handle both.

- **Node type expressed via CSS class `ecn--{sub}`:** The `sub` field maps to
  the raw type string (`table`, `filter`, `join`, etc.), so adding a new
  transformation type only requires a new CSS rule — no JS change needed.

- **`run()` calls `POST /api/engines/{id}/etl/run`:** This runs the saved ETL
  model (not a preview), same as the "Run ETL" button in the toolbar. It does
  not call `etl-run-stale` (project-wide) — it is scoped to this single tool.

- **No `ApiClient` dependency:** The canvas page does not load `api.js` (it
  has no `TOOL_ID` global until `init()` fires). Raw `fetch` calls are used
  instead, consistent with `etl_design.js`.
