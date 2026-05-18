---
# routes_materials.py

**Description:** MTO V1 — backend CRUD for the `mto_materials` table. Handles list, add, cell-update, delete, and reorder for a specific typical's materials rows.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_EDITABLE` | 12 | Set of column names the frontend may write — system columns excluded |
| `_ALL_COLUMNS` | 13 | Ordered column list for consistent API response shape |
| `_require_typical` | 20 | Guard: raises 404 if typical doesn't belong to the given tool |
| `_require_row` | 29 | Guard: raises 404 if row doesn't belong to the given typical |
| `_utility_count` | 37 | Counts `mto_utilities` rows matching `tool_id + typical_name` — used for `total` computation |
| `_row_to_dict` | 42 | Merges a row dict with computed `total = quantity × utility_count` |
| `list_materials` | 51 | `GET /{tool_id}/materials/{typical_id}` — returns columns, rows (with total), utility_count |
| `add_material_row` | 66 | `POST /{tool_id}/materials/{typical_id}` — inserts new row, sets TAG = row id string |
| `update_material_cell` | 86 | `PATCH /{tool_id}/materials/{typical_id}/{row_id}` — updates one editable column, updates rev + log |
| `delete_material_row` | 112 | `DELETE /{tool_id}/materials/{typical_id}/{row_id}` — hard delete |
| `reorder_materials` | 122 | `POST /{tool_id}/materials/{typical_id}/reorder` — accepts `{ordered_ids:[...]}`, updates position |

## Decisions

- **TAG = row id string**: generated after INSERT by updating `tag = str(lastrowid)`. Stable, unique, used as drag-source identifier for image annotation in Steps 12–15.
- **`total` is computed on every read**: `quantity × utility_count`. Never stored. Recomputed each fetch as utility count can change via ETL.
- **`_EDITABLE` whitelist**: column name validated server-side to prevent injection via the PATCH body. Only the five user-owned columns are writable.
- **`f"UPDATE ... SET {body.column} = ?"` is safe** because `body.column` is checked against `_EDITABLE` before use — no raw user string reaches the SQL template.
- **Hard delete only**: no soft-delete for materials. Materials are low-risk data; reverting is out of scope for MTO at this stage.
- **Reorder uses position integers**: `ordered_ids` list from frontend determines the new `position` values (0-based index). Gaps are fine — display always re-sorts by `position, id`.
