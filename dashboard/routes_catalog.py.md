---
name: dashboard/routes_catalog.py
description: Engine-agnostic catalog CRUD endpoints — GET rows, POST upsert, DELETE entry by TAG
type: reference
---

# dashboard/routes_catalog.py

Updated: 2026-05-19 10:00

**Description:** Three catalog CRUD endpoints mounted at `/api/engines/{slug}/tools/{tool_id}/catalog/`. Tool-local catalog — one `catalog_{tool_id}` table per tool instance, bootstrapped by `routes_toolkit.py` on first toolkit-config fetch.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 18–19 | `_catalog_table(tool_id)` | Sanitizes `tool_id` to safe table name: `catalog_<alphanum>` |
| 22–27 | `CatalogEntry` | Pydantic model: `tag`, `data` (tracked column dict), `force` (overwrite flag) |
| 30–47 | `GET /catalog/rows` | Returns all catalog entries as grid-row dicts (`__id`, `tag`, + tracked columns) |
| 50–76 | `POST /catalog/entry` | Upsert by TAG; returns conflict signal when TAG exists + `force=False` |
| 79–93 | `DELETE /catalog/entry/{tag}` | Remove single entry by TAG; 404 if not found |

## Decisions

- **Table bootstrap is in `routes_toolkit.py`**: catalog table is created on `GET toolkit-config`. This endpoint does not guard against missing table — call toolkit-config before any catalog endpoint.
- **Conflict flow (D-CAT-11)**: `POST` returns `{ ok: false, conflict: true }` when TAG exists without `force`. Frontend shows confirmation dialog, then re-posts with `force: true`.
- **Grid-compatible row format**: `GET /rows` expands `data_json` into a flat dict alongside `__id` and `tag`. Callers must not mutate the list.
- **Table name sanitization**: `re.sub(r"[^a-zA-Z0-9]", "_", tool_id)` — only alphanumerics pass through; all else become `_`. Prevents SQL injection in the f-string interpolated table name.
