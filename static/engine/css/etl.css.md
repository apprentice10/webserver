# etl.css

Tutti gli stili dell'ETL Editor: layout principale, area editor SQL, preview tabella, risultati apply, storico versioni, schema browser.

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Layout | `.etl-layout`, `.etl-main`, `.etl-sidebar` |
| Editor area | `.etl-editor-area`, `.etl-editor-header`, `.etl-sql-input`, `.etl-editor-actions` |
| Preview | `.etl-preview-area`, `.etl-preview-table`, `.etl-preview-info` |
| Warnings / risultati | `.etl-warnings`, `.etl-warning`, `.etl-apply-result`, `.etl-result-*` |
| Storico | `.etl-sidebar-header`, `.etl-history-list`, `.etl-history-item`, `.etl-history-btn` |
| Schema browser | `.etl-schema-browser`, `.schema-group`, `.schema-group-header`, `.schema-col-item` |

## Decisioni

- **`.etl-sidebar` width: 220px fisso**: sidebar sinistra (schema browser + storico) non deve essere ridimensionabile dall'utente — semplifica il layout flex.
- **`.etl-history-list` max-height: 180px**: limita lo storico a ~5 voci visibili; il resto scorre. Altrimenti su tool con molte versioni la sidebar schiaccia lo schema browser.
- **`.etl-schema-browser` max-height: 280px**: bilanciamento empirico per far stare entrambi i pannelli della sidebar in 500px di min-height del layout.
- **`etl-sidebar-header` duplicazione**: la classe era duplicata in table.css (L871 e L953). In etl.css è unificata con le proprietà di entrambe le occorrenze.
