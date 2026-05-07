# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**Instrument Manager** — web app for electro-instrumental engineering design of pharmaceutical plants. Each "tool" (Instrument List, Cable List, I/O List…) is an independent technical document sharing the same universal Table Engine.

Feature log → `_context/DONE.md`. Backlog → `_context/CURRENT_STATE.md`.

---

## Running the Server

```bash
venv\Scripts\activate
uvicorn main:app --reload
# Docs: http://127.0.0.1:8000/docs
```

---

## Session Strategy

**Read before non-trivial tasks:**

| What | Where |
|------|-------|
| In-progress / next priorities | `_context/CURRENT_STATE.md` |
| Feature log (completed) | `_context/DONE.md` |
| Architectural decisions + rejected alternatives | `_context/DECISIONS.md` |
| Known technical risks + dangerous files | `_context/RISKS.md` |
| Domain terms and data contracts | `_context/GLOSSARY.md` |

**Write-back rules — after any task:**

| Event | Action |
|-------|--------|
| Feature completed | Append to `_context/DONE.md`, remove from `_context/CURRENT_STATE.md` |
| Architectural decision made | Add a row to `_context/DECISIONS.md` |
| Oversized file split | Update `_context/RISKS.md` to remove/downgrade the entry |
| New risk identified | Add to `_context/RISKS.md` |
| New domain term introduced | Add to `_context/GLOSSARY.md` |

---

## After Every Completed Task

**MANDATORY — do this before every commit that closes a backlog item:**

1. Append a bullet to `_context/DONE.md` describing what was done and why (one per task, not one per commit).
2. Remove or update the corresponding entry in `_context/CURRENT_STATE.md`.
3. If a plan has been written add checklist and plan reference in `_context/CURRENT_STATE.md`.

Skipping this step corrupts the project memory and forces manual reconstruction at the start of the next session (as happened on 2026-05-07). There are no exceptions. Even a one-line fix needs an entry if it closed a tracked item.

---

## Per-Task Context Guide

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
| Bidirectional ETL (Group H) | `_context/ETL_BIDIRECTIONAL.md` |

---

## Architecture

- **Database design** → `_context/DECISIONS.md` (D01, D02, D06, D07, D08)
- **Plugin discovery (`engine/catalog.py`)** → `engine/catalog.py.md`, `_context/DECISIONS.md` D09
- **FastAPI dependency `get_project_conn`** → `engine/project_db.py.md`
- **ETL Templates** → `engine/etl.py.md`, `_context/DECISIONS.md` D04

---

## Module Layout

| Module | Responsibility | Companion |
|--------|---------------|-----------|
| `main.py` | FastAPI app setup, static files, page routes, `init_index()` | — |
| `core/routes.py` | `/api/projects/` CRUD | — |
| `engine/project_index.py` | `data/projects.db` — thin project registry | `engine/project_index.py.md` |
| `engine/project_db.py` | Per-project DB setup, `get_project_conn`, `SYSTEM_COLUMN_DEFS`, `audit()` | `engine/project_db.py.md` |
| `engine/routes.py` | `/api/tools/` endpoints — thin layer, delegates to service | `engine/routes.py.md` |
| `engine/service.py` | All business logic | `engine/service.py.md` |
| `engine/staleness.py` | ETL staleness helpers: `mark_tool_stale`, `mark_dependents_stale` | `engine/staleness.py.md` |
| `engine/etl.py` | ETL preview/apply/run/save/schema | `engine/etl.py.md` |
| `engine/utils.py` | `slugify`, `now_str`, `format_log_entry`, `append_log` | `engine/utils.py.md` |
| `engine/sql_parser.py` | SQL parsing: table refs, col lineage, alias resolution | `engine/sql_parser.py.md` |
| `engine/catalog.py` | Dynamic scanner: `tools/*/tool.json` → `TOOL_CATALOG` | `engine/catalog.py.md` |
| `tools/instrument_list/tool.json` | Plugin manifest for Instrument List | — |
| `_legacy/instrument_list/` | Dead code — **do not read** | — |
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

> CSS module details → `_context/FRONTEND_PATTERNS.md`

---

## File Reading Policy

**Plan before reading. Read selectively. Stop early.**

1. Identify the task type and target topic.
2. Check `_context/INDEX.md` to locate the relevant file.
3. Open ONE file — the most specific and authoritative one (`_context/` beats `memory/`).
4. Stop as soon as sufficient information is found. Do not expand unless strictly necessary.
5. Never open multiple files covering the same topic.

**`memory/` files** are low-priority hints. Access only if explicitly required by the task. Always prefer `_context/` over `memory/`.

**Context file conflicts:** if `_context/` files contradict the actual code, trust the code and flag the discrepancy.

---

## Language Standard

**English is the mandatory language for the entire project.** This applies to all source code (identifiers, comments, docstrings, log messages, error strings), all documentation, all `_context/*.md` and companion `.md` files, and all commit messages.

---

## Companion `.md` Standard

Every source file in the Module Layout table **must** have a `<name>.<ext>.md` in the same directory.

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
- Record non-obvious constraints and pitfalls here — not in `CLAUDE.md`.
- The Index must reflect current line numbers after any significant refactor.

**Anti-patterns (forbidden):**
- Duplicating content already in `_context/*.md` — link instead.
- Describing *what* the code does without explaining *why* non-obvious choices were made.
- Missing companion `.md` for any file in the Module Layout table.

---

## Per-Session Maintenance

Apply at the start and end of every session:

1. **Context files stay clean** — new knowledge goes to the correct `_context/*.md` or companion `.md`, never dumped directly into `CLAUDE.md`.
2. **No duplication** — if information exists in one file, other files link to it. Moving is correct; copying is not.
3. **Companion `.md` coverage** — if a source file in the Module Layout table is missing its companion, create it before the session ends.
4. **Module Layout table** — verify it reflects the real file structure; update if a file was added, removed, or renamed.

---

## Frontend

Vanilla JS — no framework, no build step. All modules are IIFEs under `static/engine/js/`.

Module patterns, pitfalls, script load order, dependency map, and CSS module details → `_context/FRONTEND_PATTERNS.md`.
