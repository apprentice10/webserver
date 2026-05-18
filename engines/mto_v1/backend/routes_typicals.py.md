# backend/routes_typicals.py

**Description:** MTO V1 — typical CRUD: list, create, rename, delete.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `_require_mto_tool` | 13 | Guard: raises 404 if tool_id is not an MTO tool |
| `_require_typical` | 20 | Guard: raises 404 if typical_id does not belong to this tool |
| `_RenameBody` | 28 | Pydantic body for PATCH — `name: str` |
| `list_typicals` | `GET /{tool_id}/typicals` | Returns ordered list of typicals |
| `create_typical` | `POST /{tool_id}/typicals` | Creates a new typical with auto-generated name and position |
| `rename_typical` | `PATCH /{tool_id}/typicals/{typical_id}` | Renames a typical |
| `delete_typical` | `DELETE /{tool_id}/typicals/{typical_id}` | Deletes a typical + cascades materials, images, tag_placements |

## Decisions

- Separate router from `routes_tools.py` — single responsibility.
- `_require_mto_tool` and `_require_typical` are plain functions (not `Depends`) — called explicitly to share the conn.
- `create_typical` auto-names as "Typical N" where N = max(position)+1. The frontend triggers rename immediately after creation.
- `delete_typical` manually cascades: materials → images → tag_placements → typicals (no FK constraints in SQLite by default).
- `db` query param is forwarded by `get_project_conn` — no extra wiring needed.
