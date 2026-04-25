# layout.css

Stili per il container principale del tool, la topbar e i pulsanti globali condivisi dal Table Engine.

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Container e layout | `.tool-container` |
| Topbar actions | `.topbar-tool-actions`, `.tool-name-badge`, `.rev-badge` |
| Pulsanti globali | `.btn-sm`, `.btn-accent`, `.btn-ghost`, `.btn-stale` |
| Animazione | `@keyframes pulse-stale` |

## Decisioni

- **btn-ghost.active**: usato dai pulsanti toolbar toggle (LOG, REV, Eliminati) — border + colore accent senza background pieno.
- **btn-stale**: animazione pulse su `opacity` invece che su `color` per evitare flash brusco su dark theme.
