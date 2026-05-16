---
name: service_row_position
description: Row position operations — insert at position, copy-and-insert, reorder
type: project
---

# engines/sheet_v1/backend/service_row_position.py

**Description:** Row position mutation operations split from `service_row_ops.py` to stay under the 400-line limit. Handles insert, copy-insert, and reorder.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–51  | `insert_row_at_position(conn, tool_id, row_id, placement, project_id)` | Shifts all rows at `__position >= new_pos` up by 1, then inserts a new empty row with auto-generated tag at `new_pos`. |
| 52–98 | `copy_row_insert(conn, tool_id, row_id, project_id)` | Duplicates all user-column values (excluding tag, rev) into a new row with a fresh `CPY-...` tag immediately below the source. Marks tool stale. |
| 99–end | `reorder_row(conn, tool_id, row_id, anchor_row_id, placement, project_id)` | Moves row to just before/after anchor_row_id by computing the correct target position and doing a range-shift UPDATE. |

## Decisions

- **Tag generation**: `NEW-{8-hex}` for insert, `CPY-{8-hex}` for copy. UUID-based so collision is astronomically unlikely; no uniqueness check needed.
- **`reorder_row` takes `anchor_row_id + placement`** instead of raw `target_position`: avoids frontend needing to know absolute positions. Formula: `before → T if P>T else T-1`; `after → T+1 if P>T else T`.
- **Single bulk UPDATE for position shift**: avoids N row-by-row updates on large tables (Risk S from plan).
- **`copy_row_insert` marks stale**: copied data may affect ETL outputs; insert-empty does not (empty row has no column values to affect ETL).
