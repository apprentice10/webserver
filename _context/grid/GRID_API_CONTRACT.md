# GRID_API_CONTRACT.md — Grid API v1

The **grid-api v1** is the REST contract that any engine backend must implement to host a shared grid.  
Any engine declaring `"dashboard_uses": ["grid-api v1"]` in its `engine.json` must satisfy this contract.

Sheet V1 is the reference implementation (`engines/sheet_v1/backend/`).

---

## Endpoint Base

All grid endpoints are relative to a configurable **`endpointBase`** string.  
The grid is initialized with:

```js
Grid.init({ endpointBase: "/api/engines/42" })
```

Every path in this document is written as `{endpointBase}/…`. The grid never builds the base itself — the host page provides it.

All endpoints accept a `db` query parameter:

```
?db={urlEncodedDbPath}
```

It is appended to every request. The `endpointBase` never encodes the DB path — the grid always appends `?db=`.

---

## Sub-table Grids

A grid scoped to a sub-entity (e.g. MTO materials for a specific typical) encodes the filter in the `endpointBase` itself:

```js
Grid.init({ endpointBase: "/api/engines/mto/42/materials/7" })
```

The grid has no knowledge of the filter — the backend routes handle the scoping. This keeps the grid stateless about filtering logic.

---

## Required System Columns

Every table hosted by the grid must expose these fields in each row object:

| Field | Type | Notes |
|-------|------|-------|
| `__id` | integer | Internal PK. Never editable. Used as the `rowId` in all mutation endpoints. |
| `__position` | integer | Sort order. Managed by the backend on reorder operations. |
| `__created_at` | string (ISO 8601) | Creation timestamp. |
| `tag` | string | Human-visible unique row key (TAG system column). Required for audit and ETL merge. |
| `rev` | string | Revision stamp (REV system column). Read-only to the user. |
| `log` | string \| null | Serialized audit log for the row (`__log` internally, exposed as `log`). |
| `is_deleted` | 0 \| 1 | Soft-delete flag. |

User-defined columns are included as flat key-value pairs on the same object using their `col_slug` as the key.

**For simpler implementations** (e.g. MTO materials): `rev`, `log`, and `is_deleted` may be omitted if the corresponding grid features (revisions, audit panel, soft-delete) are not enabled in that host page. Mark them as `null` or omit them — the grid skips rendering for absent fields.

---

## Endpoint Reference

### 1. Tool

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `{endpointBase}?db=` | Load tool metadata |
| `PATCH` | `{endpointBase}/settings?db=` | Update tool settings |

**GET response:**
```json
{
  "id": 1,
  "name": "Instrument List",
  "slug": "il-001",
  "tool_type": "sheet",
  "engine_version": "sheet_v1",
  "current_rev": "A",
  "note": null,
  "icon": "📄"
}
```

**PATCH request body** (all optional):
```json
{
  "name": "New Name",
  "rev": "B",
  "current_rev": "B",
  "note": "Updated note",
  "icon": "📋"
}
```

---

### 2. Columns

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `{endpointBase}/columns?db=` | List all columns |
| `POST` | `{endpointBase}/columns?db=` | Add a column |
| `PATCH` | `{endpointBase}/columns/{columnId}?db=` | Update column metadata |
| `DELETE` | `{endpointBase}/columns/{columnId}?db=` | Delete a user column |
| `PATCH` | `{endpointBase}/columns/{columnId}/width?db=` | Set column width |
| `PUT` | `{endpointBase}/columns/reorder?db=` | Reorder all columns |

**GET response:** `list[ColumnObject]`

```json
[
  {
    "id": 1,
    "tool_id": 1,
    "name": "Tag",
    "slug": "tag",
    "col_type": "text",
    "width": 110,
    "position": 0,
    "is_system": true,
    "formula": null
  }
]
```

**POST request body:**
```json
{ "name": "Description", "slug": "description", "col_type": "text", "width": 120 }
```

**PATCH request body** (all optional):
```json
{ "name": "New Name", "width": 150, "col_type": "text", "formula": null }
```

**PATCH width body:**
```json
{ "width": 180 }
```

**PUT reorder body:**
```json
{ "order": [3, 1, 4, 2] }
```
Array of column IDs in the desired display order.

---

### 3. Rows — Read & Create

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `{endpointBase}/rows?db=&include_deleted=false` | List all rows |
| `POST` | `{endpointBase}/rows?db=` | Create a new row |

**GET response:** `list[RowObject]` (see system columns table above for guaranteed fields).

**POST request body:**
```json
{ "cells": { "tag": "ABC-001", "description": "Pressure transmitter" } }
```

**POST response:** The created `RowObject`.

---

### 4. Rows — Cell Update

| Method | Path | Notes |
|--------|------|-------|
| `PATCH` | `{endpointBase}/rows/{rowId}/cell?db=` | Update a single cell |

**PATCH request body:**
```json
{ "slug": "description", "value": "New value" }
```

**Response:** Updated `RowObject`.

---

### 5. Rows — Soft/Hard Delete, Restore, Keep, Override

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `{endpointBase}/rows/{rowId}/delete?db=` | Soft-delete a row |
| `POST` | `{endpointBase}/rows/{rowId}/restore?db=` | Restore a soft-deleted row |
| `POST` | `{endpointBase}/rows/{rowId}/hard-delete?db=` | Permanently delete a row |
| `POST` | `{endpointBase}/rows/{rowId}/keep?db=` | Mark a row as explicitly kept (ETL-override) |
| `DELETE` | `{endpointBase}/rows/{rowId}/override?col={colSlug}&db=` | Remove ETL override on one cell |

All return `200 OK` with the updated `RowObject` or `{ "ok": true }`.

---

### 6. Rows — Position

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `{endpointBase}/rows/{rowId}/insert?db=` | Insert blank row above or below |
| `POST` | `{endpointBase}/rows/{rowId}/copy-insert?db=` | Duplicate row, insert below |
| `POST` | `{endpointBase}/rows/{rowId}/reorder?db=` | Drag-reorder row to new position |

**insert request body:**
```json
{ "placement": "above" }
```
`placement`: `"above"` | `"below"`

**reorder request body:**
```json
{ "anchor_row_id": 17, "placement": "before" }
```
`placement`: `"before"` | `"after"`

---

### 7. Rows — Batch Operations

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `{endpointBase}/rows/batch-update?db=` | Update multiple cells at once |
| `POST` | `{endpointBase}/rows/batch-op?db=` | Apply one operation to many rows |
| `POST` | `{endpointBase}/rows/batch-remove-override?db=` | Remove ETL override on many cells |
| `POST` | `{endpointBase}/rows/paste?db=` | Paste rows from clipboard |

**batch-update body:**
```json
{ "cells": [{ "row_id": 1, "col_slug": "description", "value": "X" }] }
```

**batch-op body:**
```json
{ "operation": "soft_delete", "row_ids": [1, 2, 3] }
```
`operation`: `"soft_delete"` | `"hard_delete"` | `"restore"` | `"keep"`

**batch-remove-override body:**
```json
{ "cells": [{ "row_id": 1, "col_slug": "description" }] }
```

**paste body:**
```json
{ "rows": [{ "tag": "ABC-001", "description": "PT" }] }
```

---

### 8. Audit & Rollback

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `{endpointBase}/audit?db=&row_tag=&row_tags=&col_slug=&col_slugs=&limit=200&revision=` | Query audit log |
| `POST` | `{endpointBase}/rows/{rowId}/rollback?db=&col={colSlug}&entry_id={entryId}` | Roll back one cell to a past value |

**GET response:**
```json
[
  {
    "id": 42,
    "row_tag": "ABC-001",
    "col_slug": "description",
    "old_value": "Pressure transmitter",
    "new_value": "Flow transmitter",
    "changed_at": "2024-03-01T10:00:00",
    "source": "user"
  }
]
```

All query params are optional. `row_tags` and `col_slugs` accept comma-separated values.

---

### 9. Undo / Redo

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `{endpointBase}/undo?db=` | Undo last operation |
| `POST` | `{endpointBase}/redo?db=` | Redo last undone operation |
| `GET` | `{endpointBase}/undo-state?db=` | Get stack sizes |

**undo-state response:**
```json
{ "undo": 3, "redo": 0 }
```

`undo` / `redo` responses return a summary of what was reversed (shape engine-defined; the grid uses it to trigger a full row reload).

---

### 10. Sort & Filter State

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `{endpointBase}/sort-filter-state?db=` | Load persisted sort/filter |
| `PATCH` | `{endpointBase}/sort-filter-state?db=` | Persist sort/filter state |

**GET / PATCH body:**
```json
{
  "sort": [{ "col": "tag", "dir": "asc" }],
  "filters": { "description": "pump" }
}
```

---

### 11. Flags — Project-scoped CRUD

Flags are project-level (not scoped to a tool). They use a **fixed path**, not `endpointBase`.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/engines/flags?db=` | List all flags in the project |
| `POST` | `/api/engines/flags?db=` | Create a flag |
| `PATCH` | `/api/engines/flags/{flagId}?db=` | Update a flag |
| `DELETE` | `/api/engines/flags/{flagId}?db=` | Delete a flag |

**Flag object:**
```json
{ "id": 1, "name": "Check", "color": "#e74c3c" }
```

**POST body:** `{ "name": "Check", "color": "#e74c3c" }`  
**PATCH body** (optional fields): `{ "name": "Verify", "color": "#2ecc71" }`

> Note: This is a platform-level concern, not implemented per-engine. New engines inherit this from the shared platform.

---

### 12. Cell Flags — Tool-scoped

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `{endpointBase}/cell-flags/toggle?db=` | Toggle a flag on/off for a set of cells |
| `PATCH` | `{endpointBase}/cell-flags/note?db=` | Update the note on a cell flag |
| `GET` | `{endpointBase}/flag-rules?db=` | List conditional flag rules for this tool |
| `POST` | `{endpointBase}/flag-rules?db=` | Create a conditional flag rule |
| `DELETE` | `{endpointBase}/flag-rules/{ruleId}?db=` | Delete a conditional flag rule |

**toggle body:**
```json
{
  "flag_id": 1,
  "cells": [{ "row_tag": "ABC-001", "col_slug": "description" }],
  "note": "Needs review"
}
```
`col_slug` may be `""` to flag the entire row.

**note body:**
```json
{
  "flag_id": 1,
  "cells": [{ "row_tag": "ABC-001", "col_slug": "" }],
  "note": "Updated note"
}
```

**flag-rule object:**
```json
{
  "id": 1,
  "col_slug": "description",
  "flag_id": 2,
  "operator": "contains",
  "value": "check"
}
```
`operator`: `"contains"` | `"equals"` | `"is_empty"` | `"starts_with"` | `"matches_wildcard"`

---

### 13. Find & Replace

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `{endpointBase}/find_replace?db=` | Replace text across cells |
| `GET` | `{endpointBase}/column_values/{colSlug}?db=&prefix=` | Get distinct values for autocomplete |

**find_replace body:**
```json
{
  "search": "pump",
  "replacement": "compressor",
  "match_case": false,
  "match_entire_cell": false,
  "scope": [{ "row_id": 1, "col_slug": "description" }]
}
```
`scope` is `null` for full-sheet replace.

**find_replace response:**
```json
{ "replaced": 4 }
```

**column_values response:** `list[string]`

---

### 14. Export

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `{endpointBase}/export/excel?db=` | Download the table as an Excel file |

This is a browser navigation (`window.location.href`), not a `fetch`. Response is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

---

## Contract Levels

Not all engines need every feature. The contract defines three levels:

| Level | Required endpoints | Notes |
|-------|--------------------|-------|
| **Core** | Tool (GET), Columns (GET+POST+PATCH+DELETE+width+reorder), Rows (GET+POST+PATCH cell, soft-delete, restore, hard-delete, reorder, paste) | Minimum for a working editable grid |
| **Extended** | + Batch ops, + Insert above/below, + Copy-insert, + Remove override, + Keep, + Audit, + Find/Replace, + Export, + Sort/Filter state | Full Sheet-parity experience |
| **Optional** | Undo/Redo, Cell Flags, Flag Rules | Skip if the host engine doesn't need them; the grid disables the corresponding UI controls when the feature is absent |

Sheet V1 implements all three levels. MTO materials (G6) targets **Core + Extended** in the first iteration.

---

## Not Part of This Contract

These endpoints exist in Sheet V1 but are **not** part of the shared grid contract:

| Category | Paths | Why excluded |
|----------|-------|--------------|
| ETL | `{endpointBase}/etl/*` | Sheet-specific transformation system |
| SQL Editor | `{endpointBase}/sql` | Sheet-specific power-user feature |
| Revisions | `/api/project/revision*` | Project-level, platform-managed |
| ETL Templates | `/api/engines/templates*` | Sheet-specific |
| Utilities | `/api/engines/utilities` | Sheet-specific catalog lookup |
