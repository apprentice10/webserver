# engine/routes_etl.py

**Description:** ETL endpoints — compile, preview, apply, run, save, config, sql_to_model, schema. Extracted from `engine/routes.py` (P3-003). All delegates to `engine/etl.py` or `engine/etl_compiler.py`.

## Index

| Lines | Symbol |
|-------|--------|
| 1–13  | Imports, `router = APIRouter(prefix="/api/tools")` |
| 16–26 | `POST /{tool_id}/etl/compile` — stateless; returns compiled SQL from model |
| 29–34 | `POST /{tool_id}/etl/preview` |
| 37–42 | `POST /{tool_id}/etl/apply` |
| 45–50 | `POST /{tool_id}/etl/run` — runs saved ETL |
| 53–58 | `POST /{tool_id}/etl/save` |
| 61–66 | `GET /{tool_id}/etl/config` |
| 69–74 | `PATCH /{tool_id}/etl/config` — save draft model |
| 77–87 | `POST /{tool_id}/etl/sql_to_model` — stateless; converts legacy SQL to EtlModel |
| 90–96 | `GET /{tool_id}/etl/schema` |

## Decisions

- **Deferred imports for etl/compiler modules**: each endpoint imports from `engine.etl` or `engine.etl_compiler` inside the function body — same pattern as original routes.py, avoids loading heavy ETL machinery at startup.
- **`etl/compile` and `etl/sql_to_model` are stateless**: no `conn` param needed; FastAPI will still match the path correctly.
