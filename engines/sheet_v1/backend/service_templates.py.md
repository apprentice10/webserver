---
# engines/sheet_v1/backend/service_templates.py

**Description:** ETL template CRUD — stored SQL query fragments that users can save and reuse across Sheet instances.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 11–26 | `get_templates(conn, type_slug)` | Lists templates filtered by `type_slug` |
| 27–43 | `create_template(conn, data)` | Inserts new template; returns created row |
| 44–end | `delete_template(conn, template_id)` | Hard-deletes template by ID |

## Decisions

- **`type_slug` filter**: templates are scoped to an engine type (`sheet_v1`, etc.) so future engine types can have separate template libraries without schema changes.
