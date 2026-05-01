---
# static/engine/js/sql_editor.js

**Descrizione:** Power SQL Editor inline del Table Engine — toggle pannello, esecuzione query arbitrarie (SELECT/DML), rendering risultati.

## Indice

| Sezione | Funzioni pubbliche |
|---------|--------------------|
| Init | `_init()` — attacca shortcut `Ctrl+Enter` (esegue solo se pannello visibile) |
| Toggle | `toggle()` — mostra/nasconde `#sql-editor-panel`, focus su `#sql-input` |
| Esecuzione | `run()` — `ApiClient.runSql`, rendering risultati o errore |
| Rendering | `_renderResults(data)` — tabella HTML per SELECT; messaggio per DML (`rowcount`) |
| Pulizia | `clear()` — svuota input e risultati |

## Decisioni

- **DDL bloccato lato server** (`_check_sql_safety` in `etl.py`): il frontend non filtra — l'error handling viene dal backend.
- **`_escHtml` da `Utils.escHtml`**: assegnato localmente (`const _escHtml = Utils.escHtml`) per brevità interna.
- **`_init()` chiamato all'avvio** (dentro l'IIFE, prima del `return`): nessun `init()` pubblico necessario.
