---
# engines/sheet_v1/backend/routes_main.py

**Description:** Core Sheet V1 HTTP endpoints — engine CRUD, column CRUD, row CRUD, cell updates, audit, and SQL query. Thin layer over `service.py`, `service_columns.py`, `service_row_ops.py`, `service_templates.py`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 33–52 | `_engine_to_response(tool)` | Converts raw `_tools` dict to EngineResponse-compatible dict; parses `query_config` JSON |
| 58–78 | `GET /types`, `GET /catalog`, `GET /utilities` | Discovery endpoints (engine type list, full catalog, utility filter) |
| 80–110 | Template endpoints | `GET/POST /templates`, `DELETE /templates/{id}` |
| 115–163 | Engine CRUD | `GET /project`, `POST /project`, `GET /{id}`, `PATCH /{id}/settings` |
| 168–236 | Column CRUD | list, add, reorder, update, delete, width |
| 242–330 | Row CRUD | list, create, paste, cell update, soft-delete, restore, remove-override, keep |
| 430–end | Row position | insert-at-position, copy-insert, reorder (delegates to `service_row_position`) |
| 330–end | Audit + SQL | `GET /{id}/audit`, `POST /{id}/query` |
| ~602–636 | Sort / Filter | `GET /{id}/sort-filter-state`, `PATCH /{id}/sort-filter-state` — JSON blob in `_tools.sort_filter_state` |

## Decisions

- **Prefix `/api/engines`**: all Sheet endpoints sit under this prefix; tool-specific endpoints use `/{tool_id}` path param.
- **Thin route handlers**: validation and DB work delegates entirely to `service*` modules — no SQL in this file.
- **`_engine_to_response`** exists because raw SQLite rows contain more fields than the Pydantic response model; the helper normalises them without leaking DB internals.
