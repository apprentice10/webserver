---
# static/engine/js/api.js

**Description:** Universal HTTP client for the Table Engine — the only module allowed to `fetch` the backend. All methods are `async` and return parsed data.

## Index (~446 lines)

| Section | Public methods |
|---------|---------------|
| Internal utility | `configure({ endpointBase })`, `request(url, options)` — unified fetch wrapper with error handling |
| Tool | `loadTool`, `updateToolSettings` |
| Columns | `loadColumns`, `addColumn`, `updateColumn`, `deleteColumn`, `updateColumnWidth`, `reorderColumns` |
| Rows | `loadRows`, `createRow`, `updateCell`, `batchUpdate`, `batchRowOp`, `batchRemoveOverride`, `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `removeOverride`, `keepRow`, `pasteRows`, `insertRow`, `copyRowInsert`, `reorderRow` |
| Audit / History | `getAudit({rowTag, rowTags, colSlug, colSlugs, limit, revision})`, `rollbackCell(rowId, col, entryId)` |
| SQL Editor | `runSql` — Sheet-specific, hardcoded path |
| Export | `exportExcel` — uses `window.location.href` (direct download, not fetch) |
| ETL | `etlCompile`, `etlPreview`, `etlApply`, `etlSave`, `etlRunSaved`, `etlLoadConfig`, `etlLoadSchema`, `etlSaveDraft`, `etlSqlToModel`, `listProjectTools` — Sheet-specific, hardcoded paths |
| Flags (project-scoped) | `listFlags`, `createFlag`, `updateFlag`, `deleteFlag` — fixed `/api/engines/flags` path |
| Cell Flags (tool-scoped) | `toggleCellFlags`, `updateCellFlagNote` — use `endpointBase` |
| Flag Rules | `listFlagRules`, `createFlagRule`, `deleteFlagRule` — use `endpointBase` |
| Templates | `saveTemplate`, `deleteTemplate` — Sheet-specific, fixed paths |
| Revisions | `getRevisions`, `createRevision`, `deleteRevision`, `getRevisionSnapshot`, `revertRevision` — project-level, fixed `/api/project/` paths |
| Find & Replace | `findReplace({search, replacement, match_case, match_entire_cell, scope})`, `getColumnValues(colSlug, prefix)` |
| Undo / Redo | `undo`, `redo`, `getUndoState` |
| Sort / Filter | `getSortFilterState`, `setSortFilterState` |
| Utilities | `getUtilities(category)` — Sheet-specific, fixed path |

## Decisions

- **`configure({ endpointBase })`** must be called before any grid method. `GridManager.init({ endpointBase })` does this automatically. All grid-contract endpoints resolve against `_endpointBase`. Sheet-specific endpoints (ETL, SQL, utilities, templates) and project-level endpoints (flags CRUD, revisions) use hardcoded paths or the global `TOOL_ID` directly — they are not part of the shared grid contract.
- **`TOOL_ID` and `DB_PATH` injected by Jinja2** in the HTML template — not passed as method parameters.
- **Single fetch point**: no other module makes direct HTTP calls. Centralises error handling and URL construction.
- **`exportExcel` uses `window.location.href`** instead of fetch to trigger binary file download.
- **HTTP 204 → `null`**: `request()` checks `response.status === 204` and returns `null` without attempting JSON parse.
- **`getAudit` supports multi-row and multi-col queries**: accepts both `rowTag`/`colSlug` (single) and `rowTags`/`colSlugs` (comma-joined strings). The backend `GET /{tool_id}/audit` merges them into `IN (...)` clauses; the client never sends both single and multi params for the same dimension simultaneously.
- **`batchRowOp(operation, rowIds)`**: `POST /rows/batch-op` — `operation` is `"soft_delete" | "restore" | "hard_delete" | "keep"`. Used by row-ops.js to replace all per-row loops. One network call, one transaction, one undo entry.
- **`batchRemoveOverride(cells)`**: `POST /rows/batch-remove-override` — `cells` is `[{row_id, col_slug}]`. Replaces per-cell `removeOverride` loop.
