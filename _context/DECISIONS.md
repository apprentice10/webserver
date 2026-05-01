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

## D09 — Plugin discovery via `tools/*/tool.json` manifests

**Decision:** Tool types are discovered at startup by scanning `tools/*/tool.json`. `TOOL_CATALOG` in `engine/catalog.py` is built dynamically, not hardcoded.
**Rationale:** Adding a new tool type (Cable List, I/O List) requires only creating a folder with a manifest — no code change. The ETL engine is generic and works for any type_slug.
**What is NOT in the manifest:** `SYSTEM_COLUMN_DEFS` (tag/rev/log) — these are engine contracts, not per-plugin. ETL merge logic and `SYSTEM_SLUGS` depend on them being universal.
**Rejected:** Hardcoded list in catalog.py. Requires code change + redeploy for each new tool type.

