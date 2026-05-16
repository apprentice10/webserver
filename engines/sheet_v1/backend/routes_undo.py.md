---
name: routes_undo
description: Undo/redo HTTP endpoints for Sheet V1
type: project
---

# engines/sheet_v1/backend/routes_undo.py

**Description:** Three endpoints exposing undo/redo to the frontend. All state lives in service_undo.py.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 11 | `router` | APIRouter with prefix `/api/engines` |
| 14–21 | `POST /{tool_id}/undo` | Pops undo stack, reverses operation, returns `{can_undo, can_redo, type, ...}` |
| 23–30 | `POST /{tool_id}/redo` | Pops redo stack, re-applies operation, returns same shape |
| 32–34 | `GET /{tool_id}/undo-state` | Returns `{can_undo, can_redo}` — no DB access needed |

## Decisions

- **`undo-state` does not hit the DB**: stack sizes are in-memory, no `conn` needed.
- **Responses include `can_undo`/`can_redo`**: avoids a second request from the frontend after each undo/redo.
