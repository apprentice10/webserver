# session/DONE/etl.md

*Completed ETL features — append one bullet per closed task.*

---

* ETL Editor (`/tool/{pid}/{tid}/etl`): SQL → Preview → Apply
* ETL: auto-creates columns, merges by TAG, respects `is_overridden` cells
* ETL version history, template save/load (scoped by type_slug + project_id)
* ETL staleness tracking: `is_stale` flag, orange badge in sidebar
* ETL dependency graph: `etl_deps` extracted from SQL at save time
* Topological ETL auto-run (`etl_run_saved` with `_visited` cycle guard)
* Circular dependency detection (HTTP 400 on cycle)
* Tool creation with ETL SQL from file + template scoping by tool type
* Schema browser in ETL editor
* **SQL syntax highlighting + auto-format** (Group F, tasks 30–31): CodeMirror 5 via CDN; `_cmEditor` replaces plain textarea; `formatSql()` uses `sql-formatter` v15 via CDN; graceful fallback to plain textarea if CDN scripts fail
* **ETL orphan row management** (Group F.1, tasks 33–36): `etl_apply` inserts `ETL: Eliminated` row-level flag for orphan tags; `POST /{tid}/rows/{rid}/keep` removes flag; "✓ Keep row" context menu item; `row-eliminated` CSS class
* **Bidirectional ETL — delete column** (Group H, task 44): `delete_column` detects ETL-generated columns via `lineage_info` and removes SELECT expression from saved SQL atomically; `sql_parser.remove_col_from_sql` added; `columns.js` shows ETL-aware confirm dialog
* **Bidirectional ETL — rename column + bug fix** (task 45b): `etl_apply` now persists applied SQL as draft (was root cause of delete not updating SQL); `sql_parser.rename_col_in_sql` appends or replaces `AS alias`; `update_column` detects ETL columns and rewrites via model
* **Model-first ETL — backend layer** (2026-05-02): `engine/etl_model.py` (dataclasses), `engine/etl_compiler.py` (`compile_sql`, `validate_model`); `engine/etl.py` rewritten — all functions accept `model: dict`; `query_config` now stores `{etl_model, etl_sql, etl_deps, etl_history}`; 9 tests in `tests/test_etl_model.py` green
* **Model-first ETL — frontend** (steps 5–8, 2026-05-02): `routes.py` replaced `EtlSqlBody` with `EtlModelBody`, added `POST /{tool_id}/etl/compile`; `service.py` rewrites via model; `api.js` all ETL methods send `{model}`; `etl_editor.js` full rewrite to structured model builder UI (Sources, Transformations, Output, Order By, Compiled SQL read-only)
* **ETL editor inline compile-error display** (2026-05-07): `.etl-compile-error` banner + `.etl-compiled-sql--error` red border; errors no longer buried in read-only textarea
* **Group M — ETL Design canvas** (2026-05-07): project-level DAG view at `GET /project/{id}/etl-design`; draggable node cards with SVG cubic-bezier edges; pan/zoom/drag; Run Stale / Run All buttons; API: `GET /api/projects/{id}/etl-graph`, `POST etl-run-stale`, `POST etl-run-all`
* **Group M Phase 1 — Visual ETL Canvas editor shell** (2026-05-08): canvas/code toggle in ETL editor page; draggable nodes with SVG bezier edges; `+` port button → popup → `addNode(type)`; side panel (Phase 1: raw JSON); `etl_canvas_editor.js` (347 LOC)
* **Group M Phase 2 — Restricted DSL Formula Bar** (2026-05-08): `etl_dsl.js` recursive-descent tokenizer + parser + serializer; `etl_canvas_panel.js` type-specific side panels (Source, Select, Filter, Join, Destination); formula bar validates on blur via `EtlDsl.tryParse`
* **Group M Phase 3 — Remaining Node Types** (2026-05-08): `etl_canvas_panel.js` extended with `_aggregateHtml`, `_computeColHtml`, `_genSeriesHtml`, `_cteHtml` builders and bind functions
* **Group M — Canvas: Add Source + Edge Data Preview** (2026-05-08): "+ Source" floating button fetches all project tools; edge-click calls `etlPreview` with partial model; `etl_canvas_preview.js` IIFE handles preview panel; hit-area SVG paths added
* **Group M — Visual ETL Canvas (all phases complete)** (2026-05-08): interactive canvas fully integrated; all node types; DSL formula bar; edge-click partial preview; no raw SQL in model — canvas compiles to AST only
* **ETL Canvas — per-tool pipeline visualization** (2026-05-07): `GET /project/{id}/canvas/{tool_id}` renders tool's `etl_model` as draggable node graph; BFS topological auto-layout; ▶ Run ETL button; `etl_canvas.js` + CSS + template created
