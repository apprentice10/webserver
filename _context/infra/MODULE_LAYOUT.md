# infra/MODULE_LAYOUT.md

**Description:** Authoritative map of every source module — its responsibility, location, and companion `.md` rule. Read this at the start of every session.

**Companion rule:** Every source file has a `<name>.<ext>.md` in the same directory. No explicit listing needed — the rule is universal.

---

## Backend — Shared Platform (`dashboard/`)

| Module | Responsibility |
|--------|---------------|
| `main.py` | FastAPI app setup, static files, page routes, dynamic engine loader |
| `core/routes.py` | `/api/project/` CRUD (new, open, delete, backup, fs browse) |
| `dashboard/project_db.py` | Per-project DB setup, `get_project_conn`, `SYSTEM_COLUMN_DEFS`, `audit()`, `_run_migrations` |
| `dashboard/routes_etl.py` | ETL compile/preview/apply/run/save/config/schema endpoints |
| `dashboard/staleness.py` | ETL staleness helpers: `mark_tool_stale`, `mark_dependents_stale` |
| `dashboard/etl.py` | ETL preview/apply/run/save/schema |
| `dashboard/etl_model.py` | ETL model dataclasses (`EtlModel`, all transformation types) |
| `dashboard/etl_compiler.py` | ETL compiler orchestration: `compile_sql` |
| `dashboard/etl_compiler_expr.py` | Expression-to-SQL cluster: `expr_to_sql`, grammar constants |
| `dashboard/etl_compiler_graph.py` | Graph utilities: `_kahn_sort`, `_collect_ancestors`, `_output_aliases_for` |
| `dashboard/etl_compiler_validate.py` | Validation helpers: `validate_model`, `_validate_expr` |
| `dashboard/sql_parser.py` | SQL parsing: table refs, col lineage, alias resolution |
| `dashboard/sql_to_model.py` | SQL → ETL model conversion (reverse compiler) |
| `dashboard/sql_to_model_expr.py` | Expression subsystem for sql_to_model |
| `dashboard/sql_to_model_lexer.py` | SQL lexer utilities for sql_to_model |
| `dashboard/schemas.py` | Shared Pydantic base models (non-Sheet-specific) |
| `dashboard/utils.py` | `slugify`, `now_str`, `format_log_entry`, `append_log` |
| `dashboard/catalog.py` | Dynamic scanner: `engines/*/engine.json` → `ENGINE_CATALOG` |

## Backend — Sheet V1 Engine (`engines/sheet_v1/backend/`)

| Module | Responsibility |
|--------|---------------|
| `engines/sheet_v1/backend/routes.py` | Combined router — aggregates all Sheet sub-routers for dynamic loader |
| `engines/sheet_v1/backend/routes_main.py` | Core Sheet endpoints: engine CRUD, column CRUD, row CRUD, cell update, audit, SQL query |
| `engines/sheet_v1/backend/routes_flags.py` | Flag CRUD + cell-flag toggle endpoints |
| `engines/sheet_v1/backend/routes_export.py` | Excel export endpoint |
| `engines/sheet_v1/backend/routes_revisions.py` | Revision system: create, list, delete, revert |
| `engines/sheet_v1/backend/schemas.py` | Sheet V1 Pydantic request/response models |
| `engines/sheet_v1/backend/service.py` | Core business logic: engine CRUD, get_rows, update_cell, create_row, get_columns |
| `engines/sheet_v1/backend/service_columns.py` | Column CRUD: add, update, delete, reorder, resize |
| `engines/sheet_v1/backend/service_row_ops.py` | Row mutations: soft/hard delete, restore, paste, rollback, override |
| `engines/sheet_v1/backend/service_row_position.py` | Row position ops: insert above/below, copy-insert, reorder |
| `engines/sheet_v1/backend/service_templates.py` | ETL template CRUD |
| `engines/sheet_v1/backend/routes_find_replace.py` | Find/replace + column autocomplete endpoints |
| `engines/sheet_v1/backend/routes_undo.py` | Undo/redo endpoints |
| `engines/sheet_v1/backend/service_row_batch.py` | Batch row/cell ops: `batch_row_op`, `batch_remove_override` |
| `engines/sheet_v1/backend/service_find_replace.py` | Find/replace business logic: `find_replace_cells`, `get_column_values` |
| `engines/sheet_v1/backend/service_undo.py` | Undo/redo stack: `do_undo`, `do_redo`, `get_stack_sizes` |
| `engines/sheet_v1/engine.json` | Plugin manifest for Sheet engine |

## Backend — MTO V1 Engine (`engines/mto_v1/backend/`)

| Module | Responsibility |
|--------|---------------|
| `engines/mto_v1/backend/routes.py` | Combined router — aggregates MTO sub-routers under `/api/engines/mto` |
| `engines/mto_v1/backend/routes_tools.py` | MTO tool instance CRUD: create, open, delete |
| `engines/mto_v1/backend/routes_typicals.py` | Typical CRUD: list, create, rename, delete |
| `engines/mto_v1/backend/routes_materials.py` | grid-api v1 core contract: columns CRUD, rows CRUD, cell update, reorder (scoped to `typical_id`) |
| `engines/mto_v1/backend/routes_materials_ext.py` | grid-api v1 extended contract: batch ops, paste, audit, find-replace, autocomplete, sort-filter state, Excel export |
| `engines/mto_v1/backend/service_etl.py` | MTO ETL apply/run: write to `mto_utilities`, sync `mto_typicals` |
| `engines/mto_v1/static/js/mto_shell.js` | MTO tab bar, page switching, typical CRUD, utilities load, shared grid init |
| `engines/mto_v1/static/js/mto_import.js` | Import panel IIFE: slide-in drawer to browse and import typicals from an external project DB |
| `engines/mto_v1/engine.json` | Plugin manifest for MTO engine |
| `_legacy/instrument_list/` | Dead code — **do not read** |

---

## Frontend — Shared Dashboard (`static/engine/js/`)

| Module | Responsibility |
|--------|---------------|
| `utils.js` | `escHtml`, `escAttr`, `showToast`, `formatTimestamp` |
| `api.js` | HTTP client — sole module allowed to `fetch` |
| `panel_system.js` | Panel registry, dock layout, float management, state persistence |
| `i18n.js` | EN/IT string tables, `applyLocale()`, `setLang()` |
| `app_shell.js` | Theme/accent/density management, settings modal, tool-pill, REV chip |
| `etl_canvas.js` | Project-level ETL DAG view (read-only node graph) |
| `etl_design.js` | ETL design canvas navigation |
| `etl-editor/etl-expr.js` | ETL expression DSL tokenize/parse/serialize |
| `etl-editor/etl-model-renderer.js` | 7 public render functions for ETL model UI |
| `etl-editor/etl-preview-renderer.js` | `renderPreview`, `renderApplyResult`, `showMsg` |
| `etl-editor/etl-persistence.js` | Templates + file I/O + `etl:loadModel` event bridge |
| `etl_canvas_editor.js` | Interactive ETL canvas editor (node drag, SVG edges, side panel) |
| `etl_canvas_panel.js` | Type-specific side panels for canvas node editing |
| `etl_canvas_preview.js` | Edge-click partial preview panel |
| `etl_dsl.js` | Restricted DSL formula bar (recursive-descent parser + serializer) |

## Frontend — Shared Grid Toolkit (`static/engine/js/grid/`)

| Module | Responsibility |
|--------|---------------|
| `grid.js` | Grid orchestration: render, virtual scroll, init, public API |
| `columns.js` | Column management IIFE |
| `sidebar.js` | Thin adapter over PanelSystem for sidebar open/close/toggle |
| `flags.js` | Flag management sidebar IIFE |
| `paste.js` | Excel/CSV paste (range + append) |
| `resize.js` | Column resize + auto-fit |
| `history/history-api.js` | Thin wrappers over `ApiClient.getAudit` + `rollbackCell` |
| `history/history-renderer.js` | `renderAuditEntries`, `exportLog` — pure HTML generators |
| `history/history-panel.js` | `showRowLog`, `showCellLog`, `showRangeLog` — owns `_logSidebarCtx` |
| `history/rollback-service.js` | `bindRollbackButtons`, `_rollbackCell` — dispatches `grid:rowUpdated` |
| `history/history-actions.js` | Facade: resolves row then delegates to HistoryPanel |
| `selection/selection-manager.js` | Range selection state, highlight, keyboard selection |
| `keyboard/cell-keyboard.js` | Cell edit mode, keyboard nav, ghost row handlers |
| `context-menu/context-menu.js` | Context menu open/close, flags submenu |
| `rendering/grid-renderer.js` | Pure HTML generators: `renderRow`, `renderCell`, `renderGhostRow` |
| `row-ops/row-ops.js` | Soft/hard delete, restore, keepRow, removeOverride, insertRowAbove, insertRowBelow, copyRowInsert |
| `row-ops/row-drag.js` | Drag-to-reorder via gutter handle: mousedown threshold, drop indicator, `reorderRow` API call |
| `clipboard/clipboard-manager.js` | Ctrl+C range copy to clipboard |
| `cut-paste/cut-paste.js` | Ctrl+X cut state: dashed-border visual, capture paste event, write to dest + clear source |
| `paste-special/paste-special.js` | Ctrl+Shift+V smart paste dialog: column mapper, header detection, preview table |
| `fill/fill-handle.js` | Drag fill handle at selection bottom-right: fill down (rows) or right (cols), numeric step detection |
| `cell-save/cell-save.js` | `doSaveCell`, `updateLogCell` |
| `panels/panel-floats.js` | Float panel create/drag/resize/proximity-snap |
| `panels/panel-tab-bar.js` | Tab HTML, render, drag-reorder, drag-to-float |
| `revision-picker/revision-picker.js` | Revision selector UI component |
| `autocomplete/autocomplete.js` | Column value autocomplete dropdown |
| `find-replace/find-replace.js` | Find/replace dialog: search, replace, match options |
| `sort-filter/sort-filter.js` | Sort and filter panel: multi-column sort, wildcard live-filter |
| `undo/undo-manager.js` | Undo/redo state machine: stack management, Ctrl+Z/Y dispatch |

## Frontend — Sheet V1 Engine (`engines/sheet_v1/static/js/`)

| Module | Responsibility |
|--------|---------------|
| `toolbar.js` | Toolbar actions, settings, ETL run (Sheet-specific) |
| `sql_editor.js` | Power SQL Editor panel (Sheet-specific) |
| `etl_editor.js` | ETL Editor standalone page orchestration (Sheet-specific) |

---

## CSS

| File | Responsibility |
|------|---------------|
| `static/css/main.css` | Design tokens, app shell, theme/accent/density |
| `static/engine/css/panel_system.css` | Dock zones, tab groups, floating windows (shared) |
| `static/engine/css/etl_canvas.css` | ETL canvas node/edge styles (shared, moves in R7) |
| `engines/sheet_v1/static/css/grid.css` | Grid, gutter, context menu, range readout |
| `engines/sheet_v1/static/css/panels.css` | Sidebar panel content, info, log, history styles |
| `engines/sheet_v1/static/css/sidebar.css` | Sidebar shell, flag sidebar |

---

## Naming Conventions

- Backend extracted modules: `engine/<base>_<role>.py` (role suffixes: `_expr`, `_graph`, `_validate`, `_compiler`)
- Frontend subsystems: `static/engine/js/<subsystem>/` feature-oriented subdirectories
- Frontend IIFEs: `ModuleName = (() => { ... return {...}; })();` pattern
- Cross-subsystem DOM events: prefixed with emitting subsystem (`grid:`, `history:`, `selection:`)
