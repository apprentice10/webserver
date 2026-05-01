---
# static/engine/js/toolbar.js

**Descrizione:** Gestisce le azioni della toolbar del tool: init, cambio revisione, settings, nota, export Excel, ETL run, aggiungi colonna.

## Indice

| Sezione | Funzioni pubbliche |
|---------|--------------------|
| Init | `init()` — carica tool da API, aggiorna UI e bottone ETL |
| UI update | `_updateToolUI()` — aggiorna rev badge, titolo pagina, sidebar item |
| Revisione | `changeRev()` — prompt + PATCH settings |
| Icon picker | `_renderIconPicker`, `selectIcon` |
| Settings | `openSettings()`, `saveSettings()` |
| Nota | `saveNote(content)` |
| Aggiungi colonna | `addColumn()` — delega a `ColumnsManager.openAddColumnModal()` |
| ETL | `_updateEtlButton()`, `runEtl()` — mostra badge stale, esegue ETL, ricarica grid |
| Export | `exportExcel()` — usa `window.location.href` |
| Getter | `getToolType()` — restituisce `_tool.tool_type` |

## Decisioni

- **`_tool` locale**: mantiene lo stato del tool corrente in memoria; aggiornato ad ogni PATCH settings o run ETL.
- **`btn-stale` CSS class**: il bottone ETL riceve la classe se `_tool.is_stale === true`; rimossa dopo run riuscito senza re-render completo.
- **`TOOL_ICONS`**: lista emoji disponibili nell'icon picker — definita qui come costante globale.
