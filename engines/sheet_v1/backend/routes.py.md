---
# engines/sheet_v1/backend/routes.py

**Description:** Sheet V1 combined router — aggregates all Sheet sub-routers into a single APIRouter. The dynamic loader in `main.py` imports this module's `router` attribute.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 9 | `router` | Root APIRouter; includes routes_main, routes_flags, routes_export, routes_revisions |

## Decisions

- **Aggregation pattern**: each sub-module owns its own `APIRouter(prefix=...)`. This file just `include_router`s them, keeping it to 13 lines so the dynamic loader contract stays trivial.
- **Dynamic loader contract**: `main.py` scans `engines/*/backend/routes.py` and imports the module-level `router`. This file must never rename or remove that attribute.
