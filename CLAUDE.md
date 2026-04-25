# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Strategy

Before starting any task, check memory files for relevant context (already loaded in context):
- ETL staleness, topological run, circular deps → `memory/project_etl_staleness.md`
- System columns, internal `__` columns → `memory/project_system_columns.md`
- Cell edit / ETL apply / staleness propagation flows → `memory/project_data_flows.md`
- All API URLs, project_id convention, git workflow → `memory/project_url_structure.md`
- Frontend IIFE pattern, script load order, showToast → `memory/feedback_frontend_patterns.md`

**Per-task context guide:**
- Aggiunta/modifica colonna → `service.py` L157–280, `project_db.py` L162–181
- Row CRUD / cell edit → `service.py` L282–550, `project_data_flows.md`
- ETL logic → `etl.py`, `project_etl_staleness.md`
- Frontend grid → `grid.js`, `columns.js`
- Frontend ETL editor → `etl_editor.js`, `api.js`

---

## Project overview

**Instrument Manager** — web app for electro-instrumental engineering design of pharmaceutical plants. Each "tool" (Instrument List, Cable List, I/O List…) is an independent technical document sharing the same universal Table Engine.

### Working features

- Project management (create/open/delete, persisted in `sessionStorage`)
- Universal Table Engine: inline cell editing, keyboard nav (Tab/Enter/Arrows)
- Ghost row at grid bottom for fast row insertion
- Paste from Excel/CSV (range paste + append paste)
- Soft delete (strikethrough, restorable) + hard delete (trash only)
- Per-row LOG column: records every cell change with timestamp, rev, old→new
- Column resize + reorder by drag (saved to DB)
- Settings panel: tool name, icon picker, revision
- ETL Editor (`/tool/{pid}/{tid}/etl`): SQL → Preview → Apply
- ETL: auto-creates columns, merges by TAG, respects `is_overridden` cells
- ETL version history, template save/load (scoped by tool type), schema browser
- Power SQL Editor (arbitrary SELECT/DML, no DDL)
- Right-click context menu (delete, restore, hard-delete, log)
- Toggle LOG column visibility (CSS class, no re-render)
- ETL staleness tracking + dependency graph + topological auto-run

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
```

Models imported in `migrations/env.py`: `core.models`, `engine.models`.

---

## Architecture

### Two-database design

**Registry DB** (`data/registry.db`, SQLAlchemy): `projects` + `tool_templates` tables.

**Per-project DB** (`data/{client}_{project}.db`, raw sqlite3):
- `_tools` — tool metadata (name, slug, tool_type, icon, rev, query_config, **is_stale**)
- `_columns` — column definitions (name, slug, type, width, position, is_system)
- `_trash` — soft-deleted rows as JSON
- `_overrides(tool_slug, row_tag, col_slug)` — manually-edited cells ETL skips
- `_audit` — change log
- `"{tool_slug}"` — one flat table per tool

System columns (tag/rev/log) and internal `__` columns → see `memory/project_system_columns.md`.
ETL staleness, `etl_deps`, topological run → see `memory/project_etl_staleness.md`.

### FastAPI dependency: `get_project_conn`

`engine/project_db.py`. Reads `project_id` from `request.path_params` OR `request.query_params`. Never use `Query(...)` for `project_id` in route signatures that also use it as path param.

### ETL Templates (`engine/models.py::ToolTemplate`)

Scoped by `type_slug + project_id` (not per tool instance). `tool_id` field is legacy — ignored.
API: `GET /api/tools/templates?project_id=N&type_slug=X`

---

## Module layout

| Module | Responsibility |
|--------|----------------|
| `main.py` | FastAPI app setup, static files, page routes |
| `database.py` | SQLAlchemy engine for registry DB, `get_db()` dependency |
| `core/models.py` | `Project` model (id, name, client, db_path) |
| `core/routes.py` | `/api/projects/` CRUD |
| `engine/models.py` | `ToolTemplate` SQLAlchemy model |
| `engine/project_db.py` | Per-project DB setup, `get_project_conn`, `SYSTEM_COLUMN_DEFS`, `audit()` |
| `engine/routes.py` | `/api/tools/` endpoints — thin layer, delegates to service |
| `engine/service.py` | All business logic — see navigation guide below |
| `engine/etl.py` | ETL preview/apply/save/schema, version history, dependency parsing |
| `engine/utils.py` | Shared utilities: `slugify`, `now_str`, `format_log_entry`, `append_log` |
| `engine/sql_parser.py` | SQL parsing: `extract_table_refs`, `extract_col_lineage`, `clean_sql` |
| `engine/catalog.py` | Static list of available tool types (TOOL_CATALOG) |
| `_legacy/instrument_list/` | Dead code — **do not read** |

### `engine/service.py` navigation guide (~700 lines)

| Lines | Section |
|-------|---------|
| 1–40 | Imports (utilities now in `engine/utils.py`) |
| 64–155 | Tool CRUD (`get_tool`, `get_tools_for_project`, `create_tool`, `update_tool_settings`) |
| 157–280 | Column CRUD (`get_columns`, `add_column`, `update_column`, `delete_column`, `reorder_columns`, `update_column_width`) |
| 282–430 | Row CRUD (`get_rows`, `create_row`, `update_cell`) |
| 436–550 | Soft-delete / restore / hard-delete / paste |
| ~555 | `mark_tool_stale(conn, tool_id)` |
| ~565 | `mark_dependents_stale(conn, source_slug)` — called after every row mutation |
| 610–700 | Private helpers + Template CRUD (registry DB) |

---

## Frontend

Vanilla JS — no framework, no build step. All modules are IIFEs under `static/engine/js/`.

**Script load order** in `table.html`: `utils.js` → `api.js` → `columns.js` → `resize.js` → `paste.js` → `grid.js` → `toolbar.js` → `sql_editor.js`

Module dependency map and patterns → see `memory/feedback_frontend_patterns.md`.

### `static/engine/js/grid.js` navigation guide (~660 lines)

| Lines | Section |
|-------|---------|
| 1–50 | State variables (`_rows`, `_filteredRows`, `_showDeleted`, `_ctxRowId`) |
| 51–175 | Rendering (`render`, `_renderRow`, `_renderCell`, `_renderGhostRow`) |
| 182–260 | Event listeners (`_attachListeners`, `_onCellFocus`, `_onCellBlur`, `_onCellKeydown`) |
| 261–330 | Keyboard nav + ghost row creation (`_moveFocus`, `_createFromGhost`) |
| 331–470 | Cell save + soft/hard delete/restore |
| 403–480 | Toggle deleted + toggle LOG (`.log-hidden` CSS class) + context menu |
| 480–550 | Filters, search, appendRows, showRowLog |
| 580–665 | Public API |

---

## Known pitfalls (bugs already fixed — don't reintroduce)

1. **FastAPI route ordering**: static path segments BEFORE parametric routes. `PUT /{tool_id}/columns/reorder` must come BEFORE `PATCH /{tool_id}/columns/{column_id}` — otherwise FastAPI matches `reorder` as `{column_id}` and returns 405.

2. **Drag vs resize conflict**: `<th draggable="true">` intercepts mousedown on `.resize-handle`. Fix: `draggable="false"` on `.resize-handle` div AND check `e.target.classList.contains("resize-handle")` in `dragstart`.

3. **LOG column toggle**: use CSS class `.log-hidden` on `#data-grid` — NOT `display:none` per cell, NOT `render()`. Cells need `data-slug="log"`. CSS: `.data-grid.log-hidden [data-slug="log"] { display: none; }`.

4. **`get_project_conn`**: reads `project_id` from path params OR query params. Never use `Query(...)` for it in route signatures that also list it as a path param.

5. **SQLAlchemy `engine` name collision**: in `main.py`, import as `from database import engine as db_engine`.

6. **Circular import `etl.py` ↔ `service.py`**: fix is deferred import `from engine.service import mark_dependents_stale` inside `etl_run_saved` body, not at module top.

7. **ETL deps resolved at save time**: `etl_deps` reflects SQL at last `save_etl_version` call. Always save before relying on deps.
