# columns.js — Engine

**Scopo:** Gestisce le colonne dinamiche del Table Engine: rendering header, aggiunta, rinomina, eliminazione, drag-and-drop reorder, larghezza locale.

---

## Indice sezioni

| Sezione | Righe | Note |
|---------|-------|------|
| Stato interno | 16–20 | `_columns[]`, `_dragSrcId`, `_ctxColId`, `_ctxColName` |
| Getter / loadColumns | 25–29 | `getColumns()`, `loadColumns()` via ApiClient; calls `_initColContextMenu()` |
| renderHeader | 44–87 | Genera `<th>` con dataset, draggable, lineage tooltip |
| _attachDragListeners | 89–164 | Drag & drop + contextmenu listener per th non-system |
| openAddColumnModal | 170–180 | Apre modale, auto-genera slug da nome |
| submitAddColumn | 182–211 | Valida e chiama ApiClient.addColumn |
| renameColumn | 218–246 | prompt() + confirm (ETL columns) + ApiClient.updateColumn + toast ETL update |
| deleteColumn | 242–271 | confirm() + ApiClient.deleteColumn |
| updateLocalWidth | 278–281 | Chiamato da ResizeManager dopo drag o dblclick |
| Utility | 288–303 | `_toSlug`, `_escHtml`, `_escAttr` |
| Column header context menu | 310–355 | `_openColContextMenu`, `_closeColContextMenu`, `_initColContextMenu` |

---

## Decisioni

### D1 — Reorder: mutazione diretta + sort (non map)

Nel drop handler, le nuove posizioni si assegnano con:
```js
userCols.forEach((col, i) => { col.position = 2 + i; });
_columns.sort(...);
```
**Non** con `_columns.map(...)`. Motivazione: `filter` restituisce array con *stessi riferimenti* agli oggetti; `forEach` su `userCols` muta le posizioni in-place anche in `_columns`. Un `map` che itera `_columns` in ordine originale assegnerebbe `pos++` nell'ordine sbagliato, rendendo il sort successivo un no-op. Bug introdotto e rimosso in sessione 2026-04-25.

### D2 — `dataset.isSystem` è stringa "0"/"1"

La guard nel dragover/drop confronta `th.dataset.isSystem !== "1"` (stringa), non booleano. Cambiare in `parseInt(...)` o `=== true` romperebbe il check.

### D3 — Posizioni colonne utente partono da 2

La colonna di sistema TAG occupa position 1. Le colonne utente iniziano da 2. LOG (system) viene messa in fondo dal sort (`if (a.slug === "log") return 1`).
