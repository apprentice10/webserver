---
# static/engine/js/utils.js

**Descrizione:** Utility condivise per tutti i moduli JS IIFE del Table Engine. Deve essere caricato PRIMO in `table.html` e `etl.html`.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `Utils.escHtml(str)` | Escape HTML entities (`&`, `<`, `>`, `"`) |
| `Utils.escAttr(str)` | Escape attributo HTML (`&`, `"`, `'`) |
| `Utils.formatTimestamp(isoString)` | Formatta ISO → `DD/MM/YYYY HH:MM` locale italiana |
| `Utils.showToast(message, type)` | Crea toast div (classi `toast toast-{type}`), rimuove dopo 3.5s |

## Decisioni

- **`showToast` è globale via `Utils`**: tutti gli altri moduli chiamano `Utils.showToast(...)` — NON `showToast(...)` direttamente (anche se `showToast` è accessibile come scorciatoia nel template). Vedi `_context/FRONTEND_PATTERNS.md`.
- **Nessuna dipendenza esterna**: `utils.js` non dipende da nessun altro modulo — deve essere il primo script caricato.
