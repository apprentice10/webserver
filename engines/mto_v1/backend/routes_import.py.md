# backend/routes_import.py

**Description:** MTO V1 — import/export support. Step 16: browse a source DB. Step 17: import one typical.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `_SKIP_ON_COPY` | 17 | Columns excluded when mapping materials between DBs (`id`, `typical_id`) |
| `_open_source_db` | 22 | Opens external SQLite file; validates `.db` extension; rejects path-traversal via `Path.resolve(strict=True)` |
| `_check_mto_tables` | 34 | Raises 422 if `mto_typicals` or `mto_materials` are missing — structured error for non-MTO files |
| `_table_columns` | 95 | Returns ordered column names for a table via `PRAGMA table_info` |
| `list_source_typicals` | `GET /import/list?db_path=` | Returns typicals list with `material_count`, `has_image`, and `image_format` fields |
| `get_import_image` | `GET /import/image?db_path=&typical_id=` | Streams image BLOB from an external DB; used for SVG thumbnails in the import panel |
| `import_typical` | `POST /{tool_id}/import` | Imports one typical from external DB: creates/replaces typical, copies materials, image, placements |

## Decisions

- `Path.resolve(strict=True)` raises `OSError` if the path does not exist, collapsing traversal attacks and missing-file checks into one call.
- `.db` extension check prevents accidentally opening non-SQLite files that happen to exist.
- Source connection is always closed in a `finally` block — no leak even when exceptions are raised.
- Materials copy uses dynamic column intersection (`PRAGMA table_info` on both DBs) so schema drift between projects is handled gracefully — extra source columns are silently skipped.
- TAG values are preserved verbatim from source so placement coordinates (which reference TAGs by value) remain valid after import.
- If the target typical name already exists, its materials/image/placements are replaced (idempotent re-import). The typical row itself is not deleted — ETL-derived data and position are preserved.
