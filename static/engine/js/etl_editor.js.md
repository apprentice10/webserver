---
# static/engine/js/etl_editor.js

**Descrizione:** ETL Editor standalone — usato dalla pagina `/tool/{pid}/{tid}/etl`. Gestisce editor SQL con syntax highlighting (CodeMirror 5), preview, apply, storico versioni, template, schema browser.

## Indice

| Sezione | Funzioni pubbliche |
|---------|--------------------|
| Init | `init()` — carica config ETL, history, inizializza CodeMirror, schema, template; Ctrl+Enter → preview; beforeunload guard |
| Tool type | `setToolType(type)` — iniettato dal template Jinja2 prima di `init()` |
| Schema browser | `refreshSchema()`, `_renderSchema()`, `insertColumn(text)` — click colonna inserisce `tool_slug.col_slug` nel cursore CM |
| Preview | `preview()` — chiama `etlPreview`, popola `_previewData` |
| Apply | `apply()` — richiede preview precedente; confirm dialog; auto-save draft dopo apply |
| Versioni | `saveVersion()` — prompt label; chiama `etlSave`; aggiorna `_history` |
| Template | `refreshTemplates()`, `saveAsTemplate()`, `deleteTemplate()`, `loadTemplate()` — scoped per `_toolType` |
| History | `_renderHistory()`, `loadVersion(index)` — carica SQL da storico |
| Format | `formatSql()` — formatta SQL via `sql-formatter` lib (CDN) |
| Utility | `_getSql()`, `_setSql(sql)` — accedono a `_cmEditor` se disponibile, altrimenti fallback textarea |

## Decisioni

- **CodeMirror 5 via CDN**: caricato come `<script>` plain in `etl.html` prima di `etl_editor.js`. Se `CodeMirror` è undefined (offline o CDN failure), `init()` fa fallback sulla textarea grezza — nessun crash.
- **`_cmEditor` null-safe**: tutte le funzioni (`_getSql`, `_setSql`, `insertColumn`) gestiscono `_cmEditor === null` con fallback alla textarea.
- **`_getSql` / `_setSql`**: wrapper interni che centralizzano l'accesso al valore dell'editor. Non accedere direttamente a `editor.value` o `_cmEditor.getValue()` fuori da questi.
- **`formatSql()`**: usa `window.sqlFormatter.format()` (sql-formatter v15 UMD). Se la lib non è caricata, mostra toast di errore.
- **Auto-save draft dopo apply**: dopo un `etlApply` riuscito, `etlSaveDraft` viene chiamato silenziosamente per aggiornare `etl_sql` + `etl_deps` senza aggiungere voce alla history.
- **Preview obbligatoria prima di apply**: se `_previewData === null`, `apply()` rifiuta con toast.
- **`_toolType`**: necessario per filtrare i template per tipo tool. Iniettato da Jinja2 via `EtlEditor.setToolType(...)` o caricato da `ApiClient.loadTool()` nell'init.
- **beforeunload guard**: legge `_getSql()` e confronta con `_currentSql` — funziona sia con CM sia con textarea.
- **Schema browser**: il tool corrente è auto-espanso (`is_current: true`). Click su colonna → inserisce testo al cursore CM via `_cmEditor.getDoc().replaceRange()`.
