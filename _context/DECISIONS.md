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

## D12 — Schema versioning via `PRAGMA user_version` (Group J)

**Decision:** `PRAGMA user_version` stores the schema version integer. `SCHEMA_VERSION` constant in `engine/project_db.py` defines the version the running server produces. Migrations run in `_run_migrations()`, one transaction per version step. Legacy DBs (pre-versioning) have `user_version = 0` and are migrated to v1 on first open.
**Rationale:** `PRAGMA user_version` is built-in SQLite, zero schema overhead, always readable. A `_schema_version` table would add complexity with no benefit.
**Newer-DB-than-server:** `get_project_conn` returns HTTP 403 on non-GET requests; `GET /api/project` returns a `schema_warning` string so the frontend can show a banner.
**Safety:** A file copy is made to `data/backups/<stem>_pre_migration_v<N>.db` before any migration. If the copy fails, migration is aborted. If the migration fails mid-step, the transaction is rolled back; the DB stays at the previous version.
**Rejected:** Per-table version columns in `_project`; `_schema_version` table. Both add schema overhead without benefit over the built-in pragma.
