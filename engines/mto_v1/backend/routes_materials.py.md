# routes_materials.py

**Description:** MTO V1 — grid-api v1 core contract for `mto_materials`, scoped to a `typical_id`. Implements the mandatory endpoint set the shared grid frontend requires.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `_EDITABLE` | 12 | Set of slugs users may edit: `part_description, size, material, uom, quantity` |
| `_DEFAULT_COLUMNS` | 14 | Seven default column definitions auto-inserted on first access |
| `_require_typical` | 29 | Guard — 404 if `tool_id`/`typical_id` mismatch |
| `_require_row` | 39 | Guard — 404 if `row_id`/`typical_id` mismatch |
| `_utility_count` | 49 | Counts rows in `mto_utilities` for this typical — used to compute `total` |
| `_serialize_row` | 56 | Maps DB row → grid contract shape; computes `total = quantity × utility_count` |
| `_ensure_columns` | 75 | Auto-initializes `mto_material_columns` from `_DEFAULT_COLUMNS` if empty |
| `list_columns` | 94 | GET `/{tool_id}/materials/{typical_id}/columns` |
| `update_column` | 116 | PATCH `…/columns/{col_id}` — rename or change col_type/width |
| `set_column_width` | 149 | PATCH `…/columns/{col_id}/width` — resize shortcut |
| `reorder_columns` | 166 | PUT `…/columns/reorder` — positional reorder |
| `list_rows` | 191 | GET `…/rows` — returns all rows ordered by position then id |
| `create_row` | 208 | POST `…/rows` — inserts at end, auto-sets `tag = str(id)` |
| `update_cell` | 255 | PATCH `…/rows/{row_id}/cell` — validates slug in `_EDITABLE`, logs change |
| `soft_delete_row` | 288 | POST `…/rows/{row_id}/delete` — hard deletes (no soft-delete in MTO) |
| `restore_row` | 302 | POST `…/rows/{row_id}/restore` — always 404 (no soft-delete concept) |
| `hard_delete_row` | 313 | POST `…/rows/{row_id}/hard-delete` |
| `reorder_row` | 336 | POST `…/rows/{row_id}/reorder` — drag-reorder with `anchor_row_id`/`placement` |

## Decisions

- **`total` is computed, not stored:** `quantity × utility_count` computed in `_serialize_row` on every response. `total` slug is excluded from `_EDITABLE` so the grid cannot write it.
- **No soft-delete:** MTO materials are hard-deleted. `soft_delete_row` delegates to `DELETE` immediately; `restore_row` always raises 404. Both endpoints exist to satisfy the grid contract.
- **`tag = str(id)`:** Auto-assigned at creation time without user input.
- **`rev` as string:** Serialized as `str(rev)` with `is not None` guard (not `or ""`) because `rev=0` is falsy and would produce `""` without the explicit None check.
- **`mto_material_columns` shared across typicals:** Columns are keyed by `tool_id` only — all typicals in the same MTO tool share the same column schema.
- **Schema dependency:** Requires migration v11 (`mto_material_columns`, `mto_sf_state` tables). See `dashboard/project_db.py`.
