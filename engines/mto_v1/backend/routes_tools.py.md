# backend/routes_tools.py

**Description:** Tool instance CRUD for MTO. Create, open, and delete MTO tool instances in the project SQLite DB.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `MtoCreate` | 16 | Pydantic request model: `name`, `icon` |
| `_get_tool` | 21 | Fetch `_tools` row; enforces `tool_type = 'mto'`; raises 404 |
| `_unique_slug` | 28 | Generates a unique slug by appending `_N` suffix |
| `create_mto_tool` | 36 | `POST /api/engines/mto` — inserts into `_tools` |
| `open_mto_tool` | 49 | `GET /api/engines/mto/{tool_id}` — returns tool metadata + typicals list |
| `delete_mto_tool` | 59 | `DELETE /api/engines/mto/{tool_id}` — cleans all MTO data for this tool |

## Decisions

- `delete_mto_tool` deletes rows for the given `tool_id` from `mto_typicals` and `mto_utilities`; cascade FK constraints on `typical_id` handle `mto_materials`, `mto_images`, and `mto_tag_placements` automatically.
- MTO tables are shared across all tool instances (use `tool_id` FK) — delete does not DROP tables, only removes rows.
- `tool_type = 'mto'` is used as a discriminator so `_get_tool` cannot accidentally match Sheet V1 tools.
