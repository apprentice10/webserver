# engines/mto_v1/backend/routes_utilities.py

**Description:** MTO V1 read-only utilities endpoint — returns rows from `mto_utilities` for a given typical, with dynamically discovered user-visible columns.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `_EXCLUDED` | 9 | Column names never returned to the frontend (`id`, `tool_id`, `typical_name`) |
| `_require_mto_tool` | 12 | Raises 404 if `tool_id` is not an MTO tool |
| `get_utilities` | 19 | `GET /{tool_id}/utilities?typical_name=...` — returns `{columns, rows}` |

## Decisions

- Columns are discovered at query time via `PRAGMA table_info(mto_utilities)` rather than hard-coded, so any extra columns added by future ETL schema changes are surfaced automatically.
- The `col_sql` f-string is safe: values come from PRAGMA (our own schema), not user input.
- `typical_name` is a query parameter (not a path segment) to avoid URL-encoding issues with spaces and special chars in typical names.
- Utilities are read-only — this module has no POST/PATCH/DELETE. All writes go through the ETL flow in `service_etl.py`.
