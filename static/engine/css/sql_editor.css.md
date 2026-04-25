# sql_editor.css

Pannello SQL Editor inline (Power SQL) che appare in fondo alla pagina tool.

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Pannello | `.sql-editor-panel`, `.sql-editor-header` |
| Body editor | `.sql-editor-body`, `.sql-input`, `.sql-editor-actions` |
| Risultati | `.sql-results`, `.sql-error`, `.sql-success` |

## Decisioni

- Il pannello è `flex-shrink: 0` e ha `max-height: 300px` — non cresce oltre, il contenuto scorre internamente.
- `.sql-input` usa `resize: vertical` (non horizontal) per evitare che l'utente rompa il layout con resize orizzontale.
- Il bordo superiore è `2px solid var(--color-accent)` per distinguerlo visivamente dal tool note (che usa `--color-border`).
