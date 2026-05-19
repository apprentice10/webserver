Updated: 2026-05-19 17:00

# DECISIONS.md

*Architectural decisions and rejected alternatives. Consult before proposing changes.*

---

## D01 — Per-project SQLite DB (not shared DB)

**Decision:** Each project gets its own `.db` file at `data/{client}_{project}.db`.
**Rationale:** Portability — one `.db` = one project, backup/move with no tooling. Prevents cross-project data leakage.
**Rejected:** Single shared SQLite or PostgreSQL. Overkill for single-user desktop-grade tool; removes portability.

---

## D02 — Flat tables, not EAV

**Decision:** Each tool becomes a real SQLite table with column-per-attribute.
**Rationale:** ETL SQL must be natural (`SELECT instrument_list.tag FROM instrument_list`). EAV makes this impossible.
**Rejected:** `ToolRow × ToolColumn × ToolCell` EAV model (was the original schema). Migrated away from it.

---

## D03 — Vanilla JS, no framework, no build step

**Decision:** Frontend is plain JS IIFEs under `static/engine/js/`. No React/Vue/Svelte.
**Rationale:** Zero build toolchain, no node_modules, no bundler. Target users are engineers, not web devs — the app may be run offline or distributed as a folder.
**Rejected:** React or Vue. Adds `npm install`, build step, and mental overhead with no benefit for this use case.

---

## D04 — ETL deps extracted at save time, not run time

**Decision:** `etl_deps` is computed during `save_etl_version` via SQL parsing, stored in `_tools.query_config`.
**Rationale:** Run-time parsing on every ETL execution would be wasteful. Deps only change when the SQL changes.
**Tradeoff:** `etl_deps` can be stale if SQL is edited in the editor but not saved. The UI must prompt save before run.
**Rejected:** Parse SQL at every `etl_run_saved` call.

---

## D05 — Deferred import for etl.py ↔ service.py circular dep

**Decision:** `from engine.service import mark_dependents_stale` is inside the `etl_run_saved` function body, not at module top.
**Rationale:** etl.py calls `mark_dependents_stale` from service.py; service.py imports from etl.py. Module-level import causes circular import error on startup.
**Rejected:** Extracting shared functions to a third module. Would require refactoring ~10 call sites.

---

## D06 — No ORM: all DBs use raw sqlite3

**Decision:** SQLAlchemy has been completely removed. Both the project index (`data/projects.db`) and per-project DBs use raw `sqlite3`.
**Rationale:** Per-project DBs require dynamic DDL (`ALTER TABLE`, dynamic column names) that ORM handles awkwardly. The project index is a single-table lookup — ORM is overkill. Raw sqlite3 gives full control everywhere.
**Rejected:** SQLAlchemy for the index only. Inconsistency without benefit; per-project DBs would still need raw sqlite3.

---

## D07 — Column identity is slug (not integer FK)

**Decision:** Columns are referenced by `slug` (text) everywhere: in the flat tool table, `_columns.slug`, `_overrides.col_slug`.
**Rationale:** Slugs survive reorder/rename operations; integer IDs would require FK updates across dynamic table columns.
**Tradeoff:** Slug rename requires coordinating `_columns`, the flat table column, and `_overrides`. Currently not supported in UI.

---

## D08 — `is_overridden` per (tool_slug, row_tag, col_slug)

**Decision:** Manual cell edits are recorded in `_overrides`; ETL skips those cells.
**Rationale:** Allows hybrid rows: some cells from ETL source, some manually corrected.
**Rejected:** Per-row override flag. Too coarse — would block ETL from updating any column in a touched row.

---

## D10 — Dual-write audit: `_audit` structured + `__log` text kept in parallel

**Decision:** All mutation operations write to both `_audit` (structured) and `__log` (text on the row). The LOG sidebar/cell views read from `_audit`; the LOG column cell preview reads `__log`.
**Rationale:** Replacing `__log` completely would require redesigning the LOG cell preview (which uses `row.row_log` from the serialized row without an extra JOIN). Dual-write avoids this risk while delivering full structured audit functionality.
**Tradeoff:** Data is duplicated per write; `__log` can become stale if `rollback_cell` adds a `[ROLLBACK]` prefix that doesn't parse cleanly as a log entry.
**Future:** Remove `__log` column and redesign the LOG cell preview to show entry count from a cached field once Group G is fully validated.

---

## D-S1 through D-S8 — Stateless server + local file management

**D-S1 — Project identity is the full `.db` path**: passed as `?db=...` on every API call. No integer IDs, no server registry.
**D-S2 — Filesystem browser is server-side**: `/api/fs/browse?path=...` returns dirs + `.db` files; `/api/fs/cwd` returns working directory. Last-used path from `localStorage`.
**D-S3 — Path required on New Project**: no silent default. UI disables Create button until both path and name are filled.
**D-S4 — Backup naming**: `{project_dir}/{subfolder_name}/{YYYYMMDD_HHMMSS}_{stem}.db`.
**D-S5 — Client-side backup trigger**: on-open (opt-in toggle) + `setInterval` timer (0 = disabled). Server only executes the backup, never schedules it.
**D-S6 — Remove from recents = localStorage only; Delete file = API**: `DELETE /api/project?db=...` removes the `.db` from disk.
**D-S7 — Export endpoint removed**: file is already local; user manages it via OS.
**D-S8 — `data/projects.db` deleted**: existing `.db` files must be re-opened manually via Open Project.
**Rejected:** keeping a server-side project list. Would require sync logic between server state and client state, and prevents running the server in read-only mode.

---

## D11 — Virtual scrolling for grid performance (not server-side pagination)

**Decision:** The grid renders only the visible window (~50 rows) into the DOM using fixed-height virtual scrolling. All rows are still fetched in a single API call and held in `_rows`.
**Rationale:** Column-copy must work on the full column (not just the visible page), client-side search must operate on the full dataset, and ETL operations are server-side. Virtual scrolling satisfies all three with no new endpoints.
**Constraints:** Row height is fixed (single-line cells, no wrapping). Overscan = 10 rows. Scroll handler throttled with `requestAnimationFrame`. After new-row creation, `scrollTop` is set to `newRowIndex × ROW_HEIGHT` before the DOM focus query.
**Scale target:** 20,000 rows per tool. JSON payload at that scale (~6–9 MB) is acceptable for localhost; `api.js` `loadRows()` signature is kept clean (`?limit=&offset=` can be added later for LAN/multi-user without touching `grid.js`).
**Rejected:** Server-side pagination (LIMIT/OFFSET on the row endpoint). Breaks column-copy, client-side search, and ETL preview without significant added complexity.

---

## D09 — Plugin discovery via `tools/*/tool.json` manifests

**Decision:** Tool types are discovered at startup by scanning `tools/*/tool.json`. `TOOL_CATALOG` in `engine/catalog.py` is built dynamically, not hardcoded.
**Rationale:** Adding a new tool type (Cable List, I/O List) requires only creating a folder with a manifest — no code change. The ETL engine is generic and works for any type_slug.
**What is NOT in the manifest:** `SYSTEM_COLUMN_DEFS` (tag/rev/log) — these are engine contracts, not per-plugin. ETL merge logic and `SYSTEM_SLUGS` depend on them being universal.
**Rejected:** Hardcoded list in catalog.py. Requires code change + redeploy for each new tool type.

---

## D13 — Explicit state passing for grid→history communication (Phase 4)

**Decision:** History modules receive grid state as explicit parameters — `row` object, `ranges` array, `filteredRows` array, `columns` array — rather than reading grid closure variables directly.
**Rationale:** History files live in a separate IIFE scope (`static/engine/js/history/`) and cannot access `grid.js` private variables. Explicit parameters make dependencies visible, keep history modules testable in isolation, and defer the need for a shared state abstraction (GridCore) until warranted.
**Tradeoff:** Callers in `grid.js` must look up rows and pass current state before each call. Slightly more verbose at the callsite.
**Rejected:** Callback injection (Option C) — weaker contract; GridCore accessor (Option B) — requires Phase 2 infrastructure that doesn't exist yet.

---

## D14 — DOM CustomEvent for history→grid communication (Phase 4)

**Decision:** After a successful rollback, `RollbackService` dispatches `grid:rowUpdated` (`{ detail: { rowId, row } }`) on `document`. `grid.js` listens in `init()` and calls `refreshRowDOM(rowId, row)`. History modules have no reference to `GridManager` or any grid internals.
**Rationale:** History files must not import or call grid internals — that recreates the monolith coupling. DOM CustomEvents provide complete subsystem isolation: history emits, grid reacts. The pattern is already present in this codebase (`grid:historyRendered` event).
**Convention:** All cross-subsystem events are prefixed with the emitting subsystem name (`grid:`, `history:`, `selection:`) and documented in the subsystem's `README.md`.
**Rejected:** Callback injection at init — tighter coupling and requires grid to expose an internal function reference; direct `GridManager.refreshRowDOM()` call — creates a history→grid dependency that violates the dependency direction rule.

---

## D12 — Schema versioning via `PRAGMA user_version` (Group J)

**Decision:** `PRAGMA user_version` stores the schema version integer. `SCHEMA_VERSION` constant in `engine/project_db.py` defines the version the running server produces. Migrations run in `_run_migrations()`, one transaction per version step. Legacy DBs (pre-versioning) have `user_version = 0` and are migrated to v1 on first open.
**Rationale:** `PRAGMA user_version` is built-in SQLite, zero schema overhead, always readable. A `_schema_version` table would add complexity with no benefit.
**Newer-DB-than-server:** `get_project_conn` returns HTTP 403 on non-GET requests; `GET /api/project` returns a `schema_warning` string so the frontend can show a banner.
**Safety:** A file copy is made to `data/backups/<stem>_pre_migration_v<N>.db` before any migration. If the copy fails, migration is aborted. If the migration fails mid-step, the transaction is rolled back; the DB stays at the previous version.
**Rejected:** Per-table version columns in `_project`; `_schema_version` table. Both add schema overhead without benefit over the built-in pragma.


---

## D16 — Engine ordering, grouping, and trash (Engine Management UX)

**D-EM01** File format for "load file" template: same ETL JSON format used by the existing saved-templates system.
**D-EM02** Jump to ETL editor (`/etl`) after create only when a template (dropdown or file) is active. Blank engine goes to `/tool`.
**D-EM03** Name uniqueness check is real-time, client-side, case-insensitive; compares against `_currentTools` cached at project open.
**D-EM04** Canvas tab (`"canvas-etl"`) is the localStorage default in the ETL editor, replacing `"code-etl"`.
**D-EM05** `_tools.position` (INTEGER DEFAULT 0) stores display order per-project. Seeded from `id` order in migration v5.
**D-EM06** `PATCH /{tool_id}/position` normalises all positions atomically — it reindexes the full ordered list, not just the moved item.
**D-EM07** `_tool_groups` table (migration v6): `id, name, icon, position, is_collapsed`. `_tools.group_id` is nullable FK.
**D-EM08** Deleting a group sets `group_id = NULL` on all member engines — no engine is ever lost.
**D-EM09** Soft-delete sets `is_trashed = 1, trashed_at, group_id = NULL` (migration v7). All engine-list queries filter `is_trashed = 0`.
**D-EM10** Dependency check before deletion uses `extract_table_refs` from `dashboard/sql_parser.py` on `etl_sql` in each active engine's `query_config`. Blocking dialog lists dependent names; no canvas opened.
**D-EM11** Restored engines always go to top-level ungrouped (`group_id = NULL`). Hard delete: drop tool table + delete `_columns`, `_templates` rows.

---

## D15 — Self-contained engine plugin layout (Group R6)

**Decision:** All files for a specific engine (Python backend, JS/CSS frontend, HTML template, manifest) live under `engines/<slug>/`. The `dashboard/` package contains only shared infrastructure (project DB, ETL, catalog, shared schemas, utils). Engine static files are served at `/engines/<slug>/static/` via `app.mount()`. The `engines/<slug>/backend/routes.py` module-level `router` attribute is the loader contract.
**Rationale:** Clean separation allows an engine to be zipped and redistributed. New engines require zero changes to `main.py` — just dropping a folder triggers auto-discovery. Keeps `dashboard/` focused on platform services, not document-type logic.
**Rejected:** Keeping Sheet routes in `dashboard/` — conflates platform and plugin; putting shared infrastructure in `engines/` — inverts the dependency direction.

---

## D17 — Column state (hide/order) stored in PanelSystem.extra (Group R)

**Decision:** `hiddenColumns: string[]` (slugs) and `columnOrder: string[]` (slugs) are stored under the existing `im_panels_${hash(DB_PATH)}` localStorage key via `PanelSystem.getExtra/setExtra(key, value)`. `_state.extra` is an optional sub-object in the panel layout state.
**Rationale:** Reusing the same key avoids a second hash computation and keeps all per-tool view state in one place. The `extra` field is additive — it does not affect the migration chain since readers use `|| {}`.
**Rejected:** Separate localStorage key in ColumnsManager — would require duplicating the `djb2`-style hash function.

---

## D18 — Column hiding via CSS `<style>` injection, not DOM filtering (Group R)

**Decision:** Hiding a column injects `[data-column-id="N"] { display: none !important; }` into a `<style id="col-visibility-style">` element. All `<td>` cells were updated to carry `data-column-id` so the same rule hides both header and data cells.
**Rationale:** Avoids changing `data-col-idx` values and all downstream consumers (SelectionManager, CellKeyboard, ClipboardManager). Cells remain in the DOM at correct indices.
**Tradeoff:** Keyboard Tab navigation may still land on hidden-column cells (display:none prevents mouse interaction but not programmatic focus in some edge cases). Clipboard copy including a hidden column in a drag range will include hidden data. Both are acceptable for a "visual hide" feature.
**Rejected:** Filtering via `getVisibleColumns()` — would require updating every getColumns() callsite: SelectionManager, CellKeyboard, ClipboardManager, paste.js, context-menu.js, table.html listeners.

---

## D19 — Density stored as integer 9–16px (Group R)

**Decision:** `im.prefs.density` is now an integer (9–16). `setDensity(px)` looks up `_DENSITY_TABLE` and sets `--row-h`, `--cell-pad-y`, `--cell-pad-x` CSS vars directly on the root element. Legacy string values `'dense'`/`'comfortable'` are migrated to 12/14 on read. The `[data-density="comfortable"]` CSS block is deleted.
**Rationale:** A slider gives fine-grained control; the old two-button segmented control was too coarse. CSS vars are already used by the grid for row height and cell padding.
**Rejected:** Keeping the CSS `[data-density]` attribute approach — would need N attribute values instead of a JS lookup table; also prevents fractional intermediate sizes.

---

## D20 — Toolkit definition (Phase 1: Toolkit System Core)

**Decision:** A toolkit is a configurable behavior layer on top of fixed engine infrastructure (grid-api, etl-api, DB). It defines UI behavior, data usage rules, and ETL/catalog configuration. It cannot create new backend routes or change DB structure directly.
**Rationale:** Clear boundary prevents toolkit scope creep. Engine infrastructure stays stable; toolkits compose on top of it without forking anything.
**Rejected:** Toolkit as full backend plugin — would duplicate engine infrastructure and break the separation between fixed platform and configurable behavior.

## D21 — Host is a frontend orchestrator only (Phase 1)

**Decision:** The Host (`static/engine/js/toolkit_host.js`) is a frontend-only module. It loads toolkit configs, instantiates toolkits, manages shared in-memory state, and routes events. It uses existing backend APIs (grid-api, etl-api) for persistence — it creates no new backend logic.
**Rationale:** Backend infrastructure is already complete. The Host's job is wiring, not extending infrastructure.

## D22 — Unified `toolkits` array in `engine.json` replaces `dashboard_uses` (Phase 1)

**Decision:** `engine.json` uses a single `toolkits` array: `[{ "id", "version", "order", "type" }]`. `type` is `"frontend"` or `"backend+frontend"`. `dashboard_uses` is retired.
**Rationale:** `grid-api v1` IS a toolkit — the split was artificial. One array covers all declarations uniformly.
**Rejected:** Keeping `dashboard_uses` alongside a new `toolkits` array — two arrays for the same concept creates ambiguity.

## D23 — Toolkit JS path resolved by convention (Phase 1)

**Decision:** Toolkit with `"id": "grouping"` maps to `static/engine/js/toolkits/grouping/grouping.js`. No explicit `src` field in `engine.json`.
**Rationale:** Convention over configuration. Consistent with existing grid toolkit path structure. Host derives path from ID.

## D24 — Jinja2 renders toolkit `<script>` tags; Host never loads scripts dynamically (Phase 1)

**Decision:** Engine templates emit `<script>` tags for declared toolkits in declaration `order` at render time. Host init runs after all scripts are already loaded.
**Rationale:** Dynamic script injection introduces async race conditions and loader complexity. Static tags keep load order deterministic, consistent with existing grid script discipline.

## D25 — `window.__ENGINE_CONFIG__` injected by Jinja2 at render time (Phase 1)

**Decision:** Jinja2 injects `window.__ENGINE_CONFIG__ = { slug, toolInstanceId, dbPath, endpointBase, toolkits: [...] }` into the page. Host init is synchronous — no fetch needed at startup.
**Rationale:** All data is available server-side at render time. Avoids an extra round-trip and keeps init simple.

## D26 — `toolkit_config` table for per-instance DB config (Phase 1)

**Decision:** Project DB has a `toolkit_config` table: `(tool_id TEXT, toolkit_id TEXT, config_json TEXT, PRIMARY KEY (tool_id, toolkit_id))`. Host fetches all rows for the tool instance in a single call at startup, merges with static defaults, passes merged config to each `init(ctx)`.
**Rationale:** Instance-specific toolkit settings (grouping columns, catalog bindings) are per-tool, not deploy-time. Single fetch keeps startup simple.

## D27 — Toolkit lifecycle = `init(ctx)` + `destroy()` only (Phase 1)

**Decision:** Toolkits expose exactly two lifecycle methods. State changes use `host.on`. Browser events handle resize/visibility. No additional hooks added until a concrete need arises.
**Rationale:** Minimal surface prevents over-engineering. Event-driven pattern already proven by existing grid modules.

## D28 — Four-bucket shared state (Phase 1)

**Decision:** Host shared state has four namespaced buckets: `engine` (immutable boot context), `toolkits` (per-toolkit owned state), `filters` (cross-toolkit data signals), `ui` (transient interface state — active toolkit, layout, open dialogs, temporary selections).
**Rationale:** `filters` stays data-oriented; `ui` captures transient display state that should not mix with business signals.

## D29 — Host event bus for cross-toolkit communication (Phase 1)

**Decision:** Cross-toolkit communication uses `host.emit(event, payload)` / `host.on(event, handler)` exclusively. DOM CustomEvents are reserved for toolkit-internal behavior and existing grid internals.
**Rationale:** Host is single source of truth for shared state. Routing mutations through the Host keeps state transitions visible and traceable. DOM events as a back channel would bypass Host control.

## D30 — Host public API surface (Phase 1)

**Decision:** The `host` object passed to `init(ctx)` exposes exactly: `emit`, `on`, `off`, `getState`, `setState`, `getToolkit(name)`, `config` (read-only merged static+DB config), `engine` (read-only boot context). No other surface.
**Rationale:** `getToolkit` enables controlled direct access between toolkits (e.g. request grid refresh) without abusing shared state. Keeping the surface minimal prevents toolkits from coupling to Host internals.

## D31 — ToolkitHost passes `decl` as second arg to `tk.init(ctx, decl)` (Phase 3)

**Decision:** `ToolkitHost` calls `tk.init(ctx, decl)` where `decl` is the full declaration object from `engine.json` (includes `id`, `type`, `config`, `version`, `order`). Toolkits use `decl.id` to read `ctx.config[decl.id]`.
**Rationale:** Toolkits need their own instance id to find their config in the shared `ctx.config` map. Without `decl`, a toolkit would need to hardcode its id, breaking reusability.
**Non-breaking:** Toolkits that only accept `ctx` simply ignore the second arg.

## D32 — Grid Toolkit adapter owns PanelSystem + GridManager init (Phase 3)

**Decision:** The Grid Toolkit adapter (`static/engine/js/toolkits/grid/grid.js`) is the sole caller of `PanelSystem.init()` and `GridManager.init()` on toolkit-aware pages. Page templates must NOT call these directly when a `"type": "grid"` toolkit is declared.
**Rationale:** Centralizes init order (PanelSystem before GridManager, D-SGT-02). Prevents double-init — `GridManager._initialized` guard makes the second call a no-op as a safety net.
**Legacy path:** Sheet V1 still calls `GridManager.init()` explicitly (no grid toolkit adapter declared). Both paths are valid.

## D33 — `engine.json` toolkit `type` field drives JS module resolution (Phase 3)

**Decision:** The `type` field in the toolkit declaration determines the JS file path: `static/engine/js/toolkits/<type>/<type>.js`. The `id` field is the registration key used in `host.getToolkit(id)` and cross-toolkit references. `id` and `type` are equal for single-instance toolkits (e.g. `id: "grid"`, `type: "grid"`).
**Rationale:** Allows future multi-instance support (two grids with different ids but same type). Current product constraint: one grid per page.
**Note:** ToolkitHost currently uses `_toPascalCase(decl.id)` for module lookup — safe because `id === type` for all current toolkits. If multi-instance is needed, ToolkitHost must be updated to use `type` for lookup.

## D34 — Catalog Toolkit bootstrap is a GET side-effect, not a migration (Phase 4)

**Decision:** `catalog_{tool_id}` is created by `GET /toolkit-config` (idempotent `CREATE TABLE IF NOT EXISTS`). It is not a versioned migration and not in `DDL_SYSTEM_TABLES`.
**Rationale:** Catalog table is tool-local, created on demand — not a system concern. Rolling it into migrations would require it to exist in every project DB regardless of whether the engine is used.

## D35 — Catalog table uses JSON blob, not mirrored DDL columns (Phase 4)

**Decision:** `catalog_{tool_id}` schema: `(tag TEXT PRIMARY KEY, data_json TEXT)`. Tracked column values are stored as a JSON object, not as dynamic DDL columns.
**Rationale:** Avoids schema migration when ETL adds/removes columns. `GET /catalog/rows` expands the JSON into flat row dicts compatible with the grid renderer.
**Rejected:** Mirrored DDL (`ALTER TABLE ADD COLUMN` per tracked column). Requires knowing column list at bootstrap time and adds schema-drift risk.

## D36 — `decl.config` as static defaults in ToolkitHost (Phase 4)

**Decision:** `ToolkitHost.init()` uses `decl.config ?? decl.defaults ?? {}` as the base layer before DB overrides. `decl.config` is the engine.json-declared toolkit config (e.g. `tracked_columns`).
**Rationale:** Phase 1 code used `decl.defaults` which never existed in `engine.json`. Catalog Toolkit requires `tracked_columns` from `engine.json` config to be visible in `ctx.config['catalog']`.

## D38 — Shared backend services for toolkit-owned system tables (Phase 5)

**Decision:** Image and annotation services (`dashboard/images.py`, `dashboard/annotations.py`) and their routes (`routes_images.py`, `routes_annotations.py`) live in `dashboard/` — the shared platform package — not inside the engine plugin folder. Engine routers include them via `include_router`.
**Rationale:** Multiple engines can use the Drawing Toolkit. Copying routes into each engine would create N copies with identical logic. Placing them in `dashboard/` makes them engine-agnostic, mounted per-engine via the router include pattern already used for ETL.
**Rejected:** Routes inside `engines/sheet_v1/backend/` — would require duplication for every engine that declares a `"type": "drawing"` toolkit.

## D39 — Row link by TAG string, not internal ID (Phase 5)

**Decision:** `_annotations.row_key` stores the TAG value (e.g. `"FT-101"`) rather than `__id`. Applies to any future toolkit data that needs to reference a grid row.
**Rationale:** TAG is the stable domain identity. `__id` is an internal integer that changes across ETL reload cycles and DB exports. A broken TAG link (after a rename) is explicit and observable; a broken `__id` link would be silent data corruption.
**Constraint:** Empty-TAG rows cannot be linked. TAG rename breaks the link explicitly — callers must handle `row_key` pointing to a non-existent row gracefully (treat as unlinked, not as an error).
**Rejected:** `__id` FK link — unstable across ETL cycles; `row_tag` JOIN at query time — couples annotation queries to the tool table structure.

## D37 — Catalog snapshot pre-seeded in Host state before toolkit inits (Phase 4)

**Decision:** `ToolkitHost.init()` populates `_state.toolkits['catalog']` from the toolkit-config response before calling any toolkit `init()`. `Catalog.init(ctx)` reads `ctx.getState('toolkits', 'catalog')` synchronously.
**Rationale:** Catalog snapshot is needed at init time (for datalist population). Requiring Catalog.init to do an async fetch would race with Grid.init's background load.
