# engine/routes_flags.py

**Description:** Flag CRUD and cell-flag toggle endpoints. Extracted from `engine/routes.py` (P3-002). Uses the same `/api/tools` prefix; included in `main.py` before the main engine router.

## Index

| Lines | Symbol |
|-------|--------|
| 1–14  | Imports, `router = APIRouter(prefix="/api/tools")` |
| 17–23 | `GET /flags` — list all flags ordered by is_system, name |
| 26–38 | `POST /flags` — create flag; 409 on duplicate name |
| 41–59 | `PATCH /flags/{flag_id}` — rename/recolor; system flag name locked |
| 62–72 | `DELETE /flags/{flag_id}` — 400 on system flag |
| 75–115 | `POST /{tool_id}/cell-flags/toggle` — remove all if all present, else add missing |

## Decisions

- **Same prefix as engine router**: both use `prefix="/api/tools"`. FastAPI merges routes from multiple included routers — this works correctly as long as `flags_router` is included in `main.py` before `engine_router` (so `/flags` is registered before `/{tool_id}`).
- **No `/{tool_id}` ambiguity**: `tool_id` is typed `int` in all engine routes; `/flags` can't parse as int so there's no match conflict, but the explicit ordering in main.py is kept as documentation of intent.
