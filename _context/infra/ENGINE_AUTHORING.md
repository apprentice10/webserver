# infra/ENGINE_AUTHORING.md

**Description:** Step-by-step guide for adding a new engine or utility plugin. Captures decisions from Group R (R1–R5) and Group R6. Read this before creating any new engine folder.

---

## What is an engine?

An engine is a self-contained plugin folder under `engines/`. It declares its identity in `engine.json` and optionally provides a Python backend, static files, and an HTML template. `main.py` discovers and wires everything automatically at startup — no registration step needed.

A **utility** is a variant: same folder structure, but `"type": "utility"` in the manifest. Utilities are internal add-ons (e.g. ETL modes), never user-created instances. The `+new Engine` modal filters them out.

---

## Folder structure

```
engines/
  <slug>_v<N>/
    engine.json               ← required
    __init__.py               ← required (empty)
    backend/
      __init__.py             ← required (empty)
      routes.py               ← required if backend needed
      routes_*.py             ← sub-routers included from routes.py
      service.py              ← business logic (import from here, not from routes)
      schemas.py              ← Pydantic models for this engine only
    static/
      js/                     ← served at /engines/<folder-name>/static/js/
      css/                    ← served at /engines/<folder-name>/static/css/
    templates/
      <page>.html             ← Jinja2 templates, discovered by main.py loader
```

Convention: folder name is `<slug>_v<N>` (e.g. `sheet_v1`). The `slug` field in `engine.json` is the short identifier used in DB records and API URLs (e.g. `"sheet"`).

---

## engine.json — full schema

```json
{
  "name": "Sheet",
  "version": "1.0",
  "type": "engine",
  "slug": "sheet",
  "description": "General purpose structured data sheet.",
  "icon": "📋",
  "dashboard_uses": ["grid-api v1", "etl-api v1"],
  "uses_utilities": ["etl"],
  "ai_prompt": "Plain-English description for the AI assistant.",
  "supports_template": false
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Display name shown in the `+new Engine` modal |
| `version` | yes | Stored in `_tools.engine_version` at instance creation time |
| `type` | yes | `"engine"` or `"utility"` |
| `slug` | yes | Short identifier; used in DB (`type_slug`) and API prefix |
| `description` | yes | Shown in the modal card |
| `icon` | yes | Emoji or short string |
| `dashboard_uses` | no | Declare which versioned toolkit APIs this engine relies on |
| `uses_utilities` | no | Which utility categories this engine can activate |
| `ai_prompt` | no | Context for the AI assistant (future feature) |
| `utility_category` | no | Required when `type` is `"utility"` — groups utilities in `UTILITY_BY_CATEGORY` for fast lookup |
| `supports_template` | no | If `true`, shows "Load from file" in the modal |

---

## Backend contract

`engines/<folder>/backend/routes.py` must expose a module-level `router`:

```python
from fastapi import APIRouter
router = APIRouter()   # aggregator — no prefix here
```

`main.py` imports this module and calls `app.include_router(router)` automatically. Sub-routers are included inside `routes.py` using `router.include_router(...)`.

Each sub-router (or the main router for simple single-file engines) declares its own prefix. Use a slug-namespaced prefix to avoid collisions with other engines:

```python
# routes_main.py (or routes.py for a single-file engine)
router = APIRouter(prefix="/api/engines/<slug>", tags=["<Name>"])
```

> **Note:** Sheet V1 uses the legacy prefix `"/api/engines"` (no slug) across all its sub-routers because it pre-dates multi-engine namespacing. New engines **must** include the slug in the prefix (e.g. `"/api/engines/cable"`) to prevent route conflicts.

Import shared infrastructure from `dashboard`:
```python
from dashboard.project_db import get_project_conn
from dashboard.utils import slugify, now_str
from dashboard.schemas import BaseResponse   # shared base models only
```

Engine-specific Pydantic models go in `engines/<folder>/backend/schemas.py`, not in `dashboard/schemas.py`.

---

## Static files

Any `engines/<folder>/static/` directory is automatically mounted by `main.py` at startup:

```
/engines/<folder-name>/static/  →  engines/<folder-name>/static/
```

Note: the URL segment is the **folder name** (`sheet_v1`), not the slug (`sheet`). Reference files in HTML as:
```html
<script src="/engines/sheet_v1/static/js/grid.js"></script>
```

Shared Dashboard JS (e.g. `api.js`, `utils.js`, `panel_system.js`) stays in `static/engine/js/` and is loaded from `/static/engine/js/`. Do not copy it into the engine folder.

---

## Templates

Any `engines/<folder>/templates/` directory is added to Jinja2's `FileSystemLoader` search path. Template names must not collide across engines — prefix with the engine slug if needed (e.g. `sheet_table.html`).

`table.html` in `engines/sheet_v1/templates/` is the exception: `main.py` routes `/tool` to `table.html` directly. New engines with different page layouts should use unique template names and register their own `@app.get(...)` route in `main.py`.

---

## Discovery sequence in main.py

1. Mount static dirs: loop `engines/*/` — if `static/` exists, call `app.mount(...)`.
2. Load routers: loop `engines/*/` — if `backend/routes.py` exists, `importlib.import_module(...)` then `app.include_router(router)`.
3. Build Jinja2 loader: collect all `engines/*/templates/` directories, append to base `templates/` path.

All three loops run at module import time (before the app starts serving). Dynamic imports at request time are not used.

---

## Dashboard toolkit

Engines that declare `"dashboard_uses": ["grid-api v1"]` opt into the shared grid infrastructure. This is a declaration only — no runtime enforcement today. Its purpose is compatibility checking when a DB is opened on a Dashboard where the engine is missing or version-mismatched (see D-R3, D-R4).

Engines that bring their own UI and do not use the grid or ETL can omit `dashboard_uses` entirely.

---

## Checklist for a new engine

- [ ] Create `engines/<slug>_v<N>/` with `__init__.py`
- [ ] Write `engine.json` with all required fields
- [ ] If backend needed: create `backend/__init__.py` and `backend/routes.py` with `router = APIRouter(prefix="/api/engines/<slug>", ...)`
- [ ] If static files: create `static/js/` and/or `static/css/`; reference them in HTML as `/engines/<folder>/static/...`
- [ ] If HTML page needed: create `templates/<page>.html`; add a `@app.get(...)` route in `main.py` if the path is new
- [ ] Create companion `.md` file for every new source file
- [ ] Smoke test: restart `uvicorn main:app --reload`, check no import errors, verify `GET /api/engines/catalog` lists the new engine
