Updated: 2026-05-19 10:00

# GLOSSARY.md

*Domain-specific and codebase-specific terms. Read when unsure about naming.*

---

**TAG** — The natural key of every row. Unique per tool table. User-defined (e.g. `FT-101`). Used as merge key in ETL (`ON tag = ?`). System column, immutable via UI.

**REV** — Revision field on each row (e.g. `A`, `B`). System column, editable.

**LOG** — Per-row audit field. Stores JSON of all cell changes: `[{ts, rev, col, old, new}]`. Displayed in the LOG column in the grid. System column, never edited directly.

**Engine** — A self-contained plugin that provides a specific document type (e.g. Sheet, Cable List). Defined by a manifest folder in `engines/` with an `engine.json`. In the database it is an instance stored in `_tools` with `tool_type` referencing the engine's `type_slug`.

**Engine Type (`type_slug`)** — The slug identifying an engine category (e.g. `sheet`, `cable_list`). Determines which ETL templates are available. Stored in `_tools.tool_type`.

**Utility** — A plugin of `"type": "utility"` in `engine.json`. Provides add-on capabilities (e.g. Code ETL, Canvas ETL) grouped by `utility_category`. Not user-instantiable; used internally by engines.

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

**Revision** — A named snapshot of a project at a point in time, identified by an auto-incrementing integer (Rev 0, Rev 1, …). Stored in `_revisions`. Only the latest revision is editable; older revisions are read-only snapshots. REV on each row tracks which revision last modified that row.

**Snapshot** — Full copy of a tool's rows + column definitions at the moment a new revision was created, stored as JSON in `_revision_snapshots`. Used to serve old revision data without touching live tables.

**viewingRevision** — Frontend state in `RevisionPicker`. `null` = viewing live data; integer = viewing snapshot of that revision number. Used as the gating flag for all read-only enforcement (CellSave, ContextMenu, ghost row, ETL).

**Registry DB** — `data/registry.db`. SQLAlchemy. Stores `projects` metadata and `tool_templates`.

**Per-project DB** — `data/{client}_{project}.db`. Raw sqlite3. Stores all tool data, columns, audit log, trash, overrides.

**IIFE** — Immediately Invoked Function Expression. The JS module pattern used throughout the frontend. Each module exposes its API via `window.ModuleName = { ... }`.

**query_config** — JSON blob stored in `_tools.query_config`. Contains `etl_sql`, `etl_history`, `etl_deps`. The ETL system's configuration per tool.

**lineage_info** — JSON blob on `_columns.lineage_info`. Stores which source table/column an ETL-created column was derived from (used in schema browser).

**Self-Contained Engine** — An engine plugin whose Python backend, JS/CSS frontend, HTML template, and manifest all live under `engines/<slug>/`. The dashboard package provides only shared infrastructure; the engine folder can be zipped and redistributed independently.

**Dynamic Loader** — The `main.py` startup routine that scans `engines/*/backend/routes.py` and `engines/*/static/`, imports each router, and mounts each static directory automatically. Adding a new engine requires no changes to `main.py`.

**Catalog Toolkit** — The Phase 4 toolkit that decorates the Grid Toolkit with catalog synchronization. Provides TAG autocomplete, tracked-column autocomplete, automatic fill on TAG match, divergence detection, catalog mode toggle, and Save-to-catalog. Configuration key: `tracked_columns`.

**Catalog Snapshot** — The full `catalog_{tool_id}` table loaded at toolkit init time. Stored in `toolkits.catalog` host state bucket. Shape: `{ [tag]: { col_slug: value, ... } }`. Updated by `Catalog.refreshSnapshot()`.

**Tracked Column** — A column slug listed in the catalog toolkit's `tracked_columns` config. Receives all four catalog behaviors: autocomplete, auto-fill on TAG match, inclusion in Save-to-catalog, and divergence detection. See D-CAT-06.

**Catalog Mode** — A grid view toggle that swaps the grid's dataset from the engine's working data to the catalog table (`catalog_{tool_id}`). Enabled via `Catalog.toggleCatalogMode()`. Grouping Toolkit continues to apply on top of whichever dataset is active.

**catalog-drift** — CSS class applied to a `<td>` when the cell's current value differs from the catalog reference value for that TAG. Visual indicator only — does not block editing. Tooltip shows `data-catalog-tooltip` attribute value.

