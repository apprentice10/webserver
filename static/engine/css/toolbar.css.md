# toolbar.css

Toolbar secondaria sotto la topbar: layout left/right, separatori e campo di ricerca.

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Toolbar wrapper | `.tool-toolbar`, `.tool-toolbar-left`, `.tool-toolbar-right` |
| Navigazione | `.back-btn`, `.toolbar-separator` |
| Ricerca | `.search-input` |

## Decisioni

- `.tool-toolbar` usa `justify-content: space-between` per separare gruppo sinistra (nav + filtri) da gruppo destra (azioni secondarie).
- `.search-input` ha `width: 240px` fisso — non cresce, per evitare che spinga fuori i pulsanti su viewport strette.
