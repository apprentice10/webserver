---
# engines/sheet_v1/backend/routes_flags.py

**Description:** Flag CRUD endpoints, cell-flag toggle, cell-flag note update, and conditional flag rules CRUD for Sheet V1.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 18–25 | `GET /flags` | Returns all flags for the current project |
| 26–44 | `POST /flags` | Creates a new flag with name and colour |
| 45–70 | `PATCH /flags/{flag_id}` | Updates flag name / colour |
| 71–86 | `DELETE /flags/{flag_id}` | Hard-deletes a flag; cascades to cell_flags via FK |
| 87–133 | `POST /{tool_id}/cell-flags/toggle` | Toggles flag on cells; optional `note` field stored on new entries |
| 134–149 | `PATCH /{tool_id}/cell-flags/note` | Updates note on existing cell+flag entries without toggling |
| 152–173 | `GET /{tool_id}/flag-rules` | Lists conditional flag rules for tool |
| 175–200 | `POST /{tool_id}/flag-rules` | Creates a new conditional rule |
| 202–209 | `DELETE /{tool_id}/flag-rules/{rule_id}` | Deletes a conditional rule |

## Decisions

- **No `tool_id` on `/flags` CRUD**: flags are project-scoped; only toggle/note/rules endpoints need tool context.
- **Toggle semantics**: all-have → remove all; any-missing → add missing. A single endpoint replaces separate add/remove calls.
- **Note on toggle**: note is stored only when the flag is added (INSERT). Note update uses the separate PATCH endpoint.
- **Conditional rules are tool-scoped**: rules reference `col_slug` which is per-tool, so they live under `/{tool_id}/flag-rules`.
- **Conditional rules are evaluated server-side** in `service.get_rows` and `service._get_row_cell_flags`; no instances are stored in `_cell_flags`.
