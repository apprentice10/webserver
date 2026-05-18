# backend/routes_materials_ext.py

**Description:** MTO V1 — grid-api v1 extended contract for `mto_materials`. Handles batch operations, paste, audit, find-replace, autocomplete, sort-filter state persistence, and per-typical Excel export.

## Index

| Symbol | Line | Purpose |
|--------|------|---------|
| `insert_row` | 27 | POST `…/rows/{row_id}/insert` — inserts blank row above or below anchor |
| `copy_insert_row` | 70 | POST `…/rows/{row_id}/copy-insert` — duplicates a row below anchor |
| `batch_update` | 124 | POST `…/rows/batch-update` — multi-cell update in one request |
| `batch_op` | 165 | POST `…/rows/batch-op` — delete multiple rows by ID |
| `batch_remove_override` | 188 | POST `…/rows/batch-remove-override` — no-op (MTO has no ETL override concept) |
| `paste_rows` | 198 | POST `…/rows/paste` — creates new rows from pasted cell data |
| `get_audit` | 244 | GET `…/audit` — parses pipe-delimited log lines into structured entries |
| `find_replace` | 305 | POST `…/find_replace` — case/whole-cell options; updates matching cells |
| `column_values` | 367 | GET `…/column_values/{col_slug}` — autocomplete suggestions |
| `export_excel` | 392 | GET `…/export/excel` — per-typical openpyxl export |
| `get_sort_filter_state` | 455 | GET `…/sort-filter-state` |
| `set_sort_filter_state` | 479 | PATCH `…/sort-filter-state` — stores JSON in `mto_sf_state` |

## Decisions

- **Router ordering:** This router must be included in `routes.py` **before** `routes_materials` so that static path segments (`batch-update`, `paste`, `batch-op`) are not captured as `{row_id}` by the core router's parametric patterns.
- **`batch_remove_override` is a no-op:** The grid calls this when the user removes an ETL override. MTO materials have no ETL override concept, so the endpoint exists purely to satisfy the contract.
- **Audit parses the log column:** Log entries are pipe-delimited (`REV|col|old|new|ts`). Parsing is done in Python at query time; no separate audit table. Limit=200 default.
- **`mto_sf_state` keyed by `typical_id`:** Sort-filter state is per-typical, not per-tool. Stored as JSON blob.
- **Excel export is per-typical:** Generates one sheet named after the typical (truncated to 31 chars per Excel limit). `total` column uses the same `quantity × utility_count` computation as the API.
