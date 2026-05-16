---
# engines/sheet_v1/backend/routes_flags.py

**Description:** Flag CRUD endpoints and cell-flag toggle for Sheet V1.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 18–25 | `GET /flags` | Returns all flags for the current project |
| 26–44 | `POST /flags` | Creates a new flag with name and colour |
| 45–70 | `PATCH /flags/{flag_id}` | Updates flag name / colour |
| 71–86 | `DELETE /flags/{flag_id}` | Hard-deletes a flag; cascades to cell_flags via FK |
| 87–133 | `POST /{tool_id}/cell-flags/toggle` | Toggles flag assignment on a cell; returns updated flag list for the cell |

## Decisions

- **No `tool_id` on `/flags` CRUD**: flags are project-scoped, not tool-scoped; only the toggle endpoint needs a tool context.
- **Toggle semantics**: if the flag is already set on the cell it is removed, otherwise added — a single endpoint replaces separate add/remove calls.
