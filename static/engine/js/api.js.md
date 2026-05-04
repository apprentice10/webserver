---
# static/engine/js/api.js

**Descrizione:** Client HTTP universale del Table Engine — unico modulo autorizzato a fare `fetch` verso il backend. Tutti i metodi sono `async` e restituiscono dati già parsati.

## Indice

| Sezione | Metodi pubblici |
|---------|----------------|
| Utility interna | `request(url, options)` — wrapper fetch con error handling unificato |
| Tool | `loadTool`, `updateToolSettings` |
| Colonne | `loadColumns`, `addColumn`, `updateColumn`, `deleteColumn`, `updateColumnWidth`, `reorderColumns` |
| Righe | `loadRows`, `createRow`, `updateCell`, `softDeleteRow`, `restoreRow`, `hardDeleteRow`, `removeOverride`, `pasteRows` |
| SQL Editor | `runSql` |
| Export | `exportExcel` — usa `window.location.href` (non fetch, download diretto) |
| ETL | `etlCompile`, `etlPreview`, `etlApply`, `etlSave`, `etlRunSaved`, `etlLoadConfig`, `etlLoadSchema`, `etlSaveDraft`, `etlSqlToModel` |
| Flags | `listFlags`, `createFlag`, `updateFlag`, `deleteFlag`, `toggleCellFlags` |
| Template | `saveTemplate`, `deleteTemplate` |

## Decisioni

- **`PROJECT_ID` e `TOOL_ID` iniettati da Jinja2** nel template HTML — non passati come parametri ai metodi.
- **Unico punto di fetch**: nessun altro modulo fa chiamate HTTP dirette. Centralizza error handling e URL construction.
- **`exportExcel` usa `window.location.href`** anziché fetch per triggerare il download del file binario.
- **HTTP 204 → `null`**: `request()` controlla `response.status === 204` e restituisce `null` senza tentare il parse JSON.
