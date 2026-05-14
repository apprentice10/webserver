# engine/service_templates.py

**Description:** Template CRUD — manages `_templates` records in the per-project SQLite DB. Extracted from `engine/service.py` (P3-007).

## Index

| Lines | Symbol |
|-------|--------|
| 1–13  | Imports |
| 16–26 | `get_templates(conn, type_slug)` — list all or filter by type_slug |
| 29–40 | `create_template(conn, type_slug, name, etl_sql, description)` |
| 43–49 | `delete_template(conn, template_id)` — raises 404 if not found |

## Decisions

- **Zero cross-module deps within engine**: only imports `sqlite3`, `HTTPException`, no dependency on `service.py` or other engine modules.
- **Extracted from service.py**: moved here to reduce service.py toward ≤400 LOC target.
