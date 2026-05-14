# templates/engine/table.html

**Description:** Jinja2 page template for the per-tool table view. Renders the grid, toolbar, sidebar panel, bottom dock, context menus, and the full inline JS that drives panel content (Info, History, Notes, SQL Editor, Flags).

## Index (~599 lines)

| Lines | Section / Symbol |
|-------|-----------------|
| 1–15 | Template head: extends `base.html`, CSS links (`layout`, `toolbar`, `grid`, `note`, `sql_editor`, `modal`, `sidebar`, `panel_system`, `panels`) |
| 17–33 | Topbar crumbs: project name, tool pill with icon and name |
| 26–33 | Topbar actions: REV chip, Excel export button |
| 34–192 | `{% block content %}`: tool-container with secondary toolbar, grid wrapper, sidebar panel, bottom dock |
| 38–88 | Secondary toolbar: search input, ETL reload button, ETL editor link, density segmented control, Panels dropdown |
| 91–130 | Tool body: `#grid-wrapper` + `#grid-scroll-container` + `<table#data-grid>`; `#sidebar-panel` right dock |
| 133–143 | `#bottom-dock` — K-5 bottom dock zone with resize handle and close button |
| 146–168 | Row context menu: delete, restore, hard-delete, keep-row, remove-override, cell-log, range-log, flags submenu |
| 170–175 | Column context menu: rename, delete |
| 177–190 | Modal `#modal-row-log`: history modal (legacy path, still triggered by `ctx.cell-log` / `ctx.range-log`) |
| 193–199 | Script block: `DB_PATH`, `TOOL_ID` template vars |
| 198–208 | Script tags: `utils.js`, `api.js`, `columns.js`, `resize.js`, `paste.js`, `grid.js`, `toolbar.js`, `panel_system.js`, `sidebar.js`, `flags.js`, `sql_editor.js` |
| 209–597 | DOMContentLoaded async block — all panel logic (no external module) |
| 213–216 | `_getPanelContainer(id)` — resolves float or dock body for a panel id |
| 220–231 | `_resolveSelection(ranges)` — computes bounding box + `isSingle` from GridManager ranges |
| 233–262 | `_renderTimeline(entries, ctx)` — renders `panel-hist-group` HTML; `ctx.rowId` enables rollback buttons |
| 264–287 | `_bindTimelineRollbacks(container)` — wires `panel-tl-rollback-btn` click to `ApiClient.rollbackCell` + DOM refresh |
| 290–319 | `_refreshInfo(container)` — Info panel refresh: resolves selection, falls back to focused cell-input |
| 321–358 | `_renderCellInfo(container, filteredRows, cols, r, c)` — single-cell info: tag, ROW/COL/VALUE/REV/LINEAGE grid + async CHANGES timeline |
| 360–439 | `_renderRangeInfo(container, filteredRows, cols, sel)` — range info: header, meta grid, numeric stats, distinct values |
| 441–506 | `_refreshLog(container, sel)` — History panel: cell fetches col-specific audit; range fetches combined and calls `_renderGroupedHistory` |
| 483–506 | `_renderGroupedHistory(entries)` — groups audit entries by col_slug → row_tag, renders nested `panel-hist-group` HTML |
| 508–556 | Event listeners: `focusin` (cell-input → refresh info+log), `mouseup` deferred (range selection → refresh info+log) |
| 555–556 | `grid:historyRendered` event resets `_logLastKey` to force re-fetch on next interaction |
| 558–594 | `PanelSystem.register()` calls for: `info`, `history`, `flags`, `notes`, `sql` |
| 594–597 | `PanelSystem.init()`, `ToolbarManager.init()`, `GridManager.init()` |

## Decisions

- **Inline JS in template (not a separate module)**: Panel orchestration code lives directly in the `<script>` block of `table.html` because it is the integration layer between all IIFE modules (`GridManager`, `PanelSystem`, `ColumnsManager`, `ApiClient`, etc.). Extracting it to a standalone IIFE would require exposing internal helpers as globals or passing them as arguments. The trade-off is accepted: panel JS is co-located with the HTML that defines panel structure.
- **`_renderTimeline` uses `panel-hist-group` wrapping each entry**: Each audit entry becomes its own `.panel-hist-group.panel-tl-{change_type}` div, which allows the CSS to apply per-change-type colour to `.panel-hist-subgroup-tag` via a parent-class selector. Prior flat-item layout (`panel-tl-item`/`panel-tl-col`) was replaced because it did not support the grouped range-history view.
- **`ctx.rowId` threading for rollback**: `_renderTimeline(entries, ctx)` receives `ctx.rowId` (the DB integer id) in addition to `ctx.rowTag` so that `ApiClient.rollbackCell(rowId, col, entryId)` can be called directly. The `rowTag` is stored as a `data-` attribute on the button for re-fetching history after rollback. Prior bug: `rowId` was not threaded through from `_refreshLog`, causing `getRowById` to fail silently.
- **`_logLastKey` dedup**: A module-level `_logLastKey` string (`cell::rowTag::colSlug` or `range::...`) prevents redundant API calls when the user stays on the same selection. It is reset to `null` on `grid:historyRendered` and before every rollback so the next interaction re-fetches fresh data.
- **`panel-tl-rollback-btn` renamed from `panel-tl-rollback`**: Button class was renamed to avoid collision with the `.panel-tl-rollback` colour rule applied to `.panel-hist-group` nodes. Using `-btn` suffix makes the selector unambiguous.
- **History panel id is `'history'` (not `'log'`)**: Renamed from `'log'` in Group K-3 to match title and avoid confusion with the `log` system column slug. All `SidebarManager.open('LOG')` calls were updated accordingly.
