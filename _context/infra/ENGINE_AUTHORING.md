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
  "toolkits": [],
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
| `toolkits` | no | Array of toolkit declarations (see **Toolkit system** section below) |
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

## Toolkit system

Toolkits are configurable behavior layers that sit on top of the fixed engine infrastructure (grid-api, etl-api, DB). They cannot create new backend routes or change DB structure directly — they compose existing APIs into higher-level behaviors.

### Declaring toolkits in engine.json

```json
"toolkits": [
  { "id": "my-toolkit", "version": "1.0", "order": 1, "type": "frontend" }
]
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Kebab-case identifier; also names the toolkit JS file |
| `version` | yes | Semver string; used for future compatibility checks |
| `order` | yes | Integer — toolkits are initialized in ascending order |
| `type` | yes | `"frontend"` or `"backend+frontend"` |

Toolkit JS is resolved by convention: `static/engine/js/toolkits/<id>/<id>.js`. Jinja2 renders the `<script>` tags from the `toolkits` array in `order`. No explicit `src` field — do not add one.

### ToolkitHost API

`ToolkitHost` is an IIFE defined in `static/engine/js/toolkit_host.js`. It is called explicitly by the template after all toolkit scripts are loaded:

```js
await ToolkitHost.init(window.__ENGINE_CONFIG__);
```

Public API surface:

| Method / Property | Description |
|-------------------|-------------|
| `init(engineConfig)` | Async — fetch DB config, merge, call toolkit `init(ctx)` in order |
| `emit(event, payload)` | Broadcast event on the shared bus |
| `on(event, handler)` | Subscribe to an event |
| `off(event, handler)` | Unsubscribe a handler |
| `getState(bucket, key)` | Read from a state bucket (`engine`, `toolkits`, `filters`, `ui`) |
| `setState(bucket, key, val)` | Write to a bucket; auto-emits `state:{bucket}:{key}` |
| `getToolkit(id)` | Return a registered toolkit instance by id |
| `config` | Read-only merged config (static defaults overridden by DB config) |
| `engine` | Read-only engine context `{ slug, toolInstanceId, dbPath, endpointBase }` |

### Writing a toolkit

A toolkit is an IIFE that exports an `init(ctx)` function:

```js
const MyToolkit = (() => {
    function init(ctx) {
        // ctx.engine, ctx.config, ctx.emit, ctx.on, ctx.getState, ctx.setState, ctx.getToolkit
        ctx.on('some:event', payload => { /* react */ });
        return { /* optional public methods */ };
    }
    return { init };
})();
```

Rules:
- The global variable name must be `PascalCase(id)`. Id `"my-toolkit"` → global `MyToolkit`.
- Toolkit file lives at `static/engine/js/toolkits/<id>/<id>.js`.
- Cross-toolkit communication: only via `host.emit`/`host.on`. DOM CustomEvents are reserved for toolkit-internal behavior and existing grid internals.
- Per-instance config is persisted in `_toolkit_config` table (project DB). Fetch via `GET /api/engines/{slug}/tools/{tool_id}/toolkit-config?db=...`.

### window.__ENGINE_CONFIG__

Injected by Jinja2 at render time. Shape:

```js
window.__ENGINE_CONFIG__ = {
    slug: "sheet",           // engine slug from engine.json
    toolInstanceId: "42",    // tool instance id (string)
    dbPath: "/data/my.db",   // project DB path
    endpointBase: "",        // API base (empty = same origin)
    toolkits: [...],         // toolkits array from engine.json
};
```

---

## Dashboard toolkit (legacy)

The `dashboard_uses` field has been replaced by the unified `toolkits` array (see above). Engines that declare grid-api or etl-api dependency now use `toolkits` instead. The shared grid infrastructure remains unchanged — only the declaration mechanism changed.

---

## Using the shared grid

### 1. Declare intent in engine.json

Add the grid toolkit to your `toolkits` array:

```json
"toolkits": [
    { "id": "grid", "version": "1.0", "order": 1, "type": "frontend" }
]
```

This tells the Host that your engine uses the shared grid toolkit.

### 2. Implement the backend contract

Your backend must implement every endpoint listed in `_context/grid/GRID_API_CONTRACT.md`, mounted under a slug-namespaced prefix:

```
/api/engines/<slug>/{toolId}/...
```

The full contract covers: tool metadata GET/PATCH, columns CRUD, rows CRUD, cell update, reorder, batch ops, paste, flags, undo/redo, audit, find-replace, autocomplete, sort-filter state, Excel export.

Reference implementation: `engines/sheet_v1/backend/` (full contract) and `engines/mto_v1/backend/routes_materials.py` + `routes_materials_ext.py` (sub-table pattern).

**Required system columns** — every row returned must include:

| Field | Notes |
|-------|-------|
| `__id` | Internal PK, used as `rowId` in all mutation endpoints |
| `__position` | Sort order, managed by backend on reorder |
| `__created_at` | ISO 8601 creation timestamp |
| `tag` | Human-visible unique row key |
| `rev` | Revision stamp (may be `null` if revisions not enabled) |
| `log` | Serialized audit log (may be `null` if history not enabled) |
| `is_deleted` | Soft-delete flag (may be omitted if soft-delete not used) |

See `_context/grid/GRID_API_CONTRACT.md` for full field and response schemas.

### 3. Load the shared grid scripts in your template

The grid toolkit lives at `static/engine/js/grid/`. Load scripts in this order (after `api.js` and `utils.js`):

```html
<!-- shared grid modules (load order matters) -->
<script src="/static/engine/js/grid/columns.js"></script>
<script src="/static/engine/js/grid/rendering/grid-renderer.js"></script>
<script src="/static/engine/js/grid/selection/selection-manager.js"></script>
<script src="/static/engine/js/grid/keyboard/cell-keyboard.js"></script>
<script src="/static/engine/js/grid/cell-save/cell-save.js"></script>
<script src="/static/engine/js/grid/row-ops/row-ops.js"></script>
<script src="/static/engine/js/grid/row-ops/row-drag.js"></script>
<script src="/static/engine/js/grid/context-menu/context-menu.js"></script>
<script src="/static/engine/js/grid/clipboard/clipboard-manager.js"></script>
<script src="/static/engine/js/grid/cut-paste/cut-paste.js"></script>
<script src="/static/engine/js/grid/fill/fill-handle.js"></script>
<script src="/static/engine/js/grid/paste.js"></script>
<script src="/static/engine/js/grid/resize.js"></script>
<script src="/static/engine/js/grid/autocomplete/autocomplete.js"></script>
<script src="/static/engine/js/grid/find-replace/find-replace.js"></script>
<script src="/static/engine/js/grid/sort-filter/sort-filter.js"></script>
<script src="/static/engine/js/grid/undo/undo-manager.js"></script>
<script src="/static/engine/js/grid/flags.js"></script>
<script src="/static/engine/js/grid/history/history-api.js"></script>
<script src="/static/engine/js/grid/history/history-renderer.js"></script>
<script src="/static/engine/js/grid/history/history-panel.js"></script>
<script src="/static/engine/js/grid/history/rollback-service.js"></script>
<script src="/static/engine/js/grid/history/history-actions.js"></script>
<script src="/static/engine/js/grid/sidebar.js"></script>
<script src="/static/engine/js/grid/panels/panel-floats.js"></script>
<script src="/static/engine/js/grid/panels/panel-tab-bar.js"></script>
<script src="/static/engine/js/grid/revision-picker/revision-picker.js"></script>
<script src="/static/engine/js/grid/paste-special/paste-special.js"></script>
<script src="/static/engine/js/grid/grid.js"></script>  <!-- orchestrator, always last -->
```

See `engines/sheet_v1/templates/table.html` or `engines/mto_v1/templates/mto_table.html` for a working reference.

### 4. Initialize the grid

Call `Grid.init(config)` after the DOM is ready. The only required field is `endpointBase`:

```js
Grid.init({
  endpointBase: `/api/engines/cable/${toolId}`,
  db: currentDbPath,   // URL-encoded path to the SQLite file
});
```

**Sub-table grids** (a grid scoped to a child entity, e.g. materials inside a typical) encode the filter directly in `endpointBase`:

```js
Grid.init({
  endpointBase: `/api/engines/mto/${toolId}/materials/${typicalId}`,
  db: currentDbPath,
});
```

The grid has no knowledge of the filter — the backend routes handle scoping. See `engines/mto_v1/static/js/mto_shell.js` for a live example.

### 5. Optional features

Features are enabled or disabled by the presence of the corresponding backend endpoints. If your backend omits the undo endpoints, the undo UI is simply inactive. If you omit revision endpoints, the REV chip does not appear. The grid degrades gracefully — do not stub missing endpoints.

---

## Checklist for a new engine

- [ ] Create `engines/<slug>_v<N>/` with `__init__.py`
- [ ] Write `engine.json` with all required fields; add `toolkits` array entries if using toolkits (e.g. grid)
- [ ] If backend needed: create `backend/__init__.py` and `backend/routes.py` with `router = APIRouter(prefix="/api/engines/<slug>", ...)`
- [ ] If using the shared grid: implement the backend contract from `_context/grid/GRID_API_CONTRACT.md`; ensure all required system columns are returned in every row
- [ ] If static files: create `static/js/` and/or `static/css/`; reference them in HTML as `/engines/<folder>/static/...`
- [ ] If HTML page needed: create `templates/<page>.html`; add a `@app.get(...)` route in `main.py` if the path is new
- [ ] If using the shared grid: load scripts from `/static/engine/js/grid/` in the correct order; call `Grid.init({ endpointBase, db })` after DOM ready
- [ ] Create companion `.md` file for every new source file
- [ ] Smoke test: restart `uvicorn main:app --reload`, check no import errors, verify `GET /api/engines/catalog` lists the new engine
