# backend/routes.py

**Description:** MTO V1 combined router. Aggregates all MTO sub-routers under `/api/engines/mto`; picked up by `main.py`'s dynamic engine loader via the `router` attribute.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `router` | 9 | `APIRouter(prefix="/api/engines/mto")` — root router for the engine |
| `routes_utilities` | — | Read-only utilities endpoint (Step 7) |

## Decisions

- Prefix `/api/engines/mto` is set here so all sub-routers inherit it automatically.
- Sub-routers added per phase: `routes_tools`, `routes_typicals`, `routes_utilities`, `routes_materials`, `routes_materials_ext`, `routes_images`, `routes_placements`, `routes_import`, `routes_export`, `routes_export_excel`.
- `routes_materials_ext` is included **before** `routes_materials` to prevent FastAPI from matching static path segments like `batch-update` or `paste` as `{row_id}` in the core router.
