# grid.css

Cuore del Table Engine: griglia dati, intestazioni, resize handle, righe, celle input, toggle LOG/REV, context menu e drag-and-drop colonne.

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Wrapper e scroll | `.grid-wrapper`, `.grid-scroll-container` |
| Tabella | `.data-grid`, `thead`, `.data-grid th`, `.th-content`, `.th-label` |
| Resize handle | `.resize-handle` |
| Righe | `tbody tr`, `.row-deleted`, `.row-ghost` |
| Cella input | `.cell-input`, `.cell-input:focus`, `.cell-input[readonly]` |
| Select mode | `.cell-input[data-editable][readonly]` |
| Celle speciali | `.cell-tag`, `.cell-log-preview` |
| Azioni per riga | `.col-actions`, `.cell-actions`, `.btn-row-action` |
| Toggle colonne | `.data-grid.log-hidden`, `.data-grid.rev-hidden` |
| Context menu | `.context-menu`, `.ctx-item`, `.ctx-separator` |
| Drag colonne | `.th-draggable`, `.col-dragging`, `.col-dragover` |

## Decisioni

- **Select/edit mode**: celle editabili sono `readonly data-editable` di default (select mode). Il JS rimuove `readonly` su dblclick/Enter per entrare in edit mode. CSS distingue i due stati via `[data-editable][readonly]` vs `:focus` senza readonly.
- **Toggle LOG/REV via CSS class**: la classe `.log-hidden` / `.rev-hidden` su `#data-grid` nasconde le celle per slug — non re-render, non `display:none` per cella. Più performante e non rompe la navigazione keyboard.
- **`width: max-content` su `.data-grid`**: permette scroll orizzontale quando le colonne superano il viewport. `min-width: 100%` garantisce che tabelle strette si estendano.
- **`.th-actions` hidden**: i pulsanti header colonne sono stati rimossi dalla griglia e spostati nell'ETL Editor.
