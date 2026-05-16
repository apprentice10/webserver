---
# engine/project_db.py

**Description:** Manages the lifecycle of per-project SQLite databases: system DDL, schema migration, FastAPI `get_project_conn` dependency, and audit logging.

## Index (~396 lines)

| Symbol | Description |
|--------|-------------|
| `DATA_DIR` | `Path` → `data/` in the project root |
| `BACKUPS_DIR` | `Path` → `data/backups/` — pre-migration safety copies |
| `SCHEMA_VERSION` | Current schema version integer — bump whenever DDL changes (see rule below) |
| `SYSTEM_COLUMNS` | Set `{"tag", "rev", "log"}` — slugs reserved for system columns |
| `INTERNAL_PREFIX` | `"__"` — prefix for internal columns (`__id`, `__position`, `__log`, `__created_at`) |
| `DDL_SYSTEM_TABLES` | SQL to create `_tools`, `_columns`, `_trash`, `_overrides`, `_audit`, `_flags`, `_cell_flags`, `_templates`, `_revisions`, `_revision_snapshots` |
| `create_project_db(path)` | Creates a new per-project DB with the full schema at `SCHEMA_VERSION`; seeds revision 0 ("First issue") |
| `open_project_db(path)` | Opens DB, reads `PRAGMA user_version`, runs migrations if needed, sets `conn._newer_than_server` |
| `_backup_pre_migration(db_path, from_version)` | Safety copy to `BACKUPS_DIR` before migrating; idempotent (skips if already exists) |
| `_migrate_to_v1(conn)` | Formal v0→v1 migration: absorbs all prior ad-hoc checks |
| `_migrate_to_v2(conn)` | v1→v2: adds `_revisions` + `_revision_snapshots`; seeds rev-0; resets TEXT `rev` column values to 0 on all tool tables |
| `_migrate_to_v3(conn)` | v2→v3: renames `instrument-list` type_slug → `sheet` in `_tools` and `_templates` |
| `_migrate_to_v4(conn)` | v3→v4: adds `engine_version TEXT NOT NULL DEFAULT '1.0'` column to `_tools` |
| `_run_migrations(conn, db_path)` | Versioned migration runner: each step in a transaction, backup before |
| `logger` | `logging.getLogger("engine.project_db")` — DEBUG on every open, ERROR with full traceback on any unhandled exception |
| `get_project_conn(request)` | FastAPI dependency: opens connection, returns 403 on non-GET if DB is newer than server; logs db_path, method, and any unhandled exception |
| `get_current_revision(conn)` | Returns `MAX(number)` from `_revisions` as int (0 if empty) — canonical source of truth for the active revision |
| `audit(conn, tool_slug, action, row_tag, col_slug, old_val, new_val, revision, change_type)` | Inserts a row into `_audit`; `revision` is `int` (Q2) |

## Decisions

- **Schema version bump rule (MANDATORY):** Before committing any change to `DDL_SYSTEM_TABLES` or any system table structure, you MUST: (1) add a new `_migrate_to_vN` function, (2) register it in `_MIGRATIONS`, (3) increment `SCHEMA_VERSION`. Triggers: adding/dropping a column on a system table, adding a new system table, changing a constraint or index. Not triggers: tool table changes, business logic, API changes.
- **`SYSTEM_COLUMNS` is not moved to plugins**: ETL merge requires `tag` as the key; `SYSTEM_SLUGS` in `etl.py` depends on these names. They are a universal engine contract.
- **Migrations are always non-destructive**: uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Never DROP, never rewrite data.
- **`get_project_conn` does not use `Query(...)`** for `project_id`: reads from `request.path_params` or `request.query_params` directly to avoid conflicts with routes that have `project_id` as both a path param and a query param.
- **Migration condition is `< SCHEMA_VERSION` (not `<=`)**: `open_project_db` only calls `_run_migrations` when the DB is behind — skips the call when already current. The old `<=` was harmless (migrations returned immediately) but misleading.
- **Post-refactor**: SQLAlchemy dependency removed. `get_project_conn` now uses `engine.project_index.get_db_path` instead of `core.models.Project` via ORM.
- **`_flags` / `_cell_flags`**: Flag system (Group E). `_flags` records available flags with name, color, `is_system`. `_cell_flags` associates flags with `(tool_slug, row_tag, col_slug)` — `col_slug=''` is the sentinel for row-level flags. System flags "manual_edit" and "ETL: Eliminated" are seeded in migrations with `INSERT OR IGNORE` (idempotent).
- **`col_slug=''` for row flags**: instead of NULL in the PK (SQLite does not guarantee unique on NULL), an empty string sentinel is used for flags applied to an entire row.
- **`rev` column type change (v2)**: system column `rev` changed from TEXT to INTEGER (default 0). New tool tables use `rev INTEGER DEFAULT 0`. Existing tables keep their TEXT declaration (SQLite limitation — no `ALTER COLUMN`), but all values are reset to `0` by the v2 migration. REV on a row tracks which revision last modified it (Q-D7).
- **`get_current_revision` is the sole source for active revision**: all mutation ops (`update_cell`, `create_row`, `restore_row`, `paste_rows`, `rollback_cell`, `etl_apply`) call this helper instead of using `tool["rev"]` (which is the tool-level document rev, unrelated). `audit()` `revision` param is `int`, not `str`.
- **`_revisions` seeding**: both `create_project_db` and `_migrate_to_v2` use `INSERT OR IGNORE` to seed revision 0 ("First issue"). New projects always start at revision 0 per Q-D14.
