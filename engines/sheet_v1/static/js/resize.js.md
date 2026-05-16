---
# static/engine/js/resize.js

**Descrizione:** Gestisce resize colonne via drag sul `.resize-handle` e auto-fit su double-click.

## Indice

| Sezione | Funzioni |
|---------|----------|
| Init | `init()` — attach listeners su tutti i `.resize-handle`; clona nodi per rimuovere listener obsoleti |
| Drag | `_onMouseDown`, `_onMouseMove`, `_onMouseUp` — drag con cursore globale, debounce save (400ms) |
| Auto-fit | `_onDoubleClick` — misura larghezza massima testo (header + celle visibili) con probe span |
| Fit all | `fitAll()` — applica auto-fit a tutte le colonne visibili; chiamato da ColumnsManager via col-context-menu |
| Utility | `_measureMaxTextWidth(values, refEl)` — span temporaneo fuori schermo, stessa font della cella |

## Decisioni

- **Pitfall drag vs resize**: `.resize-handle` ha `draggable="false"` e `mousedown` fa `stopPropagation` per evitare che il drag-to-reorder del `<th>` intercetti il resize. Vedi `_context/FRONTEND_PATTERNS.md`.
- **Clone nodo per reset listener**: `init()` usa `cloneNode(true)` per rimuovere listener obsoleti prima di aggiungerne di nuovi — evita listener duplicati dopo re-render header.
- **Debounce 400ms** sul save: aggiorna localmente `ColumnsManager.updateLocalWidth` in tempo reale, persiste al backend solo al mouseup con delay.
- **Range larghezza**: min 20px, nessun massimo. Il minimo di 20px garantisce che il `.resize-handle` rimanga afferrabile senza imporre un clamp percepibile all'utente.
