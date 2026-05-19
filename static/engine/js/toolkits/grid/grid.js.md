---
name: toolkits/grid/grid.js
description: Grid Toolkit adapter — wraps GridManager for ToolkitHost; exposes grouping-filter, endpoint-switch, and data-access API to other toolkits
type: reference
---

# static/engine/js/toolkits/grid/grid.js

**Description:** Grid Toolkit adapter IIFE (`window.Grid`). Wraps the shared `GridManager` for use inside the `ToolkitHost` runtime. Owns `PanelSystem.init()` and `GridManager.init()` — the page template must not call these when a Grid Toolkit entry is present in `engine.json`. Registered by `ToolkitHost` as `host.getToolkit(decl.id)`.

See decisions in `_context/project/shared-grid-toolkit.md`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–14  | Module header | IIFE outer shell; module-level state (`_ctx`, `_decl`, `_id`, `_ownedColumns`) |
| 22–47 | `init(ctx, decl)` | Called by ToolkitHost; reads endpointBase, starts PanelSystem + GridManager, returns adapter API |
| 50–55 | `_interpolate(str, engine)` | Resolves `{placeholder}` tokens from `ctx.engine` (D-SGT-06) |
| 58–73 | `setGroupingFilter / clearGroupingFilter` | Client-side column filter via `SortFilterManager.setColumnFilter`; calls `GridManager.applySort()` |
| 75–88 | `setGroupingOwned / releaseGroupingOwned` | Locks/unlocks a column so users cannot change its filter; delegates to `SortFilterManager.setGroupingOwned` when available (wired in Phase 2) |
| 91–103 | `getAllRows / getColumns / getActiveFilters` | Read-only snapshots: rows, column metadata, current filter state |
| 106–124 | `setEndpointBase(newAddress)` | Full grid reset + reload per D-SGT-04 contract |
| 126–128 | `reload()` | Reloads current endpoint — for ETL updates or external sync |
| 131–140 | `saveCellValue(rowId, field, value)` | Delegates to `ApiClient.updateCell`; does NOT update in-memory rows — caller must call `reload()` after all saves |
| 143–145 | Return | `{ init }` — outer API for ToolkitHost |

## Decisions

- **Outer API vs instance API**: `window.Grid` exposes only `{ init }`. `init()` returns the full adapter API object (what `host.getToolkit(id)` returns). This separates the toolkit constructor from the runtime instance.
- **Synchronous `init`**: `init()` is NOT async. It fires `GridManager.init({ endpointBase })` as a background promise (`.catch` for error logging) and returns the API object immediately. This is required so ToolkitHost stores the real instance synchronously — Grouping.init (the next toolkit in declaration order) can then call `ctx.getToolkit('grid')` and get the live API, not a Promise.
- **`_ownedColumns` set**: tracks locally which column slugs are owned by Grouping. Delegates enforcement to `SortFilterManager.setGroupingOwned` (wired in Phase 2).
- **`setGroupingFilter` term format**: Uses `{ type: 'values', values: [value] }` — the same format written by the SortFilterManager checkbox UI. Ensures state is interoperable with `persistState()`.
- **`setEndpointBase` order**: Follows D-SGT-04 exactly — clear filters → clear selection → release owned columns → clear local set → emit `grid:endpointChanged` → reconfigure `ApiClient` → `reloadData()`. Callers must assume the grid is fully reset after this call.
- **PanelSystem guard**: `if (typeof PanelSystem !== 'undefined')` — allows the adapter to load in test environments without the full shell.
- **`getAllRows()` snapshot**: delegates to `GridManager.getAllRows()` which returns `[..._rows]` (copy). Callers must not mutate the array. See performance note in `ENGINE_AUTHORING.md`.
- **`saveCellValue` is an extension point for Catalog Toolkit (D-CAT)**: uses `ApiClient.updateCell` which already has the configured `endpointBase`. Caller (Catalog Toolkit) must call `reload()` after all saves to sync in-memory rows. Not part of the core Grid API contract.
