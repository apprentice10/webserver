# DECISIONS.md
_Architectural decisions and rejected alternatives. Consult before proposing changes._

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

## D06 — SQLAlchemy only for registry DB

**Decision:** Registry DB (`data/registry.db`) uses SQLAlchemy ORM. Per-project DBs use raw `sqlite3`.  
**Rationale:** Per-project DBs require dynamic DDL (`ALTER TABLE`, dynamic column names) that SQLAlchemy Core handles awkwardly. Raw sqlite3 gives full control.  
**Rejected:** SQLAlchemy for both. Per-project schema is too dynamic for ORM mapping.

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
