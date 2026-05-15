# GLOSSARY.md

*Domain-specific and codebase-specific terms. Read when unsure about naming.*

---

**TAG** — The natural key of every row. Unique per tool table. User-defined (e.g. `FT-101`). Used as merge key in ETL (`ON tag = ?`). System column, immutable via UI.

**REV** — Revision field on each row (e.g. `A`, `B`). System column, editable.

**LOG** — Per-row audit field. Stores JSON of all cell changes: `[{ts, rev, col, old, new}]`. Displayed in the LOG column in the grid. System column, never edited directly.

**Tool** — An independent technical document in a project (Instrument List, Cable List, I/O List, etc.). Backed by a flat SQLite table named by its `slug`.

**Tool Type (`type_slug`)** — Category of a tool (e.g. `instrument_list`, `cable_list`). Determines which ETL templates are available. Stored in `_tools.tool_type`.

**System Column** — `tag`, `rev`, `log`. Always present in every tool. Cannot be deleted or renamed. `is_system=1` in `_columns`.

**Internal Column** — `__id`, `__position`, `__log`, `__created_at`. Present in every flat tool table at SQLite level. Never shown in the UI grid. Not in `_columns`.

**Ghost Row** — The empty row rendered at the bottom of the grid. Pressing Enter/Tab on its cells creates a real new row.

**Override (`_overrides` table)** — A record of `(tool_slug, row_tag, col_slug)` indicating that a cell was manually edited. ETL skips writing to overridden cells even if the source data changed.

**is_stale** — Boolean flag on `_tools`. Set to `1` when a tool's data is mutated (any row operation) or when a dependency tool runs ETL. Set to `0` after `etl_run_saved` completes. Shown as orange badge in sidebar.

**etl_deps** — JSON array of tool slugs stored in `_tools.query_config`. Lists which tools' tables the ETL SQL reads FROM/JOINs. Computed at `save_etl_version` time, not at run time.

**Staleness Propagation** — After any row mutation in tool A, all tools that list A in their `etl_deps` get `is_stale=1`. Cascade: `mark_tool_stale → mark_dependents_stale`.

**Topological Run** — `etl_run_saved` recursively runs ETL on stale dependencies before running the current tool's ETL. Uses `_visited` set to detect cycles.

**ETL** — Extract-Transform-Load. SQL-based data pipeline: a SELECT query against other tool tables produces rows that are merged into the current tool by TAG.

**ETL Apply (`etl_apply`)** — Executes ETL SQL and merges results into the tool table. Does NOT update `is_stale`.

**ETL Run Saved (`etl_run_saved`)** — Orchestrates topological execution, calls `etl_apply`, then resets `is_stale=0` and propagates staleness downstream.

**Registry DB** — `data/registry.db`. SQLAlchemy. Stores `projects` metadata and `tool_templates`.

**Per-project DB** — `data/{client}_{project}.db`. Raw sqlite3. Stores all tool data, columns, audit log, trash, overrides.

**IIFE** — Immediately Invoked Function Expression. The JS module pattern used throughout the frontend. Each module exposes its API via `window.ModuleName = { ... }`.

**query_config** — JSON blob stored in `_tools.query_config`. Contains `etl_sql`, `etl_history`, `etl_deps`. The ETL system's configuration per tool.

**lineage_info** — JSON blob on `_columns.lineage_info`. Stores which source table/column an ETL-created column was derived from (used in schema browser).

