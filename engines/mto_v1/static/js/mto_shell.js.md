# static/js/mto_shell.js

**Description:** MTO shell IIFE — owns the tab bar, page switching, and typical management for the Typical Assembly engine.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `MtoShell` | 2 | Top-level IIFE; exports `reloadTabs` |
| `_dbParam` | 17 | Returns URL-encoded `db=...` query string |
| `_fetchTypicals` | 19 | GET `/api/engines/mto/{tool_id}/typicals?db=...` |
| `_fetchToolName` | 24 | GET `/api/engines/mto/{tool_id}?db=...` to populate pill name |
| `_ensureContextMenu` | 35 | Creates context menu singleton on first use |
| `_showContextMenu` | 52 | Positions and shows the context menu for a typical |
| `_hideContextMenu` | 59 | Hides the context menu |
| `_createTypical` | 63 | POST to create a new typical, then auto-starts rename |
| `_saveRename` | 79 | PATCH to rename, then re-renders tab bar |
| `_deleteTypical` | 93 | confirm() + DELETE + re-renders |
| `_startRename` | 111 | Replaces tab button with an inline input; commits on blur/Enter, cancels on Escape |
| `_renderTabBar` | 133 | Builds tab buttons + `+` add button |
| `_renderPages` | 152 | Builds `<div class="mto-page">` elements with utilities section; fires `_loadUtilities` for active tab |
| `_loadMaterials` | 217 | Sets `endpointBase` for shared grid; calls `GridManager.init()` on first load, `ApiClient.configure()+GridManager.reloadData()` on tab switch |
| `_loadImage` | 241 | Delegates to `MtoImage.load(toolId, typicalId, db, imagePanel)` for the `.mto-image-panel` in the active page |
| `_fetchUtilities` | 209 | GET `/api/engines/mto/{tool_id}/utilities?typical_name=...` |
| `_loadUtilities` | 251 | Finds typical by id, fetches data, renders table into page's `.mto-utilities-wrap` |
| `_renderUtilitiesTable` | 263 | Renders read-only HTML table from `{columns, rows}` payload |
| `_esc` | 279 | HTML-escape helper |
| `_updateEmptyState` | 283 | Shows/hides empty state, pages container, and `#mto-materials-section` |
| `_switchTab` | 295 | Sets `.active` on tab, shows/hides page divs, calls load functions |
| `_runEtl` | 310 | Click handler for "▶ Run ETL" button — calls `etl/run`, shows toast, calls `reloadTabs` |
| `reloadTabs` | 340 | Public — re-fetches typicals, sets `_gridInitialized=false` to force full re-init, re-renders |
| `_init` | 353 | DOMContentLoaded entry point |

## Decisions

- Reads `window.MTO_TOOL` and `window.MTO_DB` injected by the Jinja2 template.
- Context menu is a singleton div appended to `document.body`; created lazily on first right-click.
- `_createTypical` immediately calls `_startRename` on the newly inserted tab — so the user types the real name right away instead of editing a generic default.
- `reloadTabs` is the only public export — re-fetches typicals and re-renders without full page reload.
- `_runEtl` wires the "▶ Run ETL" topbar button; calls `POST /api/engines/{tool_id}/etl/run` and on success calls `reloadTabs`. Button text reverts after completion even on error.
- `_renderTabBar` always re-renders from `_typicals` state; no partial DOM patching needed at this scale.
- `_renderPages` fires `_loadUtilities`, `_loadMaterials`, and `_loadImage` for `_activeId` at the end — all callers of `_renderPages` automatically refresh all panels for the active tab.
- `_switchTab` calls `_loadUtilities`, `_loadMaterials`, and `_loadImage` on every tab switch — all panels are re-fetched; no stale-data tracking needed at this stage.
- Each `.mto-page` now has two children: `.mto-image-panel` (left, 400px fixed) and `.mto-content-panel` (right, flex 1). Materials go into the content panel, not the page div directly.
- Utilities column list is dynamic: the backend uses `PRAGMA table_info` and returns whatever columns exist beyond the fixed internal ones.
- `_loadMaterials` uses two flags: `_gridInitialized` (prevents double `GridManager.init()` across tab switches) and `_panelSystemInitialized` (prevents double `PanelSystem.init()`). `reloadTabs` resets `_gridInitialized` so ETL re-runs get a fresh grid.
- The shared grid lives in a single DOM (`#data-grid`, `#grid-body`, etc.) below `#mto-materials-section` — not inside any per-typical `mto-page`. All typicals share one grid instance; tab switch reconfigures `endpointBase`.
