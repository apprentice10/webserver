---
name: dashboard/routes_toolkit.py
description: Shared toolkit-config + catalog bootstrap endpoint — engine-agnostic, project-DB backed
type: reference
---

# dashboard/routes_toolkit.py

Updated: 2026-05-19 10:00

**Description:** Single GET endpoint that serves as the toolkit init call. Returns per-instance toolkit config overrides (from `_toolkit_config`) and the full catalog snapshot. Side-effect: bootstraps `catalog_{tool_id}` table idempotently on every call.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 16–17 | `_catalog_table(tool_id)` | Shared sanitizer — same logic as `routes_catalog.py` |
| 20–48 | `GET /{slug}/tools/{tool_id}/toolkit-config` | Bootstraps catalog table, returns `{ config, catalog_snapshot }` |

## Decisions

- **Catalog bootstrap here, not in a separate endpoint (D-CAT-13)**: `CREATE TABLE IF NOT EXISTS catalog_{id}` runs on every toolkit-config GET — idempotent, no migration needed. Keeps catalog table existence tied to the toolkit init lifecycle.
- **New response shape**: returns `{ config: { [toolkit_id]: {} }, catalog_snapshot: { [tag]: {} } }`. `toolkit_host.js` detects the new shape via `typeof data.config === 'object'`. Old format (`{ [toolkit_id]: {} }`) is handled as backward-compat fallback.
- **`_toolkit_config` is the DB override layer**: static engine.json `config` fields are the defaults; `_toolkit_config` stores runtime overrides. `toolkit_host.js` merges them (`decl.config` base, DB on top).
