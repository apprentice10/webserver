# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Instrument Manager** is a professional web application for electro-instrumental engineering design of pharmaceutical plants. It is built as a modular, plugin-based workspace where each "tool" (Instrument List, Cable List, I/O List, etc.) is an independent technical document.

The UI resembles a spreadsheet: left sidebar for tool navigation, top bar with actions, central grid. The grid supports inline cell editing, column resize + reorder (drag), paste from Excel/CSV, soft delete with strikethrough, per-row change log, Power SQL editor, and a standalone ETL editor page.

### Current development status — what is working

- Project management (create/open/delete, persisted in `sessionStorage`)
- Universal **Table Engine**: every tool uses the same engine
- Dynamic columns created by the ETL Editor at apply time
- Ghost row at grid bottom for fast row insertion
- Inline cell editing (save-on-blur), keyboard navigation (Tab/Enter/Arrows)
- Paste from Excel/CSV (range paste + append paste)
- Soft delete (strkethrough, restorable) + hard delete (permanent, trash only)
- Per-row LOG column: records every cell change with timestamp, rev, old→new
- Column resize by drag (width saved to DB)
- Column reorder by drag (position saved to DB)
- Collapsible sidebar (state persisted in `localStorage`)
- Settings panel: tool name, icon picker, revision
- ETL Editor (standalone page `/tool/{pid}/{tid}/etl`): SQL → Preview → Apply
- ETL auto-creates missing columns, merges by TAG, respects `is_overridden` cells
- ETL version history, template save/load (scoped by tool type), schema browser
- Power SQL Editor (arbitrary SELECT/DML, no DDL)
- Right-click context menu on rows (delete, restore, hard-delete, view log)
- Toggle LOG column visibility (CSS class, no re-render)

### Known backlog

- Double-click column border to auto-fit width
- Toggle REV column visibility
- Horizontal scrollbar for wide tables
- Export to Excel
- Cable List and I/O List tools
- Workspace file system (`.imanager` files)

---

## Running the server

```bash
venv\Scripts\activate
uvicorn main:app --reload
# Docs: http://127.0.0.1:8000/docs
```

## Database migrations (Alembic)

Alembic manages only the **registry DB** (`data/registry.db`). Per-project DBs are managed programmatically.

```bash
alembic revision --autogenerate -m "describe change"
alembic upgrade head
alembic downgrade -1
```

Models imported in `migrations/env.py`: `core.models`, `engine.models`.

---

## Architecture

### Two-database design

**Registry DB** (`data/registry.db`, SQLAlchemy) — global metadata:
- `projects` table (`core/models.py::Project`) — project list with `db_path` field
- `tool_templates` table (`engine/models.py::ToolTemplate`) — reusable ETL SQL, scoped by `type_slug + project_id` (not per tool instance)

**Per-project DB** (`data/{client}_{project}.db`, raw sqlite3) — all tool data:
- `_tools` — tool metadata (name, slug, tool_type, icon, rev, query_config)
- `_columns` — column definitions per tool (name, slug, type, width, position, is_system)
- `_trash` — soft-deleted rows serialized as JSON
- `_overrides(tool_slug, row_tag, col_slug)` — manually-edited cells that ETL skips
- `_audit` — per-project change log
- `"{tool_slug}"` — one flat table per tool (e.g., `instrument_list`)

Each flat tool table has internal columns prefixed `__` (not in `_columns`, not visible to user):
`__id` (PK autoincrement), `__position` (sort order), `__log` (row change history), `__created_at`.

### FastAPI dependency: `get_project_conn`

Defined in `engine/project_db.py`. Reads `project_id` from **either** `request.path_params` OR `request.query_params` (supports both `/project/{project_id}` and `/{tool_id}?project_id=N` URL patterns). Opens the per-project sqlite3 connection, yields it, closes after request.

### System columns — immutable, auto-created for every tool

Defined in `engine/project_db.py::SYSTEM_COLUMN_DEFS` (line 79). Cannot be renamed, deleted, or reordered.

| slug | name | position | width | notes |
|------|------|----------|-------|-------|
| tag  | TAG  | 0        | 110   | unique row key, mandatory |
| rev  | REV  | 1        | 60    | read-only for users |
| log  | LOG  | 999      | 260   | hidden via `.log-hidden` CSS class on `#data-grid` |

### ETL Engine (`engine/etl.py`)

Runs a user-provided SELECT query against the per-project SQLite DB (which contains all flat tool tables, so `SELECT instrument_list.tag FROM instrument_list` works). On apply:
1. Auto-creates missing columns in `_columns` + `ALTER TABLE`
2. Merges results by TAG: updates existing rows (skips cells where TAG+col is in `_overrides`)
3. Inserts new rows not present in the tool table

ETL history and current SQL stored as JSON in `_tools.query_config`.

### ETL Templates (`engine/models.py::ToolTemplate`)

Templates are scoped by **tool type**, not by individual tool instance. Key fields:
- `type_slug` — matches `_tools.tool_type` (e.g. `instrument_list`); used as primary filter
- `project_id` — secondary scope; templates are shared across all tools of the same type within the same project
- `tool_id` — legacy field, no longer written; ignored by `refreshTemplates()`

API: `GET /api/tools/templates?project_id=N&type_slug=X` returns all templates for that type in that project.
Saving a template stores `type_slug + project_id` only — no `tool_id`.

---

## Module layout

| Module | Responsibility |
|--------|----------------|
| `main.py` | FastAPI app setup, static files, page routes |
| `database.py` | SQLAlchemy engine for registry DB, `get_db()` dependency |
| `core/models.py` | `Project` model (id, name, client, db_path) |
| `core/routes.py` | `/api/projects/` CRUD |
| `core/audit.py` | Legacy audit model — not used by active code |
| `engine/models.py` | `ToolTemplate` (only SQLAlchemy model in engine) |
| `engine/project_db.py` | Per-project DB: `create_project_db`, `get_project_conn`, `SYSTEM_COLUMN_DEFS`, `audit()` |
| `engine/routes.py` | `/api/tools/` endpoints — thin layer, delegates to service |
| `engine/service.py` | All business logic — see navigation guide below |
| `engine/etl.py` | ETL preview/apply/save/schema, version history |
| `engine/catalog.py` | Static list of available tool types (TOOL_CATALOG) |
| `_legacy/instrument_list/` | Dead code — pre-refactoring, **do not read** |

### `engine/service.py` navigation guide (~665 lines)

| Lines | Section |
|-------|---------|
| 1–60 | Imports + utility functions (`_now_str`, `_slugify`, `_format_log_entry`, `_append_log`) |
| 64–155 | Tool CRUD (`get_tool`, `get_tools_for_project`, `create_tool`, `update_tool_settings`) |
| 157–280 | Column CRUD (`get_columns`, `add_column`, `update_column`, `delete_column`, `reorder_columns`, `update_column_width`) |
| 282–430 | Row CRUD (`get_rows`, `create_row`, `update_cell`) |
| 436–550 | Soft-delete / restore / hard-delete / paste |
| 610–666 | Private helpers + Template CRUD (registry DB) |

---

## Frontend

Vanilla JS — no framework, no build step. All modules are IIFEs under `static/engine/js/`.

### Module dependency map

```
api.js          ← no deps (root HTTP client — all fetch calls go here)
resize.js       ← ColumnsManager.updateLocalWidth
columns.js      ← ApiClient, ResizeManager
paste.js        ← ApiClient, GridManager
grid.js         ← ApiClient, ColumnsManager, PasteManager
toolbar.js      ← ApiClient, GridManager
sql_editor.js   ← ApiClient
etl_editor.js   ← ApiClient (+ optional ToolbarManager fallback)
main.js         ← no deps (project nav, sidebar, tool modal)
```

**Globals injected by Jinja2** into `table.html` and `etl.html`: `PROJECT_ID`, `TOOL_ID`.

**Script load order** in `table.html`: api.js → columns.js → resize.js → paste.js → grid.js → toolbar.js → sql_editor.js.

### `static/engine/js/grid.js` navigation guide (~660 lines)

| Lines | Section |
|-------|---------|
| 1–50 | State variables (`_rows`, `_filteredRows`, `_showDeleted`, `_ctxRowId`) |
| 51–175 | Rendering (`render`, `_renderRow`, `_renderCell`, `_renderGhostRow`) |
| 182–260 | Event listeners (`_attachListeners`, `_onCellFocus`, `_onCellBlur`, `_onCellKeydown`) |
| 261–330 | Keyboard nav + ghost row creation (`_moveFocus`, `_createFromGhost`) |
| 331–470 | Cell save + soft/hard delete/restore |
| 403–480 | Toggle deleted + **toggle LOG** (CSS class `.log-hidden` on `#data-grid`) + context menu |
| 480–550 | Filters, search, appendRows, showRowLog |
| 580–665 | Public API |

---

## Critical data flows

### Cell edit
```
input.blur → _onCellBlur → _saveCell
  → ApiClient.updateCell  PATCH /tools/{tid}/rows/{rid}/cell?project_id=
    → service.update_cell → UPDATE "{slug}" SET col=? + INSERT _overrides + UPDATE __log
      → serialize_active_row → JSON response
        → _updateLogCell (updates only the LOG preview cell, no full re-render)
```

### ETL apply
```
EtlEditor.apply → ApiClient.etlApply  POST /tools/{tid}/etl/apply
  → etl.etl_apply → cursor.execute(user_sql)
    → for each result row: find or create row by TAG
      → for each column: skip if in _overrides, else UPDATE
      → auto-create missing columns (INSERT _columns + ALTER TABLE)
```

---

## Known pitfalls (bugs already fixed — don't reintroduce)

1. **FastAPI route ordering**: static path segments must be declared BEFORE parametric routes.
   `PUT /{tool_id}/columns/reorder` must come BEFORE `PATCH /{tool_id}/columns/{column_id}` in `routes.py`, otherwise FastAPI matches the path to `{column_id}` and returns 405.

2. **Drag vs resize conflict**: `<th draggable="true">` intercepts mousedown on child elements including the resize handle. Fix: add `draggable="false"` to `.resize-handle` div AND check `e.target.classList.contains("resize-handle")` in `dragstart` handler.

3. **LOG column toggle**: use CSS class `.log-hidden` on `#data-grid` — do NOT use inline `display:none` per cell and do NOT call `render()`. Cells need `data-slug="log"` attribute. CSS: `.data-grid.log-hidden [data-slug="log"] { display: none; }`.

4. **`get_project_conn` dependency**: reads `project_id` from `request.path_params` OR `request.query_params`. Never use `Query(...)` for `project_id` in route signatures that also appear as path parameters.

5. **SQLAlchemy `engine` name collision**: in `main.py`, import as `from database import engine as db_engine` to avoid shadowing the `engine/` package.

---

## URL structure

- `/` — homepage shell (`index.html`)
- `/tool/{project_id}/{tool_id}` — grid view (`engine/table.html`)
- `/tool/{project_id}/{tool_id}/etl` — ETL editor (`engine/etl.html`)
- `/api/projects/` — project CRUD
- `/api/tools/project/{project_id}` — list/create tools
- `/api/tools/{tool_id}/*` — columns, rows, cells, ETL, SQL

All `/api/tools/{tool_id}/*` endpoints require `?project_id=` for ownership validation.

---

## Git workflow

Commit format: `<type>: <short description>` — types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`.

```bash
git add <specific files>
git commit -m "type: message"
git push
```

Never commit: `venv/`, `__pycache__/`, `*.pyc`, `*.db`, `.env`.
