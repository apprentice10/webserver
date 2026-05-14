---
# engine/routes.py

**Description:** All `/api/tools/` endpoints — thin routing layer that validates input, delegates to `engine/service.py` or `engine/etl.py`, and serializes the response. No business logic here.

## Index (~402 lines, after Phase 3 decomposition)

| Lines | Section / Symbol |
|-------|-----------------|
| 1–26  | Imports, `router = APIRouter(prefix="/api/tools")`, `logger`, schemas from `engine.schemas` |
| 29–50 | `_tool_to_response(tool)` — adapts raw DB dict; adds `is_stale` and `has_etl` |
| 53–90 | Template endpoints: `GET /templates`, `POST /templates`, `DELETE /templates/{id}` — delegate to `service_templates` |
| 93–144 | Tool endpoints: `GET /project`, `POST /project`, `GET /{tool_id}`, `PATCH /{tool_id}/settings` |
| 147–218 | Column endpoints: list, add, reorder, update, delete, resize — delegate to `service` / `service_columns` |
| 221–312 | Row endpoints: list, create, paste, update cell, soft-delete, restore, remove-override, keep-row |
| 315–374 | `GET /{tool_id}/audit`, `POST rollback`, `POST hard-delete` |
| 377–402 | `POST /{tool_id}/sql` — SQL editor: forbids DROP/ALTER/TRUNCATE/ATTACH/DETACH |

**Extracted routers (Phase 3):**
- Flags + cell-flags → `engine/routes_flags.py`
- ETL endpoints → `engine/routes_etl.py`
- Export Excel → `engine/routes_export.py`

## Decisions

- **No SQLAlchemy** post-refactor. All endpoints use `conn: sqlite3.Connection = Depends(get_project_conn)`.
- **Template endpoints use `get_project_conn`** (not `registry_db`): `project_id` is read from query params inside `get_project_conn`.
- **Static routes before parametric routes** (see DECISIONS pitfall): `PUT /{tool_id}/columns/reorder` must come BEFORE `PATCH /{tool_id}/columns/{column_id}`. Flags routes must come before `/{tool_id}` routes for the same reason.
- **`if row_tag is not None:` in `get_audit_log`**: `row_tag` defaults to `None` (not `""`). The guard `if row_tag is not None` correctly appends it to `all_tags` only when explicitly passed; avoids filtering on an absent param (a falsy-empty-string check would wrongly drop a legitimate `?row_tag=` query).
- **`EtlModelBody` (model-first ETL)**: ETL write endpoints (`preview`, `apply`, `save`, `PATCH config`) accept `{model: dict}` instead of `{sql: str}`. SQL is always compiled server-side. `EtlQuery` removed.
- **`POST /{tool_id}/etl/compile`**: stateless endpoint — calls `compile_sql(model)`, no DB access, returns `{sql}`; useful for client-side SQL preview without a full preview run.
- **`POST /{tool_id}/etl/sql_to_model`**: stateless migration endpoint — calls `sql_to_model(sql)`, no DB access, returns `{model}`; converts legacy SQL to EtlModel for import in the ETL editor. Uses `EtlSqlImportBody`.
