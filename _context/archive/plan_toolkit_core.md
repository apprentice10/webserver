# Plan: Phase 1 — Toolkit System Core

## Goal

Implement the generic engine Host and the toolkit contract that all future toolkits plug into. The Host is a shared frontend module (`static/engine/js/toolkit_host.js`) that reads `engine.json` toolkit declarations, loads per-instance config from the DB, merges them, and calls each toolkit's `init(ctx)` in declaration order. No toolkit behavior is implemented here — only the wiring infrastructure.

## Steps

- [x] Step 1 — Add `toolkit_config` table to project DB schema (`project_db.py`): `(tool_id TEXT, toolkit_id TEXT, config_json TEXT, PRIMARY KEY (tool_id, toolkit_id))`
- [x] Step 2 — Add `GET /api/engines/{slug}/tools/{tool_id}/toolkit-config` endpoint: returns all rows for the tool instance as `{ [toolkit_id]: config_json_parsed }`
- [x] Step 3 — Write `static/engine/js/toolkit_host.js` IIFE: `init(engineConfig)`, `emit`, `on`, `off`, `getState`, `setState`, `getToolkit`, internal state store, event bus
- [x] Step 4 — Update `engine.json` format: replace `dashboard_uses` with unified `toolkits` array (`id`, `version`, `order`, `type`)
- [x] Step 5 — Update `engines/mto_v1/engine.json` to new format (migration of existing declaration)
- [x] Step 6 — Update Jinja2 base engine template to inject `window.__ENGINE_CONFIG__` and render toolkit `<script>` tags in `order`
- [x] Step 7 — Write `static/engine/js/toolkit_host.js.md` companion file
- [x] Step 8 — Update `ENGINE_AUTHORING.md` with toolkit contract, Host API surface, and `engine.json` new format
- [x] Step 9 — Update `MODULE_LAYOUT.md` with `toolkit_host.js` entry

## Decisions

**D-TK-CORE-01**: Toolkit = configurable behavior layer on top of fixed engine infrastructure (grid-api, etl-api, DB). Cannot create new backend routes or change DB structure directly.

**D-TK-CORE-02**: Host = frontend orchestrator only. Uses existing backend APIs for persistence. No new backend logic.

**D-TK-CORE-03**: `engine.json` uses unified `toolkits` array (replaces `dashboard_uses`). Fields: `id`, `version`, `order`, `type` (`"frontend"` or `"backend+frontend"`).

**D-TK-CORE-04**: Toolkit JS resolved by convention: `static/engine/js/toolkits/<id>/<id>.js`. No explicit `src` field.

**D-TK-CORE-05**: Jinja2 renders `<script>` tags for declared toolkits in `order`. Host orchestrates, never dynamically loads scripts.

**D-TK-CORE-06**: `window.__ENGINE_CONFIG__ = { slug, toolInstanceId, dbPath, endpointBase, toolkits: [...] }` injected by Jinja2 at render time. Host init is synchronous.

**D-TK-CORE-07**: `toolkit_config` table `(tool_id, toolkit_id, config_json)` in project DB. Single fetch at Host startup, merged with static defaults before any `init`.

**D-TK-CORE-08**: Toolkit lifecycle = `init(ctx)` + `destroy()` only. State changes via `host.on`. No hook proliferation.

**D-TK-CORE-09**: Four-bucket shared state: `engine` (immutable), `toolkits` (per-toolkit owned), `filters` (cross-toolkit signals), `ui` (transient interface state).

**D-TK-CORE-10**: Cross-toolkit communication via `host.emit`/`host.on` bus only. DOM CustomEvents reserved for toolkit-internal behavior and existing grid internals.

**D-TK-CORE-11**: Host public API surface (final): `emit(event, payload)`, `on(event, handler)`, `off(event, handler)`, `getState(bucket, key)`, `setState(bucket, key, val)`, `getToolkit(name)`, `config` (read-only merged config), `engine` (read-only context).

## Risks

- **`toolkit_config` schema migration**: adding a new table to the project DB requires a `PRAGMA user_version` bump and a migration step in `_run_migrations()`. Must not break existing project files.
- **`engine.json` format change**: existing `mto_v1` engine uses `dashboard_uses`. Step 5 must migrate it before any engine catalog reads the new format — the catalog scanner in `catalog.py` must handle both formats during transition, or migrate atomically.
- **Script load order**: Jinja2 must emit toolkit `<script>` tags before `toolkit_host.js`. The Host IIFE must not auto-execute — it must wait for an explicit `ToolkitHost.init(window.__ENGINE_CONFIG__)` call at the bottom of the template.
