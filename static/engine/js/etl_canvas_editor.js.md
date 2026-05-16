# static/engine/js/etl_canvas_editor.js

**Description:** Interactive ETL canvas editor IIFE. Renders the ETL model as a draggable DAG on the `/tool/{pid}/{tid}/etl` page; toggled against the code view via Canvas/Code buttons. Reads and writes the shared model through `EtlEditor.getModel()` / `EtlEditor.loadModel()`.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_model` | state | Deep-copied ETL model (sources, transformations, final_relation_id) |
| `_toolCols` | state | Tool's own non-system columns — used to populate the Destination node |
| `_positions` | state | `{nodeId: {x,y}}` — persisted in localStorage |
| `_pan`, `_zoom` | state | Viewport transform; applied via CSS `transform` on `#ecv-canvas-inner` |
| `_pendingAddFrom` | state | Node id whose `+` button was clicked; consumed by `addNode()` |
| `_canvasInited` | state | Guards `_initCanvas()` so event listeners attach only once |
| `DEST_ID` | const | `'__destination__'` — synthetic id for the Destination node |
| `_posKey()` | internal | localStorage key scoped to project + tool |
| `_buildGraph()` | internal | Builds `{nodes, edges}` from model; appends Destination node + edge from `final_relation_id` |
| `_tLabel(t)` | internal | Human label for a transformation node |
| `_tDetail(t)` | internal | One-line detail string (col count, join type, etc.) |
| `_autoLayout(nodes, edges)` | internal | BFS topological layout; returns `{nodeId: {x,y}}`; Destination lands in last layer |
| `_applyTransform()` | internal | Applies `_pan` + `_zoom` via CSS transform on `#ecv-canvas-inner` |
| `_renderNodes(nodes)` | internal | Writes node card HTML into `#ecv-nodes-layer`; attaches drag + click + add-button listeners |
| `_renderEdges(edges)` | internal | Draws SVG bezier paths + transparent hit-area paths in `#ecv-edges-svg`; hit paths carry `data-from`/`data-to` |
| `_render()` | internal | Full re-render: nodes → edges → transform |
| `_onNodeMousedown` | internal | Starts drag; ignores clicks on `.ecv-add-btn` |
| `_onNodeClick` | internal | Opens side panel; skipped if drag occurred |
| `_initCanvas()` | internal | Attaches pan/zoom/drag listeners to `#ecv-canvas-wrap`; called once on first `activate()` |
| `_openPanel(nodeId)` | internal | Populates and opens `#ecv-panel`; shows JSON for transform/source nodes, column list for Destination |
| `closePanel()` | public | Removes `.ecv-panel--open` from `#ecv-panel` |
| `_showAddPopup(fromId, x, y)` | internal | Positions and shows `#ecv-add-popup`; sets `_pendingAddFrom` |
| `_hideAddPopup()` | internal | Hides popup; clears `_pendingAddFrom` |
| `addNode(type)` | public | Appends a new transformation after `_pendingAddFrom`; auto-positions it; advances `final_relation_id`; opens its panel |
| `_showAddSourcePopup(e)` | internal | Async; fetches project tools via `ApiClient.listProjectTools()`, populates `#ecv-src-popup`, positions it below the button |
| `addSource(type, name, alias)` | public | Appends a new source to `_model.sources`; auto-positions at left column; opens panel for non-table types |
| `_onEdgeClick(from, x, y)` | internal | Async; calls `ApiClient.etlPreview` with partial model (`final_relation_id = from`); delegates display to `EtlCanvasPreview` |
| `_loadToolCols()` | internal | `GET /api/engines/{id}/columns` → filters non-system columns into `_toolCols` |
| `activate()` | public | Syncs model from EtlEditor, loads tool cols, shows canvas, inits canvas once, auto-layouts new nodes, renders |
| `deactivate()` | public | Pushes model to EtlEditor, hides canvas, shows code view |
| `init(projectId, toolId)` | public | Sets ids, loads positions from localStorage |
| `closePreview()` | public | Delegates to `EtlCanvasPreview.close()` |

## Dependencies

Requires the following globals to be available at load time (script order in `etl.html`):
- `EtlEditor` — `getModel()` / `loadModel()` (code-view partner)
- `EtlCanvasPanel` — `open()` / `close()`
- `EtlCanvasPreview` — `show()` / `showError()` / `close()`
- `ApiClient` — `listProjectTools()` / `etlPreview()` (from `api.js`, loaded before this module)

## Decisions

- **Separate IIFE from `etl_canvas.js`**: The old `etl_canvas.js` serves the read-only `/project/{pid}/canvas/{tid}` page and is kept intact. This module is only for the editor view on `/tool/{pid}/{tid}/etl`. Using separate modules avoids coupling two unrelated pages.
- **`_pendingAddFrom` cleared in `_hideAddPopup`**: `addNode()` saves the value into a local variable before calling `_hideAddPopup()` so the clear doesn't race.
- **Phase 1 side panel shows raw JSON**: The panel body is a placeholder (`<pre>` JSON dump) until Phase 2 introduces the restricted DSL formula bar. This lets the full canvas shell ship without the expression editor.
- **Destination node is synthetic**: `DEST_ID = '__destination__'` never exists in the model. It is injected by `_buildGraph()` at render time and removed before syncing back to `EtlEditor`.
- **`activate()` is async**: It awaits `_loadToolCols()` on first call so the Destination node shows accurate column count before rendering.
- **Canvas init guard**: `_canvasInited` prevents attaching duplicate event listeners if the user toggles Canvas/Code multiple times.
- **Edge hit-area paths**: Each edge renders two SVG paths — a thin visible one (`.ecv-edge`, `pointer-events: none`) and a wide transparent one (`.ecv-edge-hit`, `stroke-width: 14`, `pointer-events: stroke`). The hit path is the click target; the visual path is purely decorative.
- **SVG pointer-events**: `#ecv-edges-svg` no longer has `pointer-events: none` so child hit paths can receive events. The SVG background is transparent (no fill), so empty canvas areas are still clickable through to `#ecv-canvas-wrap` for panning.
- **Edge click guard in pan handler**: `_initCanvas` mousedown handler checks `e.target.classList.contains('ecv-edge-hit')` to prevent starting a pan gesture when clicking an edge.
- **Partial model preview**: `_onEdgeClick` builds `{ sources, transformations, final_relation_id: from }` and sends it to the ETL preview API. This compiles and runs only up to the `from` node, showing data at that pipeline stage.
