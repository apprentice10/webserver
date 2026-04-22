# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Instrument Manager** is a professional web application for electro-instrumental engineering design of pharmaceutical plants. It is built as a modular, plugin-based workspace where each "tool" (Instrument List, Cable List, I/O List, etc.) is an independent technical document backed by a single centralised SQLite database.

The UI resembles a spreadsheet (similar to Google Sheets) with a left sidebar for tool navigation, a top bar with actions, and a central grid area. The grid supports inline cell editing, column resizing, paste from Excel/CSV, soft delete with visual strikethrough, row-level change log, and a Power SQL editor.

### Current development status

We are midway through **Phase 3 — Table Engine & ETL**. The following is complete and working:

- Project management (create, open, delete projects, persisted in `sessionStorage`)
- Universal **Table Engine**: every tool is an instance of the same engine, not a hardcoded module
- Dynamic columns: columns are created by the ETL Editor at apply time, not hardcoded
- System columns TAG, REV, LOG are immutable and always present
- Ghost row at the bottom of every grid for fast row insertion (no button needed)
- Inline cell editing with save-on-blur, keyboard navigation (Tab, Enter, Arrow keys)
- Paste from Excel/CSV — both range paste (onto existing cells) and append paste (creates new rows)
- Soft delete (rows appear struck through, can be restored) and hard delete (permanent, only on already-soft-deleted rows)
- Per-row LOG: every cell change is recorded with timestamp, revision, field name, old→new value
- Central audit log (`audit_log` table) for system-level tracing
- Column resize by drag (width saved to DB)
- Settings panel with two tabs: **Generale** (tool name, icon picker, revision) and **ETL Editor**
- ETL Editor: write SQL → Preview results → Apply (auto-creates missing columns, merges by TAG, respects `is_overridden` cells)
- ETL version history: save named query versions, reload from history
- ETL Schema Browser (right panel): lists all project tools with their columns and native DB tables — click a column name to insert it at cursor in the SQL editor (**in progress: schema loads but debug logging still present**)
- Power SQL Editor (bottom panel, separate from ETL): run arbitrary SQL for analysis
- Sidebar tool name and icon update dynamically when settings are saved
- "← Progetti" back button
- Mostra/Nascondi righe eliminate toggle

### What is NOT yet implemented (known backlog)

- Fix ETL Schema Browser loading (currently stuck on "Caricamento..." — debug logs present, needs investigation)
- Icon save bug: icon resets to previous value after saving settings
- Column resize speed not matching mouse movement
- Double-click column border to auto-fit width to content
- Toggle to hide/show LOG column
- Toggle to hide/show REV column
- Horizontal scrollbar for wide tables
- Export to Excel
- I/O List and Cable List tools (only Instrument List is actively used)
- Workspace file system (`.imanager` files) for opening/saving project DBs to any path on disk

## Running the server

```bash
# Activate the virtual environment first
venv\Scripts\activate

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

All models that inherit from `Base` must be imported in `migrations/env.py` before autogenerate can detect them. Currently imported: `core.models`, `core.audit`, `engine.models`.

## Architecture

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
| `engine/etl.py` | ETL preview/apply/save, version history, schema browser endpoint |
| `static/engine/js/api.js` | Single fetch client — all HTTP calls go through here |
| `static/engine/js/grid.js` | Grid rendering, inline editing, ghost row, soft delete, log modal |
| `static/engine/js/columns.js` | Dynamic column header rendering |
| `static/engine/js/resize.js` | Column resize by drag |
| `static/engine/js/paste.js` | Excel/CSV paste — range mode and append mode |
| `static/engine/js/toolbar.js` | Topbar actions, settings modal, tab switching, icon picker |
| `static/engine/js/sql_editor.js` | Power SQL editor panel |
| `static/engine/js/etl_editor.js` | ETL Editor: preview, apply, version history, schema browser |
| `tools/` | Empty — legacy instrument_list removed, reserved for future plugins |

### URL structure

- `/` — homepage shell (Jinja2 `index.html`)
- `/tool/{project_id}/{tool_id}` — universal table view (`engine/table.html`)
- `/api/projects/` — project CRUD
- `/api/tools/project/{project_id}` — list/create tools for a project
- `/api/tools/{tool_id}/*` — columns, rows, cells, ETL, SQL editor

All `/api/tools/` endpoints except `project/{project_id}` require `?project_id=` as a query param for ownership validation.

### SQL editor vs ETL

The SQL editor (`POST /api/tools/{tool_id}/sql`) runs arbitrary SELECT/INSERT/UPDATE/DELETE against the raw SQLite database. DDL (`DROP`, `ALTER`, `TRUNCATE`, `ATTACH`, `DETACH`) is blocked.

The ETL editor (`/api/tools/{tool_id}/etl/*`) is higher-level: it runs a SELECT query and merges results into the tool's rows, respecting manual overrides (`is_overridden`). It also auto-creates missing columns from the query result columns.

### Frontend

Vanilla JS — no framework. Each feature has its own IIFE module under `static/engine/js/`. Templates use Jinja2 and inject `PROJECT_ID` / `TOOL_ID` as global JS variables. The main entry point is `static/js/main.js` which manages project state via `sessionStorage` and handles sidebar navigation.

## Git workflow

**Always use Git and GitHub for every significant change.**

Commit messages must be clean, descriptive and follow this format:
```
<type>: <short description>

<optional body explaining why, not just what>
```

Types: `feat` (new feature), `fix` (bug fix), `refactor` (restructure without behaviour change), `style` (CSS/UI only), `docs` (documentation), `chore` (migrations, cleanup).

Examples:
```bash
git commit -m "feat: add ETL schema browser to settings panel"
git commit -m "fix: api.js ETL functions were outside IIFE closure"
git commit -m "refactor: remove legacy instrument_list module, replaced by engine"
```

Workflow after every meaningful change:
```bash
git add <specific files>        # never use git add . blindly
git commit -m "type: message"
git push                        # always push so GitHub has the latest version
```

This ensures:
- Every working state is saved on GitHub
- It is easy to roll back to any previous version
- The change history serves as a development log

Do not commit: `venv/`, `__pycache__/`, `*.pyc`, `instrument_manager.db`, `.env`. These should already be in `.gitignore`.
