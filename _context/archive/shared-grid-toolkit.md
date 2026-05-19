# Plan: Phase 3 — Shared Grid Toolkit (Integration Rules)

## Goal

Define integration rules and write the Grid Toolkit adapter (`static/engine/js/toolkits/grid/grid.js`) that wraps the existing grid machinery for use within the toolkit system. The grid itself (`static/engine/js/grid/`) is not modified. This phase produces a thin adapter that owns the grid lifecycle on behalf of the Host, exposes a controlled API surface to other toolkits, and preserves Sheet V1 behavior unchanged.

---

## Steps

- [x] Step 1 — Add auto-init guard to `grid.js`: check `window.__ENGINE_CONFIG__`; if present, skip auto-start
- [x] Step 2 — Write `static/engine/js/toolkits/grid/grid.js` IIFE exposing the full adapter API (see Decisions D-SGT-03)
- [x] Step 3 — Write companion `static/engine/js/toolkits/grid/grid.js.md`
- [x] Step 4 — Update `ENGINE_AUTHORING.md` with Grid Toolkit `engine.json` declaration format and integration rules
- [x] Step 5 — Update `SHARED_GRID_TOOLKIT.md` with auto-init guard note and adapter contract reference
- [x] Step 6 — Update `engines/mto_v1/engine.json`: add Grid Toolkit entry for materials grid
- [x] Step 7 — Smoke-test: Python imports clean; JS syntax valid; MTO/Sheet V1 transitional state documented. Full in-browser smoke test deferred to Phase 2 (grid:loaded event not yet added to grid.js reloadData)

---

## Decisions

**D-SGT-01 — Startup address ownership**
The adapter reads `endpointBase` from `ctx.config` at `init(ctx)` time. It starts immediately with that address. Any toolkit that needs to change the address later calls `setEndpointBase(newAddress)` on the adapter instance.

**D-SGT-02 — Adapter startup sequence**
Inside `adapter.init(ctx)`, in this order:
1. Read `ctx.config.endpointBase` (interpolated at render time — see D-SGT-06)
2. `PanelSystem.init()` — adapter owns panel setup, not the template
3. `GridManager.init({ endpointBase })` — adapter owns grid startup, not the template
4. `ctx.register(this)` — make instance available to other toolkits via `host.getToolkit(id)`
5. Subscribe to `grid:loaded` and other internal grid events

The page template is a dumb script loader only. It must not call PanelSystem or GridManager directly.

**D-SGT-03 — Adapter public API surface**

| Method | Behaviour |
|---|---|
| `setGroupingFilter(column, value)` | Applies a client-side column filter via SortFilterManager |
| `clearGroupingFilter(column)` | Removes the grouping filter for that column |
| `setGroupingOwned(column)` | Locks column so users cannot change its filter manually |
| `releaseGroupingOwned(column)` | Unlocks the column |
| `getAllRows()` | Returns read-only snapshot of current in-memory row array |
| `getColumns()` | Returns column metadata array: name, type, visibility, locked state |
| `setEndpointBase(newAddress)` | Resets filters, selection, and grouping state, then reloads grid data from new address |
| `reload()` | Reloads grid data from current address (for ETL updates, external sync, filter reset) |
| `getActiveFilters()` | Returns current filter state for state introspection and conflict avoidance |

Deferred (future phase): `onDataChanged` event hook for reactive subscribers.

`getAllRows()` is a snapshot — callers must not mutate the returned array. A paginated variant is a future extension point; do not call this method in a tight loop.

**D-SGT-04 — `setEndpointBase` reset contract**
Calling `setEndpointBase(newAddress)` must, in this order:
1. Clear all active filters (including grouping-owned filters)
2. Clear current selection state
3. Invalidate grouping state on any Grouping Toolkit targeting this instance
4. Reconfigure the API client to the new address
5. Call `GridManager.reloadData()`

No partial updates. Callers must assume the grid is fully reset after this call.

**D-SGT-05 — Instance isolation**
Each Grid Toolkit instance is fully self-contained. No module-level global state shared between instances. No implicit DOM queries that could bleed across grids. All cross-toolkit interactions target a specific instance by `id` via `host.getToolkit(id)`. `window.GridManager` is not the instance reference — the adapter's own returned object is.

"One grid per page" is a current product constraint, not an architectural one. A second grid instance requires only a second `engine.json` entry.

**D-SGT-06 — `endpointBase` interpolation**
`endpointBase` in `engine.json` may contain `{placeholder}` tokens. The Host resolves all tokens from `window.__ENGINE_CONFIG__` at render time before passing config to `adapter.init(ctx)`. Any variable present in `__ENGINE_CONFIG__` is a valid token. `{toolId}` is the first common case; the system is generic and extensible.

**D-SGT-07 — Feature level detection**
The grid auto-detects available features from backend HTTP responses (404/405 = feature absent, silently disabled). `featureLevel` is an optional field in `engine.json` config; if present it acts as a constraint hint, not a source of truth. Runtime detection wins.

**D-SGT-08 — Cross-toolkit contract: `id` as reference key**
The `id` field in the `engine.json` toolkit entry is the contract key. Grouping Toolkit (and future toolkits) reference this grid instance by its `id` in their own config (e.g., `target_toolkit_ids: ["materials-grid"]`). Renaming `id` breaks all cross-toolkit references. No role-based routing in Phase 3; role metadata is a future non-breaking addition.

**D-SGT-09 — `engine.json` Grid Toolkit declaration format**
```json
{
  "id": "materials-grid",
  "type": "grid",
  "version": "1",
  "order": 1,
  "config": {
    "endpointBase": "/api/engines/mto/{toolId}/materials",
    "featureLevel": "extended"
  }
}
```
`featureLevel` is optional. `order` must be lower than any toolkit that depends on this grid (e.g., Grouping Toolkit must have a higher `order`).

**D-SGT-10 — Auto-init guard in `grid.js`**
`grid.js` checks `window.__ENGINE_CONFIG__` at the end of its IIFE. If the object exists, grid auto-start is skipped — the adapter will call `GridManager.init()`. If absent, auto-start proceeds as today (Sheet V1 path). Sheet V1 is not modified and continues to work without any toolkit involvement.

**D-SGT-11 — Script load order responsibility**
The 25 grid core files are engine bootstrap dependencies, not toolkit dependencies. The page template loads them in strict sequential order (no `async`/`defer`) before any toolkit `<script>` tags. The adapter assumes grid core is fully booted when `init(ctx)` is called. The Host does not participate in grid core loading.

---

## Risks

- **`grid.js` auto-init guard**: the guard relies on `window.__ENGINE_CONFIG__` being injected by Jinja2 before `grid.js` executes. If the template renders the engine config block after grid scripts (wrong order), Sheet V1 would break. Verify template ordering in smoke-test (Step 7).
- **`setEndpointBase` reset scope**: if a Grouping Toolkit holds grouping-owned columns on a target grid and `setEndpointBase` is called, the Grouping Toolkit's internal state goes stale. The adapter must notify via `host.emit` so Grouping Toolkit can re-register ownership after reload.
- **`getAllRows()` on large datasets**: snapshot returns the full in-memory array. For engines with very large datasets, this will be slow. Acceptable for Phase 3 MTO scope; add a note to ENGINE_AUTHORING.md flagging this as a future optimization point.
- **MTO `mto_shell.js` migration**: `mto_shell.js` currently calls `GridManager.init()` and `PanelSystem.init()` directly. Once the adapter is live, these calls must be removed from `mto_shell.js` to avoid double-init. Coordinate with Phase 2 MTO migration (Step 7 of grouping-toolkit.md).
