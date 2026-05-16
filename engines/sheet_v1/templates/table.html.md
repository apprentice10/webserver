## Description

Sheet V1 main table page. Extends `base.html` (found in the shared `templates/` root via the multi-directory Jinja2 loader configured in `main.py`).

## Index

| Lines | Symbol / Block |
|-------|---------------|
| 1 | `{% extends "base.html" %}` |
| 5–15 | `extra_css` — Sheet CSS + shared infrastructure CSS |
| 17–24 | `topbar_crumbs` — project name + tool pill |
| 26–33 | `topbar_actions` — REV chip + Excel export button |
| 34–199 | `content` — read-only banner, toolbar, grid, sidebar, bottom dock, context menus, row-log modal |
| 202–627 | `extra_js` — script tags (load order matters) + inline DOMContentLoaded orchestration |
| 203–206 | Inline JS constants: `DB_PATH`, `TOOL_ID` |
| 235–625 | DOMContentLoaded: panel helper functions, info/history/flags/notes/sql panel registrations, init sequence |

## Decisions

- Moved from `templates/engine/table.html` in R6-6. The old path is gone.
- Template name is `table.html` (no subdirectory prefix). The Jinja2 multi-loader in `main.py` searches `templates/` first, then each engine's `templates/` folder; `table.html` is only found in this engine folder.
- `{% extends "base.html" %}` resolves correctly because `templates/` (which contains `base.html`) is first in the loader search path.
- Panel orchestration (info, history, flags, notes, sql) lives inline in this template rather than in a separate JS file because it wires together multiple subsystems with no reusable surface — extracting it would create a module with a single caller.
