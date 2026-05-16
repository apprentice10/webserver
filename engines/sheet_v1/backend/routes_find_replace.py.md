---
# engines/sheet_v1/backend/routes_find_replace.py

**Description:** HTTP endpoints for find/replace and column autocomplete in Sheet V1.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 15–27 | `POST /{tool_id}/find_replace` | Accepts `FindReplaceRequest`; delegates to `find_replace_cells`; returns `{count, rows}` |
| 30–40 | `GET /{tool_id}/column_values/{col_slug}` | Returns list of distinct column values; optional `prefix` and `limit` query params |

## Decisions

- **Thin handler**: no business logic here; all complexity lives in `service_find_replace.py`.
- **`project_id=None`**: passed as `None` to `find_replace_cells` / `update_cell` because `project_id` is not functionally meaningful at the service level (it is only serialised into the response row object).
