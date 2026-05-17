---
# static/engine/js/api.js

**Descrizione:** Client HTTP universale del Table Engine — unico modulo autorizzato a fare `fetch` verso il backend. Tutti i metodi sono `async` e restituiscono dati già parsati.

## Index (~283 lines)

| Section | Public methods |
|---------|---------------|
| Internal utility | `request(url, options)` — unified fetch wrapper with error handling |
| Tool | `loadTool`, `updateToolSettings` |
| Columns | `loadColumns`, `addColumn`, `updateColumn`, `deleteColumn`, `updateColumnWidth`, `reorderColumns` |
| Rows | `loadRows`, `createRow`, `updateCell`, `batchUpdate`, `batchRowOp`, `batchRemoveOverride`, `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `removeOverride`, `keepRow`, `pasteRows` |
| Audit / History | `getAudit({rowTag, rowTags, colSlug, colSlugs, limit, revision})` — fetches `_audit` entries; optional `revision` filters to entries from that revision number; `rollbackCell(rowId, col, entryId)` — restores a cell to a previous audit value |
| SQL Editor | `runSql` |
| Export | `exportExcel` — uses `window.location.href` (not fetch, direct download) |
| ETL | `etlCompile`, `etlPreview`, `etlApply`, `etlSave`, `etlRunSaved`, `etlLoadConfig`, `etlLoadSchema`, `etlSaveDraft`, `etlSqlToModel` |
| Flags | `listFlags`, `createFlag`, `updateFlag`, `deleteFlag`, `toggleCellFlags` |
| Template | `saveTemplate`, `deleteTemplate` |
| Revisions | `getRevisions()` — `GET /api/project/revisions`; `createRevision(description, author)` — `POST /api/project/revision`; `deleteRevision(number)` — `DELETE /api/project/revision/{number}`; `getRevisionSnapshot(number, toolSlug)` — `GET /api/project/revision/{N}/tool/{slug}`; `revertRevision(number)` — `POST /api/project/revision/{N}/revert` |

## Decisions

- **`PROJECT_ID` and `TOOL_ID` injected by Jinja2** in the HTML template — not passed as method parameters.
- **Single fetch point**: no other module makes direct HTTP calls. Centralises error handling and URL construction.
- **`exportExcel` uses `window.location.href`** instead of fetch to trigger binary file download.
- **HTTP 204 → `null`**: `request()` checks `response.status === 204` and returns `null` without attempting JSON parse.
- **`getAudit` supports multi-row and multi-col queries**: accepts both `rowTag`/`colSlug` (single) and `rowTags`/`colSlugs` (comma-joined strings). The backend `GET /{tool_id}/audit` merges them into `IN (...)` clauses; the client never sends both single and multi params for the same dimension simultaneously.
- **`batchRowOp(operation, rowIds)`**: `POST /rows/batch-op` — `operation` is `"soft_delete" | "restore" | "hard_delete" | "keep"`. Used by row-ops.js to replace all per-row loops. One network call, one transaction, one undo entry.
- **`batchRemoveOverride(cells)`**: `POST /rows/batch-remove-override` — `cells` is `[{row_id, col_slug}]`. Replaces per-cell `removeOverride` loop.
