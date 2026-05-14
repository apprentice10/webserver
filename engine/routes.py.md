---
# engine/routes.py

**Description:** All `/api/tools/` endpoints — thin routing layer that validates input, delegates to `engine/service.py` or `engine/etl.py`, and serializes the response. No business logic here.

## Index (~832 lines)

| Lines | Section / Symbol |
|-------|-----------------|
| 1–21 | Imports, `router = APIRouter(prefix="/api/tools")`, `logger = logging.getLogger("engine.routes")` |
| 27–163 | Pydantic schemas: `ToolCreate`, `ToolSettingsUpdate`, `ToolResponse`, `TemplateCreate`, `TemplateResponse`, `ColumnCreate`, `ColumnUpdate`, `ColumnWidthUpdate`, `ColumnReorder`, `ColumnResponse`, `RowCreate`, `CellUpdate`, `PasteData`, `SqlQuery`, `EtlModelBody`, `EtlSqlImportBody`, `FlagCreate`, `FlagUpdate`, `CellFlagEntry`, `CellFlagToggleRequest` |
| 168–185 | `_tool_to_response(tool)` — adapts raw DB dict to `ToolResponse`-compatible dict, adds `is_stale` and `has_etl` |
| 192–226 | Template endpoints: `GET /templates`, `POST /templates`, `DELETE /templates/{id}` |
| 232–351 | Flag endpoints: `GET /flags`, `POST /flags`, `PATCH /flags/{id}`, `DELETE /flags/{id}` |
| 304–351 | `POST /{tool_id}/cell-flags/toggle` — toggle-logic: remove all if all present, else add missing |
| 358–403 | Tool endpoints: `GET /project`, `POST /project`, `GET /{tool_id}`, `PATCH /{tool_id}/settings` |
| 410–473 | Column endpoints: list, add, reorder, update, delete, resize |
| 479–566 | Row endpoints: list, create, paste, update cell, soft-delete, restore, remove-override, keep-row |
| 569–608 | `GET /{tool_id}/audit` — audit log with `row_tag`, `row_tags`, `col_slug`, `col_slugs`, `limit` params; `if row_tag is not None:` guard avoids filtering on absent param |
| 611–628 | `POST /{tool_id}/rows/{row_id}/rollback`, `POST /{tool_id}/rows/{row_id}/hard-delete` |
| 635–661 | `POST /{tool_id}/sql` — SQL editor: forbids DROP/ALTER/TRUNCATE/ATTACH/DETACH |
| 668–732 | `GET /{tool_id}/export/excel` — openpyxl export, streams `.xlsx` |
| 739–833 | ETL endpoints: `compile`, `preview`, `apply`, `run`, `save`, `GET /etl/config`, `PATCH /etl/config`, `sql_to_model`, `GET /etl/schema` |

## Decisions

- **No SQLAlchemy** post-refactor. All endpoints use `conn: sqlite3.Connection = Depends(get_project_conn)`.
- **Template endpoints use `get_project_conn`** (not `registry_db`): `project_id` is read from query params inside `get_project_conn`.
- **Static routes before parametric routes** (see DECISIONS pitfall): `PUT /{tool_id}/columns/reorder` must come BEFORE `PATCH /{tool_id}/columns/{column_id}`. Flags routes must come before `/{tool_id}` routes for the same reason.
- **`if row_tag is not None:` in `get_audit_log`**: `row_tag` defaults to `None` (not `""`). The guard `if row_tag is not None` correctly appends it to `all_tags` only when explicitly passed; avoids filtering on an absent param (a falsy-empty-string check would wrongly drop a legitimate `?row_tag=` query).
- **`EtlModelBody` (model-first ETL)**: ETL write endpoints (`preview`, `apply`, `save`, `PATCH config`) accept `{model: dict}` instead of `{sql: str}`. SQL is always compiled server-side. `EtlQuery` removed.
- **`POST /{tool_id}/etl/compile`**: stateless endpoint — calls `compile_sql(model)`, no DB access, returns `{sql}`; useful for client-side SQL preview without a full preview run.
- **`POST /{tool_id}/etl/sql_to_model`**: stateless migration endpoint — calls `sql_to_model(sql)`, no DB access, returns `{model}`; converts legacy SQL to EtlModel for import in the ETL editor. Uses `EtlSqlImportBody`.
