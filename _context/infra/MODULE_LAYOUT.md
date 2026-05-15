# infra/MODULE_LAYOUT.md

**Description:** Authoritative map of every source module — its responsibility, location, and companion `.md` rule. Read this at the start of every session.

**Companion rule:** Every source file has a `<name>.<ext>.md` in the same directory. No explicit listing needed — the rule is universal.

---

## Backend

| Module | Responsibility |
|--------|---------------|
| `main.py` | FastAPI app setup, static files, page routes |
| `core/routes.py` | `/api/project/` CRUD (new, open, delete, backup, fs browse) |
| `engine/project_db.py` | Per-project DB setup, `get_project_conn`, `SYSTEM_COLUMN_DEFS`, `audit()`, `_run_migrations` |
| `engine/routes.py` | `/api/tools/` core endpoints — thin layer, delegates to service |
| `engine/routes_flags.py` | Flag CRUD + cell-flag toggle endpoints |
| `engine/routes_etl.py` | ETL compile/preview/apply/run/save/config/schema endpoints |
| `engine/routes_export.py` | Excel export endpoint |
| `engine/service.py` | Core business logic: get_tool, get_rows, update_cell, create_row, get_columns |
| `engine/service_columns.py` | Column CRUD: add, update, delete, reorder, resize |
| `engine/service_row_ops.py` | Row mutations: soft/hard delete, restore, paste, rollback, override |
| `engine/service_templates.py` | ETL template CRUD |
| `engine/staleness.py` | ETL staleness helpers: `mark_tool_stale`, `mark_dependents_stale` |
| `engine/etl.py` | ETL preview/apply/run/save/schema |
| `engine/etl_model.py` | ETL model dataclasses (`EtlModel`, all transformation types) |
| `engine/etl_compiler.py` | ETL compiler orchestration: `compile_sql` |
| `engine/etl_compiler_expr.py` | Expression-to-SQL cluster: `expr_to_sql`, grammar constants |
| `engine/etl_compiler_graph.py` | Graph utilities: `_kahn_sort`, `_collect_ancestors`, `_output_aliases_for` |
| `engine/etl_compiler_validate.py` | Validation helpers: `validate_model`, `_validate_expr` |
| `engine/sql_parser.py` | SQL parsing: table refs, col lineage, alias resolution |
| `engine/sql_to_model.py` | SQL → ETL model conversion (reverse compiler) |
| `engine/sql_to_model_expr.py` | Expression subsystem for sql_to_model |
| `engine/sql_to_model_lexer.py` | SQL lexer utilities for sql_to_model |
| `engine/schemas.py` | All Pydantic request/response models |
| `engine/utils.py` | `slugify`, `now_str`, `format_log_entry`, `append_log` |
| `engine/catalog.py` | Dynamic scanner: `tools/*/tool.json` → `TOOL_CATALOG` |
| `tools/instrument_list/tool.json` | Plugin manifest for Instrument List |
| `_legacy/instrument_list/` | Dead code — **do not read** |

---

## Frontend — Root modules (`static/engine/js/`)

| Module | Responsibility |
|--------|---------------|
| `utils.js` | `escHtml`, `escAttr`, `showToast`, `formatTimestamp` |
| `api.js` | HTTP client — sole module allowed to `fetch` |
| `columns.js` | Column management IIFE |
| `resize.js` | Column resize + auto-fit |
| `paste.js` | Excel/CSV paste (range + append) |
| `grid.js` | Grid orchestration: render, virtual scroll, init, public API |
| `toolbar.js` | Toolbar actions, settings, ETL run |
| `sidebar.js` | Thin adapter over PanelSystem for sidebar open/close/toggle |
| `sql_editor.js` | Power SQL Editor panel |
| `etl_editor.js` | ETL Editor standalone page orchestration |
| `panel_system.js` | Panel registry, dock layout, float management, state persistence |
| `flags.js` | Flag management sidebar IIFE |
| `i18n.js` | EN/IT string tables, `applyLocale()`, `setLang()` |
| `app_shell.js` | Theme/accent/density management, settings modal, tool-pill, REV chip |
| `etl_canvas.js` | Project-level ETL DAG view (read-only node graph) |
| `etl_design.js` | ETL design canvas navigation |

## Frontend — Subsystem modules

| Module | Responsibility |
|--------|---------------|
| `history/history-api.js` | Thin wrappers over `ApiClient.getAudit` + `rollbackCell` |
| `history/history-renderer.js` | `renderAuditEntries`, `exportLog` — pure HTML generators |
| `history/history-panel.js` | `showRowLog`, `showCellLog`, `showRangeLog` — owns `_logSidebarCtx` |
| `history/rollback-service.js` | `bindRollbackButtons`, `_rollbackCell` — dispatches `grid:rowUpdated` |
| `history/history-actions.js` | Facade: resolves row then delegates to HistoryPanel |
| `selection/selection-manager.js` | Range selection state, highlight, keyboard selection |
| `keyboard/cell-keyboard.js` | Cell edit mode, keyboard nav, ghost row handlers |
| `context-menu/context-menu.js` | Context menu open/close, flags submenu |
| `rendering/grid-renderer.js` | Pure HTML generators: `renderRow`, `renderCell`, `renderGhostRow` |
| `row-ops/row-ops.js` | Soft/hard delete, restore, keepRow, removeOverride |
| `clipboard/clipboard-manager.js` | Ctrl+C range copy to clipboard |
| `cell-save/cell-save.js` | `doSaveCell`, `updateLogCell` |
| `panels/panel-floats.js` | Float panel create/drag/resize/proximity-snap |
| `panels/panel-tab-bar.js` | Tab HTML, render, drag-reorder, drag-to-float |
| `etl-editor/etl-expr.js` | ETL expression DSL tokenize/parse/serialize |
| `etl-editor/etl-model-renderer.js` | 7 public render functions for ETL model UI |
| `etl-editor/etl-preview-renderer.js` | `renderPreview`, `renderApplyResult`, `showMsg` |
| `etl-editor/etl-persistence.js` | Templates + file I/O + `etl:loadModel` event bridge |
| `etl_canvas_editor.js` | Interactive ETL canvas editor (node drag, SVG edges, side panel) |
| `etl_canvas_panel.js` | Type-specific side panels for canvas node editing |
| `etl_canvas_preview.js` | Edge-click partial preview panel |
| `etl_dsl.js` | Restricted DSL formula bar (recursive-descent parser + serializer) |

---

## CSS

| File | Responsibility |
|------|---------------|
| `static/css/main.css` | Design tokens, app shell, theme/accent/density |
| `static/engine/css/grid.css` | Grid, gutter, context menu, range readout |
| `static/engine/css/panel_system.css` | Dock zones, tab groups, floating windows |
| `static/engine/css/panels.css` | Sidebar panel content, info, log, history styles |
| `static/engine/css/sidebar.css` | Sidebar shell, flag sidebar |
| `static/engine/css/etl_canvas.css` | ETL canvas node/edge styles |

---

## Naming Conventions

- Backend extracted modules: `engine/<base>_<role>.py` (role suffixes: `_expr`, `_graph`, `_validate`, `_compiler`)
- Frontend subsystems: `static/engine/js/<subsystem>/` feature-oriented subdirectories
- Frontend IIFEs: `ModuleName = (() => { ... return {...}; })();` pattern
- Cross-subsystem DOM events: prefixed with emitting subsystem (`grid:`, `history:`, `selection:`)
