# DONE.md

*Feature log — completed and verified in production.*

---

* Project management (create/open/delete, sessionStorage)
* Universal Table Engine: inline cell edit, keyboard nav (Tab/Enter/Arrows)
* Ghost row at grid bottom for fast row insertion
* Paste from Excel/CSV (range paste + append paste)
* Soft delete (strikethrough, restorable) + hard delete (trash only)
* Per-row LOG column with full change history (rev, timestamp, old→new)
* Column resize + reorder by drag (persisted to DB)
* Settings panel: tool name, icon picker, revision
* ETL Editor (`/tool/{pid}/{tid}/etl`): SQL → Preview → Apply
* ETL: auto-creates columns, merges by TAG, respects `is_overridden` cells
* ETL version history, template save/load (scoped by type_slug + project_id)
* Power SQL Editor (arbitrary SELECT/DML, no DDL)
* Right-click context menu (delete, restore, hard-delete, log)
* Toggle LOG column visibility (CSS class, no re-render)
* ETL staleness tracking: `is_stale` flag, orange badge in sidebar
* ETL dependency graph: `etl_deps` extracted from SQL at save time
* Topological ETL auto-run (`etl_run_saved` with `_visited` cycle guard)
* Circular dependency detection (HTTP 400 on cycle)
* Tool creation with ETL SQL from file + template scoping by tool type
* Schema browser in ETL editor
* Toolbar: stale badge, run ETL button, settings access
* Horizontal scrollbar for wide tables (`grid-scroll-container` + `width: max-content`)
* Toggle REV column visibility (CSS `.rev-hidden` class, same pattern as LOG toggle)
* Toolbar toggle buttons unified: icon + fixed label, `.active` CSS indicates state; deleted button adds 🗑 icon
* Double-click on `.resize-handle` → auto-fit column width to the widest content (header + visible cells), saves to backend
* Single click = cell selection (select mode, readonly + light outline), double click / Enter / char = edit mode; Escape cancels; blur saves and returns to select mode
* Fix: drag-and-drop column reorder had no visual effect — `_columns.map` iterated in original order and assigned positions in the wrong order; fixed with `userCols.forEach` that mutates positions in-place on shared references, then `_columns.sort`
* Row numbers: Excel-style index column (fixed on the left, background/text like header, not editable, does not participate in keyboard nav); 1-based number based on `_filteredRows` index; empty cell in the ghost row
* Context menu "Remove manual override": `DELETE /{tid}/rows/{rid}/override?col=X` restores `etl_value` in the cell and deletes the row from `_overrides`; item visible only on right-click on a cell with triangle
* Triangle `is_overridden` + ETL tooltip: `_overrides` adds column `etl_value TEXT`; automatic migration in `_migrate_project_db`; `INSERT OR IGNORE` preserves the original ETL value on first override; `overridden_cols` is now `dict[col_slug → etl_value]`; frontend shows `title="ETL Value: ..."` on the overridden `<td>`
* Export Excel: route `GET /api/tools/{tid}/export/excel?project_id=N` — openpyxl, blue bold header, freeze row 1, auto width, excludes LOG column; "Export Excel" button in toolbar calls `window.location.href` for direct download
* **Architectural refactor — plugin system + single project DB** (2026-04-26): completely removed SQLAlchemy; `registry.db` replaced by `data/projects.db` (raw sqlite3, `engine/project_index.py`); project metadata (`_project`) and ETL templates (`_templates`) now inside each project DB; `engine/catalog.py` now dynamically scans `tools/*/tool.json`; `tools/instrument_list/tool.json` created as plugin manifest; removed `database.py`, `core/models.py`, `core/audit.py`, `engine/models.py`
* **Range selection + Shift+click + Ctrl+click + column/row header click** (tasks 10–14): click or click+drag on cells selects a rectangular range; `.cell-selected` CSS highlight; `data-row-idx`/`data-col-idx` attrs on each `<td>`; `_rangeStart`/`_rangeEnd` track the anchor and drag end; `_updateRangeHighlight()` applies classes; Escape clears selection; cleared on `render()` and `_enterEditMode()`; `getRange()` / `clearRange()` exposed publicly for Shift+click (task 11) and Ctrl+C (task 15)
* **Ctrl+C range copy to clipboard** (task 15): `_initCopyToClipboard()` in `grid.js` intercepts `Ctrl+C`/`Cmd+C` when a range is selected and no cell is in edit mode; computes bounding box across all `_ranges`; builds tab-separated rows joined by `\n`; writes to clipboard via `navigator.clipboard.writeText()`; shows success toast with cell count; non-selected cells in the bounding box (discontinuous Ctrl+click selections) are copied as empty strings
* **Sidebar shell** (task 18): collapsible right-side panel (`#sidebar-panel`) toggled by toolbar button "▶ Info"; `SidebarManager` IIFE in `sidebar.js` exposes `toggle/open/close/isOpen/setTitle/setContent/clearContent`; open/close uses CSS class `sidebar-closed` on `.sidebar-panel` (180ms width transition); layout restructured — `.tool-body` flex-row wraps `.tool-main` (grid+note+sql) and `.sidebar-panel`; starts closed; ready for LOG and FLAG sections (items 19–20)
* **Sidebar: single cell LOG** (task 19): right-click on any data cell shows "Vedi LOG cella" in context menu; `grid.js::showCellLog(rowId, colSlug)` filters `row.row_log` entries by column slug (pattern `] COL_KEY:`), renders a meta header (column + row tag) and a list of timestamped change entries in the sidebar; CSS classes in `sidebar.css` (`.sidebar-log-*`); `_ctxColSlugLog` state variable captures the clicked column regardless of override status
* **Sidebar: range LOG** (task 20): right-click on a multi-cell selection shows "View selection LOG" in context menu (replacing "View cell LOG" which shows only for single-cell); `grid.js::showRangeLog()` iterates `_ranges`, groups log entries by column then by row tag, renders a collapsible tree in the sidebar; `_isSingleCellSelection()` helper determines which menu item to display; new CSS classes `.sidebar-log-group`, `.sidebar-log-group-header`, `.sidebar-log-row-label` in `sidebar.css`
* **Flag DB schema** (task 25): `_flags(id, name, color, is_system)` + `_cell_flags(tool_slug, row_tag, col_slug, flag_id)` added to `DDL_SYSTEM_TABLES` and migrated in `_migrate_project_db`; system flags "manual_edit" (`#FF8C00`) and "ETL: Eliminated" (`#DC143C`) seeded via `INSERT OR IGNORE`; `col_slug=''` used as sentinel for row-level flags to avoid NULL in composite PK
* **Multi-flag visual indicator** (task 27): `get_rows()` in `service.py` bulk-loads `_cell_flags` JOIN `_flags` and attaches `cell_flags: {col_slug: [{id,name,color}]}` to each row (`col_slug=''` = row-level); `_renderCell()` in `grid.js` injects `.cell-flag-badges` span with `.cell-flag-dot` circles (colored, titled) inside the `<td>`; `td[data-has-flags="true"]` gets `position:relative`; row-level flags rendered next to the row number via `.row-num-flags`; stacking supported (flex row of dots)
* **Flag management sidebar** (task 26): `FlagsManager` IIFE in `flags.js`; 4 backend routes under `/api/tools/flags[/{id}]?project_id=N` (GET list, POST create, PATCH update, DELETE); system flags: color-only editable, rename/delete blocked at API level; "⚑ Flags" button in toolbar opens sidebar panel; inline color picker + name input per row; add-form at bottom; CSS in `sidebar.css` (`.sidebar-flag-*`)
* **SQL syntax highlighting + auto-format** (Group F, tasks 30–31): ETL editor (`etl.html`) integrates CodeMirror 5 via CDN; `_cmEditor` replaces the plain textarea; SQL mode with line numbers, `Ctrl+Enter` → preview, Tab → indent; `formatSql()` uses `sql-formatter` v15 via CDN (UMD global), adds "⌥ Format" button to the actions bar; graceful fallback to plain textarea if CDN scripts fail to load
* **ETL orphan row management** (Group F.1, tasks 33–36): `etl_apply` computes orphan tags (existing rows not in ETL result) and inserts `ETL: Eliminated` row-level flag (`col_slug=''`) for each; removes the flag for rows that reappear in ETL source; audited as `ETL_ELIMINATED`; return dict includes `orphaned` count; route `POST /{tid}/rows/{rid}/keep?project_id=N` removes the flag and audits as `KEEP_ROW`; context menu entry "✓ Keep row" visible only on eliminated rows; `row-eliminated` CSS class applies crimson-tinted background + italic muted text to the entire row

