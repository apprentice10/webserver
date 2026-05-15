# session/DONE/grid.md

*Completed grid/table engine features — append one bullet per closed task.*

---

* Universal Table Engine: inline cell edit, keyboard nav (Tab/Enter/Arrows)
* Ghost row at grid bottom for fast row insertion
* Paste from Excel/CSV (range paste + append paste)
* Soft delete (strikethrough, restorable) + hard delete (trash only)
* Per-row LOG column with full change history (rev, timestamp, old→new)
* Column resize + reorder by drag (persisted to DB)
* Settings panel: tool name, icon picker, revision
* Power SQL Editor (arbitrary SELECT/DML, no DDL)
* Right-click context menu (delete, restore, hard-delete, log)
* Toggle LOG column visibility (CSS class, no re-render)
* Toggle REV column visibility (CSS `.rev-hidden` class)
* Toolbar toggle buttons unified: icon + fixed label, `.active` CSS; deleted button adds 🗑 icon
* Double-click on `.resize-handle` → auto-fit column width; saves to backend
* Single click = select mode (readonly + light outline); double click / Enter / char = edit mode; Escape cancels; blur saves
* **Fix: drag-and-drop column reorder**: `_columns.map` iterated in original order; fixed with `userCols.forEach` that mutates positions in-place then `_columns.sort`
* Row numbers: Excel-style index column (fixed left, 1-based, not editable, empty in ghost row)
* Context menu "Remove manual override": `DELETE /{tid}/rows/{rid}/override?col=X`; visible only on overridden cells
* Triangle `is_overridden` + ETL tooltip: `_overrides` adds `etl_value TEXT`; auto migration; `INSERT OR IGNORE` preserves original ETL value; `overridden_cols` dict; frontend shows `title="ETL Value: ..."`
* Export Excel: `GET /api/tools/{tid}/export/excel` — openpyxl, blue bold header, freeze row 1, auto width, excludes LOG; "Export Excel" button in toolbar
* **Right-click inside range = keep selection + range context menu; right-click outside = new single-cell selection** (tasks 16–17)
* **Range selection + Shift+click + Ctrl+click + column/row header click** (tasks 10–14): `.cell-selected` highlight; `_rangeStart`/`_rangeEnd`; `_updateRangeHighlight()`; `getRange()`/`clearRange()` public
* **Ctrl+C range copy to clipboard** (task 15): `_initCopyToClipboard()`; bounding box; tab-separated rows; `navigator.clipboard.writeText()`; success toast
* **Sidebar shell** (task 18): `SidebarManager` IIFE; CSS class `sidebar-closed` on `.sidebar-panel`; 180ms width transition; starts closed
* **Sidebar: single cell LOG** (task 19): "View LOG cella" context menu; `showCellLog(rowId, colSlug)`
* **Sidebar: range LOG** (task 20): "View selection LOG" for multi-cell; `showRangeLog()`; collapsible tree
* **Flag DB schema** (task 25): `_flags` + `_cell_flags` tables; system flags "manual_edit" + "ETL: Eliminated"; `col_slug=''` sentinel for row-level flags
* **Multi-flag visual indicator** (task 27): `get_rows()` bulk-loads `_cell_flags`; `.cell-flag-badges` span with `.cell-flag-dot` circles; row-level flags in `.gutter-flags`
* **Flag management sidebar** (task 26): `FlagsManager` IIFE in `flags.js`; 4 backend routes; system flags color-only editable; inline color picker + name input
* **Cumulative flag tooltip + FLAG context menu** (tasks 28–29): individual `title` tooltips; "Flag ▶" submenu with checkmarks; toggle via `POST/DELETE /api/tools/flags/cell`
* **Selection-aware grid operations** (2026-05-07): `_doSaveCell` refactored to cell-shape objects; multi-row soft/hard delete; override remove for all selected cells; paste fills entire range on single-value Ctrl+V
* **Panel System Phase 3** (2026-05-07): `PanelSystem` IIFE — panel registry, right-dock layout state in localStorage (`instrumentManager.layout.v2`), `showPanel`/`hidePanel`/`togglePanel`/`closeAll`; `sidebar.js` rewritten as thin adapter; 3 panels registered (`info`, `log`, `flags`)
* **Panel System Phase 4+5 — floating windows + DnD** (2026-05-07): `moveToFloat(id, x, y)` + `dockPanel(id)`; `_renderFloats()` creates `.panel-float` elements; HTML5 DnD tab reorder; drag-to-float by dropping outside dock; float CSS in `panel_system.css`
* **UI redesign — Phase 1+2: design tokens, app shell, i18n** (2026-05-07): `static/css/main.css` full rewrite — oklch design tokens, light/dark themes, 4 accent variants, density; new CSS grid app shell; `base.html` Google Fonts, `[data-theme/accent/density]`; `i18n.js` EN/IT; `app_shell.js` theme/settings/tool-pill/REV chip management
* **UI redesign — Phase 3 cleanup** (2026-05-07): `togglePanelsDropdown` moved from inline HTML to `toolbar.js`; PanelSystem v3 state (adds `floats`); HTML5 DnD tab reorder within dock
* **UI redesign — Phase 4+5: panel content + context menu** (2026-05-07): `panels.css` new file; Info panel shows col name/type/value for single-cell, stats for range; Log panel fetches `ApiClient.getAudit` and renders timeline; context menu `.ctx-item` 3-column grid layout with shortcut hints
* **K-1 + K-2: Selection-aware Info and History panels** (2026-05-07): `_resolveSelection(ranges)` helper; Info panel single/range modes; History panel single/range fetch with grouped timeline; `panels.css` complete rewrite
* **K-3: Rename LOG → History + i18n wiring + density fix** (2026-05-07): panel id `'log'` → `'history'`; `i18n.js` `applyLocale()` added; `data-i18n` attributes on HTML elements; density: `.cell-input` uses `var(--cell-pad-y/x)` + `var(--row-h)`
* **K-4: Notes + SQL Editor as panels** (2026-05-07): `sql_editor.js` — `renderInto(body)`, `toggle()` delegates to PanelSystem; Notes and SQL panels registered in DOMContentLoaded
* **K-5/K-6/K-7: Bottom dock + right sidebar resize + proximity snap** (2026-05-07): PanelSystem v4 — `bottomDock` state; `_initSidebarResize()` (K-6); `_initBottomResize()` (K-5); `_checkProximity()` (K-7) 48px snap to dock; `dockPanel(id, 'right'|'bottom')`
* **Design sync — Conflicts A & B** (2026-05-07): **A** — 40px `.row-num` → 56px `.gutter` with `.gutter-num`/`.gutter-rev`/`.gutter-flags`; **B** — `.ctx-item` → `display:grid; grid-template-columns: 18px 1fr auto` with `.ctx-icon`; 3-span structure for all context menu items
* **UTC timestamp fix** (2026-05-07): `now_str()` and `format_log_entry()` changed to `datetime.now(timezone.utc)` with `%Y-%m-%dT%H:%M:%SZ` format; 2 inline `datetime.now()` calls in soft-delete + restore also fixed
* **Item 43 — Virtual scrolling + `__position` index** (2026-05-08): grid renders only visible window (~2×OVERSCAN rows) between `<tr class="vs-spacer">` spacers; RAF-throttled scroll; `_ranges` preserved across repaints; `_moveFocus` uses absolute `data-row-idx`; `CREATE INDEX idx_{slug}_pos` added + auto-migration
* **Group G — LOG as revision/audit system** (tasks 37–41): `_audit` table extended with `change_type, col_slug, revision, changed_by`; structured entries for all mutation paths; `GET /tools/{tid}/audit` endpoint; `POST /{tid}/rows/{rid}/rollback`; `showCellLog`/`showRowLog`/`showRangeLog` now async; "Export LOG" button; `sidebar.css` audit entry classes
* **Group N — Context menu cleanup** (2026-05-08): removed "View row history" item; renamed "View cell history" → "History"; removed `action === "log"` handler branch from `grid.js`
* **History Panel bug fix** (2026-05-08): `refreshRowDOM` now calls `_attachListeners()` + `_updateRangeHighlight()` after `outerHTML` replacement; `_rollbackCell` uses `refreshRowDOM`; `panel_system.js` floats respect `{silent:true}`; `showCellLog`/`showRowLog` dispatch `grid:historyRendered` to reset `_logLastKey`
* **Bug — History panel: click-old-value restore** (fixed 2026-05-08): `old_val` text rendered as clickable `<span class="sidebar-log-rollback">`; calls `_rollbackCell` directly; separate `↩` button and `confirm()` dialog removed
* **Group O — Range-aware row operations** (2026-05-15): `restoreRow`, `keepRow`, `removeOverride` in `row-ops.js` now read the active selection and filter to qualifying rows/cells only, falling back to the right-clicked row/cell if none qualify — matching the pattern already used by `softDeleteRow`/`hardDeleteRow`
