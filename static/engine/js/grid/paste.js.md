---
# static/engine/js/paste.js

**Descrizione:** Gestisce incolla da Excel/CSV — due modalità: range paste (su celle esistenti) e append paste (crea nuove righe).

## Indice

| Sezione | Funzioni |
|---------|----------|
| Init | `init()` — attacca `focusin` + `paste` listeners sul documento |
| Tracking ancora | `_onFocusIn` — traccia `_anchorCell` (`{ rowId, rowIndex, colIndex, field }`) |
| Handler paste | `_onPaste` — rileva paste multi-cella (tab o newline), decide modalità |
| Parsing | `_parseClipboard(text)` — TSV o CSV → matrice 2D; gestisce `\r\n` e trailing newline Excel |
| Range paste | `_pasteRange(matrix)` — aggiorna celle esistenti a partire da `_anchorCell` |
| Append paste | `_pasteNewRows(matrix)` — crea nuove righe via `ApiClient.pasteRows`; richiede `tag` nella prima colonna |
| Utility | `_getEditableColumns()` — esclude `rev` e `log` |

## Decisioni

- **Paste singolo valore**: lasciato al browser (no `preventDefault`) — solo paste multi-cella è intercettato.
- **Ghost row = modalità append**: se il focus è sulla ghost row, `_anchorCell` è `null` → sempre append.
- **Righe cancellate skippate** nel range paste (`row.is_deleted`).
- **`filteredRows` da `GridManager.getSelectionForPaste()`** (non dal DOM): garantisce che paste su virtual scroll funzioni su tutte le righe del dataset, non solo su quelle renderizzate. `_getVisibleRows()` (DOM-based) rimossa in Group Y.
- **Separatore auto-detect**: TSV se contiene `\t`, altrimenti CSV.
