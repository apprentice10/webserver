# backend/routes.py

**Description:** MTO V1 combined router. Aggregates all MTO sub-routers under `/api/engines/mto`; picked up by `main.py`'s dynamic engine loader via the `router` attribute.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `router` | 9 | `APIRouter(prefix="/api/engines/mto")` — root router for the engine |
| `routes_utilities` | — | Read-only utilities endpoint (Step 7) |

## Decisions

- Prefix `/api/engines/mto` is set here so all sub-routers inherit it automatically.
- Sub-routers added per phase: `routes_tools` (Step 3), `routes_typicals` (Step 4–5), ETL integration (Step 6), utilities (Step 7), materials (Step 8–9), images (Step 10–11), placements (Step 15), import (Steps 16–18), export (Steps 19–21).
