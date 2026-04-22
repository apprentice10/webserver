# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the server

```bash
# Activate the virtual environment first
source venv/Scripts/activate   # bash on Windows
# or
venv\Scripts\activate.bat      # cmd

# Start the dev server (auto-reload on file changes)
uvicorn main:app --reload

# API docs available at http://127.0.0.1:8000/docs
```

## Database migrations (Alembic)

```bash
# Create a new migration after changing models
alembic revision --autogenerate -m "describe the change"

# Apply pending migrations
alembic upgrade head

# Roll back one migration
alembic downgrade -1
```

All models that inherit from `Base` must be imported in `migrations/env.py` before autogenerate can detect them.

## Architecture

This is a FastAPI application for electro-instrumental engineering design. It manages projects, each containing one or more "tools" (e.g. Instrument List, Cable List, I/O List).

### Core concepts

**Table Engine** — the central abstraction. Every tool is a generic table stored using an EAV (Entity-Attribute-Value) model:
- `Tool` — a table instance belonging to a project (has a name, slug, revision, icon)
- `ToolColumn` — dynamic columns per tool (name, slug, type, width, position)
- `ToolRow` — rows with soft delete support and a human-readable `row_log`
- `ToolCell` — individual cell values (`row_id` × `column_id`)

Every tool has three immutable system columns: **TAG** (unique identifier per row, mandatory), **REV** (revision), **LOG** (auto-generated change history). These are defined in `engine/service.py::SYSTEM_COLUMN_DEFS` and cannot be renamed or deleted.

**ETL Engine** (`engine/etl.py`) — runs SQL queries against the SQLite database to populate tool tables. On `etl_apply`, it merges results by TAG: updates existing rows (skipping cells where `is_overridden=True`, i.e. manually edited), and inserts new rows. Missing columns are auto-created. ETL query versions are stored as JSON inside `Tool.query_config`.

**Audit log** (`core/audit.py`) — `write_log()` records every INSERT/UPDATE/DELETE to the `audit_log` table. It never commits itself; the caller's transaction wraps both the data change and the log write atomically.

### Module layout

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app setup, static files, templates, top-level routes |
| `database.py` | SQLAlchemy engine, `SessionLocal`, `Base`, `get_db()` dependency |
| `core/models.py` | `Project`, `ProjectSettings` models |
| `core/routes.py` | `/api/projects/` CRUD endpoints |
| `core/audit.py` | `AuditLog` model + `write_log()` / read helpers |
| `engine/models.py` | `Tool`, `ToolColumn`, `ToolRow`, `ToolCell` (EAV) |
| `engine/routes.py` | `/api/tools/` endpoints — thin layer, delegates to service |
| `engine/service.py` | All business logic: CRUD, TAG validation, soft delete, row_log |
| `engine/etl.py` | ETL preview/apply/save, version history |
| `tools/` | Legacy module (instrument_list) — superseded by the engine |

### URL structure

- `/` — homepage shell (Jinja2 `index.html`)
- `/tool/{project_id}/{tool_id}` — universal table view (`engine/table.html`)
- `/api/projects/` — project CRUD
- `/api/tools/project/{project_id}` — list/create tools for a project
- `/api/tools/{tool_id}/*` — columns, rows, cells, ETL, SQL editor

All `/api/tools/` endpoints except `project/{project_id}` require `?project_id=` as a query param for ownership validation.

### SQL editor vs ETL

The SQL editor (`POST /api/tools/{tool_id}/sql`) runs arbitrary SELECT/INSERT/UPDATE/DELETE against the raw SQLite database. DDL (`DROP`, `ALTER`, `TRUNCATE`, `ATTACH`, `DETACH`) is blocked.

The ETL editor (`/api/tools/{tool_id}/etl/*`) is higher-level: it runs a SELECT query and merges results into the tool's rows, respecting manual overrides (`is_overridden`).

### Frontend

Vanilla JS — no framework. Each feature has its own JS module under `static/engine/js/` (grid, toolbar, sql_editor, etl_editor, api, columns, paste, resize). Templates use Jinja2 and pass `project_id` / `tool_id` into the page as template variables.

### Git workflow

This project uses GitHub (`apprentice10/webserver`). After each significant change:
```bash
git add <files>
git commit -m "short description of what and why"
git push
```
