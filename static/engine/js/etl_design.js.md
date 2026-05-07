# static/engine/js/etl_design.js

**Description:** IIFE module for the ETL Design canvas page. Renders all project
tools as draggable node cards with SVG bezier edges showing ETL dependencies.
Supports pan, zoom, bulk run-stale and run-all.

## Index

| Lines | Symbol / Section |
|-------|-----------------|
| 1–8 | Module docstring |
| 10–21 | State variables: `_projectId`, `_graph`, `_positions`, `_pan`, `_zoom`, drag state |
| 24–43 | localStorage helpers: `_posKey`, `_loadPositions`, `_savePositions` |
| 46–60 | Fetch helpers: `_fetchGraph`, `_postRun` |
| 63–121 | `_autoLayout` — BFS-based layered layout |
| 124–135 | `_applyTransform` — applies pan+zoom CSS transform to `#etl-canvas-inner` |
| 137–144 | `_statusClass`, `_badge` — derive CSS class and badge text from node state |
| 146–175 | `_renderNodes` — builds node card HTML and attaches drag listeners |
| 177–201 | `_renderEdges` — draws cubic bezier SVG paths for each edge |
| 203–210 | `_render` — full render (nodes + edges + transform + empty hint) |
| 212–213 | `_esc` — HTML escape helper |
| 215–228 | `_updateNodeStates` — lightweight state-only update; reuses existing DOM |
| 231–246 | `_initNodeDrag` — per-node mousedown + click handler |
| 249–295 | `_initCanvas` — pan (mousedown/mousemove/mouseup on wrap), zoom (wheel) |
| 298–305 | `_loadProjectName` — fetches project name and updates crumb |
| 308–331 | `init(projectId)` — entry point |
| 333–341 | `refresh()` — re-fetches graph, calls `_updateNodeStates` |
| 343–356 | `runStale()` — POSTs `etl-run-stale`, shows toast per result, refreshes |
| 358–371 | `runAll()` — POSTs `etl-run-all`, shows toast per result, refreshes |
| 374–385 | `_setButtons`, `_showToast` — utility helpers |
| 388 | Public API export |

## Decisions

- **No `<canvas>` API:** SVG + absolutely-positioned divs are CSS-themed, DOM-inspectable,
  and require no pixel-ratio scaling. Bezier paths in SVG handle arbitrary graph layouts.

- **localStorage for positions:** Node positions are project-scoped (key includes `projectId`)
  and survive page reloads without a server round-trip. The server never needs to store layout.

- **`_autoLayout` on first load only:** Missing slugs trigger auto-layout, but existing saved
  positions are always kept. This lets users freely rearrange nodes without losing their layout.

- **`_updateNodeStates` vs full `_render`:** On `refresh()` only staleness badges and edge
  colors change — no need to destroy and recreate DOM nodes. Full `_render` is only called on
  `init()` to preserve drag positions and avoid scroll resets.

- **No external dependencies:** The page loads `utils.js` and `etl_design.js` only.
  `ApiClient` is not used here because the ETL Design page does not have a `TOOL_ID` — raw
  `fetch` calls go to `/api/projects/{id}/…` instead.
