# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Strategy

**Read before non-trivial tasks:**

| What | Where |
|------|-------|
| In-progress / next priorities | `_context/CURRENT_STATE.md` |
| Feature log (completed) | `_context/DONE.md` |
| Architectural decisions + rejected alternatives | `_context/DECISIONS.md` |
| Known technical risks + dangerous files | `_context/RISKS.md` |
| Domain terms and data contracts | `_context/GLOSSARY.md` |

**After completing a feature:** append to `_context/DONE.md`, remove from `_context/CURRENT_STATE.md`.
**After an architectural decision:** add a row to `_context/DECISIONS.md`.
**After splitting an oversized file:** update `_context/RISKS.md` to remove/downgrade the entry.

**Per-task context guide:**

| Task | Read |
|------|------|
| ETL staleness, topological run, circular deps | `_context/ETL_STALENESS.md` |
| System columns, `__` internal columns | `_context/SYSTEM_COLUMNS.md` |
| Cell edit / ETL apply / staleness propagation | `_context/DATA_FLOWS.md` |
| All API URLs, project_id convention, git workflow | `_context/URL_STRUCTURE.md` |
| Frontend IIFE pattern, script load order, showToast | `_context/FRONTEND_PATTERNS.md` |
| Column add/edit | `engine/service.py` L157–280, `engine/project_db.py` L162–181 |
| Row CRUD / cell edit | `engine/service.py` L282–550, `_context/DATA_FLOWS.md` |
| ETL logic | `engine/etl.py.md`, `_context/ETL_STALENESS.md` |
| Frontend grid | `static/engine/js/grid.js.md`, `static/engine/js/columns.js.md` |
| Frontend ETL editor | `static/engine/js/etl_editor.js.md`, `static/engine/js/api.js.md` |
| Sidebar shell, LOG sidebar, FLAG sidebar | `static/engine/js/sidebar.js.md`, `static/engine/css/sidebar.css` |

---

## Project overview

**Instrument Manager** — web app for electro-instrumental engineering design of pharmaceutical plants. Each "tool" (Instrument List, Cable List, I/O List…) is an independent technical document sharing the same universal Table Engine.

Feature list → `_context/DONE.md`. Backlog → `_context/CURRENT_STATE.md`.

---

## Running the server

```bash
venv\Scripts\activate
uvicorn main:app --reload
# Docs: http://127.0.0.1:8000/docs
```

---

## Architecture

- **Database design** → `_context/DECISIONS.md` (D01, D02, D06, D07, D08)
- **Plugin discovery (`engine/catalog.py`)** → `engine/catalog.py.md`, `_context/DECISIONS.md` D09
- **FastAPI dependency `get_project_conn`** → `engine/project_db.py.md`
- **ETL Templates** → `engine/etl.py.md`, `_context/DECISIONS.md` D04

---

## Module layout

| Module | Responsibility | Companion |
|--------|---------------|-----------|
| `main.py` | FastAPI app setup, static files, page routes, `init_index()` | — |
| `core/routes.py` | `/api/projects/` CRUD | — |
| `engine/project_index.py` | `data/projects.db` — thin project registry | `engine/project_index.py.md` |
| `engine/project_db.py` | Per-project DB setup, `get_project_conn`, `SYSTEM_COLUMN_DEFS`, `audit()` | `engine/project_db.py.md` |
| `engine/routes.py` | `/api/tools/` endpoints — thin layer, delegates to service | `engine/routes.py.md` |
| `engine/service.py` | All business logic | `engine/service.py.md` |
| `engine/etl.py` | ETL preview/apply/run/save/schema | `engine/etl.py.md` |
| `engine/utils.py` | `slugify`, `now_str`, `format_log_entry`, `append_log` | `engine/utils.py.md` |
| `engine/sql_parser.py` | SQL parsing: table refs, col lineage, alias resolution | `engine/sql_parser.py.md` |
| `engine/catalog.py` | Dynamic scanner: `tools/*/tool.json` → `TOOL_CATALOG` | `engine/catalog.py.md` |
| `tools/instrument_list/tool.json` | Plugin manifest for Instrument List | — |
| `_legacy/instrument_list/` | Dead code — **do not read** | — |
| `static/engine/css/layout.css` | Container, topbar, global buttons | `static/engine/css/layout.css.md` |
| `static/engine/css/toolbar.css` | Secondary toolbar, search input | `static/engine/css/toolbar.css.md` |
| `static/engine/css/grid.css` | Grid, cells, select/edit mode, context menu, drag | `static/engine/css/grid.css.md` |
| `static/engine/css/note.css` | Tool note area | `static/engine/css/note.css.md` |
| `static/engine/css/sql_editor.css` | Power SQL Editor inline panel | `static/engine/css/sql_editor.css.md` |
| `static/engine/css/modal.css` | Modal log, toast, icon picker, settings tabs | `static/engine/css/modal.css.md` |
| `static/engine/css/etl.css` | ETL Editor layout | `static/engine/css/etl.css.md` |
| `static/engine/css/sidebar.css` | Sidebar panel layout, open/close transition | — |
| `static/engine/js/utils.js` | `escHtml`, `escAttr`, `showToast`, `formatTimestamp` | `static/engine/js/utils.js.md` |
| `static/engine/js/api.js` | HTTP client — sole module allowed to `fetch` | `static/engine/js/api.js.md` |
| `static/engine/js/columns.js` | Column management IIFE | `static/engine/js/columns.js.md` |
| `static/engine/js/resize.js` | Column resize + auto-fit | `static/engine/js/resize.js.md` |
| `static/engine/js/paste.js` | Excel/CSV paste (range + append) | `static/engine/js/paste.js.md` |
| `static/engine/js/grid.js` | Grid render, keyboard nav, cell save, context menu | `static/engine/js/grid.js.md` |
| `static/engine/js/toolbar.js` | Toolbar actions, settings, ETL run | `static/engine/js/toolbar.js.md` |
| `static/engine/js/sidebar.js` | Collapsible sidebar IIFE: toggle, open/close, content injection | `static/engine/js/sidebar.js.md` |
| `static/engine/js/sql_editor.js` | Power SQL Editor panel | `static/engine/js/sql_editor.js.md` |
| `static/engine/js/etl_editor.js` | ETL Editor standalone page | `static/engine/js/etl_editor.js.md` |

---

## Information Loading Rules

* Start from CLAUDE.md only
* Do NOT automatically read `memory/` or `_context/` files
* Use `_context/INDEX.md` to locate relevant information
* Open files ONLY if required by the current task
* Never open multiple files covering the same topic
* Prefer the most specific file over general ones
* Stop reading as soon as sufficient information is found

### Memory Usage Rules

* Do NOT proactively read or recall `memory/` files
* Access `memory/` only if explicitly required by the task
* Treat `memory/` as low-priority hints, not primary sources
* Never load multiple `memory/` files
* Prefer `_context/` over `memory/` in all cases

## File Access Strategy

For every task, follow this sequence:

1. Identify the topic
2. Check `_context/INDEX.md`
3. Select ONE relevant file
4. Read only that file
5. Do not expand unless necessary

If multiple files seem relevant:

* choose the most authoritative (`_context/` over `memory/`)
* do NOT read both unless strictly required

## Pre-Read Planning Rule

* Do NOT read any file immediately
* First, determine:
  * the task type (bug, feature, refactor, ETL)
  * the target topic
* Only after this, select the files using the rules
* Reading without prior selection is forbidden

## Task-Based File Selection

* Bug fixing → check `_context/DATA_FLOWS.md` first
* New feature → check `_context/FRONTEND_PATTERNS.md` or `_context/DECISIONS.md`
* Refactor → check `AI_DEVELOPMENT_RULES.md`
* Data / ETL issues → check `_context/ETL_STALENESS.md`

Rules:

* Select ONE starting file
* Do not open multiple categories unless necessary

---

## Language standard

**English is the mandatory language for the entire project.** This applies to:

- All source code: identifiers, comments, docstrings, log messages, error strings
- All documentation: `CLAUDE.md`, `_context/*.md`, companion `.md` files
- All commit messages and PR descriptions
- All new content added in any session

**Scope clarification:**

- `_context/` must be English only
- `memory/` may contain Italian (personal notes allowed)

---

## Companion `.md` standard

Every relevant source file **must** have a `<name>.<ext>.md` in the same directory. This is mandatory and enforced every session.

**Required sections:**

```
# <file path>

**Description:** <purpose in 1–2 sentences>

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| ...            | ...         |

## Decisions

- **<decision title>**: <what was decided and why; rejected alternatives; constraints>
```

**Rules:**

- Create the companion `.md` when a new source file is created.
- Update it whenever a significant section is added, renamed, or removed.
- Move known pitfalls and non-obvious constraints here — not into `CLAUDE.md`.
- Keep it in English (see Language standard above).
- The Index must reflect current line numbers after any significant refactor.

**Anti-patterns (forbidden):**

- Companion `.md` that duplicates content already in `_context/*.md` — link instead.
- Companion `.md` that describes *what* the code does without explaining *why* non-obvious choices were made.
- Missing companion `.md` for any file in the Module layout table.

---

## Per-session maintenance rules

These rules apply at the start and end of every session:

1. **Context files stay clean** — no new knowledge dumped directly into `CLAUDE.md`. Route it to the correct `_context/*.md` or companion `.md`.
2. **No duplication** — if information exists in one file, other files link to it. Moving content is correct; copying is not.
3. **Companion `.md` coverage** — if a source file in the Module layout table is missing its companion, create it before the session ends.
4. **`_context/*.md` categorization** — use the correct file for each type of knowledge:
   - New completed feature → `_context/DONE.md`
   - Architectural decision → `_context/DECISIONS.md`
   - New risk or file-size violation → `_context/RISKS.md`
   - New domain term → `_context/GLOSSARY.md`
5. **Module layout table** — verify it reflects the real file structure; update if a file was added, removed, or renamed.
6. **Read selectively** — for any task, identify the relevant subject and read only the specific companion `.md` and `_context/*.md` for that subject. Do not load all context files.

---

## Frontend

Vanilla JS — no framework, no build step. All modules are IIFEs under `static/engine/js/`.

Module patterns, pitfalls, script load order, and dependency map → `_context/FRONTEND_PATTERNS.md`.