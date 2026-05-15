# session/DONE/project.md

*Completed project management features — append one bullet per closed task.*

---

* Project management (create/open/delete, sessionStorage)
* **Architectural refactor — plugin system + single project DB** (2026-04-26): removed SQLAlchemy; `registry.db` replaced by `data/projects.db` (raw sqlite3, `engine/project_index.py`); `_project` + `_templates` inside each project DB; `engine/catalog.py` dynamically scans `tools/*/tool.json`; `tools/instrument_list/tool.json` created; removed `database.py`, `core/models.py`, `core/audit.py`, `engine/models.py`
* **Export Excel** (2026-05-01): `GET /api/tools/{tid}/export/excel` — openpyxl, blue bold header, freeze row 1, auto width; "Export Excel" button calls `window.location.href`
* **Group I tasks 47–48 — Project export/import** (2026-05-07): `GET /api/projects/{id}/export` returns `.db` as FileResponse; `POST /api/projects/import` accepts `.db` upload, validates SQLite magic bytes + `_project` table, copies to `data/`, registers in index; export (⬇) button + "📂 Import from file" button in Open Project modal
* **Stateless server + local file management** (D-S1 through D-S8, 2026-05-08): removed `data/projects.db` + `engine/project_index.py`; server is pure file-operation layer — project identity is full `.db` path as `?db=...`; `get_project_conn` reads `?db=` directly; `core/routes.py` rewritten: `POST /api/project/new`, `POST /api/project/open`, `GET/DELETE /api/project`, `POST /api/project/backup`, `GET /api/fs/browse`, `GET /api/fs/cwd`; `main.js` rewritten with localStorage recents + filesystem browser IIFE; all JS modules migrated from `PROJECT_ID` to `DB_PATH`; settings modal gains Backup tab
* **Group J — Schema versioning + compatibility** (2026-05-08): `PRAGMA user_version` stores schema version; `SCHEMA_VERSION = 1` constant in `engine/project_db.py`; `_run_migrations` versioned runner (one transaction per version step with rollback on failure); all pre-existing checks absorbed into `_migrate_to_v1`; safety backup to `data/backups/<stem>_pre_migration_v<N>.db`; HTTP 403 on writes from newer-DB-than-server; `schema_warning` in `GET /api/project` metadata; D12 in `infra/DECISIONS.md`
* **Group I task 49 — Automatic backup** (2026-05-08): on-open toggle + timer interval in Settings → Backup tab
