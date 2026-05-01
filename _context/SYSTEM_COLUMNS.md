# System Columns e Internal Columns

## System Columns (visibili all'utente, immutabili)

Definite in `engine/project_db.py::SYSTEM_COLUMN_DEFS` (riga ~81). Auto-create per ogni tool, non rinominabili né eliminabili.

| slug | name | position | width | note |
|------|------|----------|-------|------|
| `tag` | TAG | 0 | 110 | chiave unica di riga, obbligatoria |
| `rev` | REV | 1 | 60 | read-only per l'utente |
| `log` | LOG | 999 | 260 | nascosta via `.log-hidden` CSS class su `#data-grid` |

## Internal Columns (prefisso `__`, NON in `_columns`, NON visibili)

Ogni flat table tool ha queste colonne interne:

| colonna | tipo | note |
|---------|------|------|
| `__id` | INTEGER PK AUTOINCREMENT | chiave primaria interna |
| `__position` | INTEGER | ordinamento righe |
| `__log` | TEXT | history JSON delle modifiche per riga |
| `__created_at` | TEXT | timestamp ISO creazione |

Queste non compaiono mai in `_columns` e non sono serializzate nella risposta API (eccetto `__log` che viene serializzato come `log` nella risposta riga).

## Regole di immutabilità

- System columns non possono essere rinominate, eliminate o riordinate
- `is_system=1` in `_columns` protegge queste colonne nei controlli in `service.py`
- La colonna LOG è sempre in posizione 999 (ultima) — il CSS usa `[data-slug="log"]` per nasconderla
- TAG è la chiave di merge per ETL: righe con stesso TAG vengono aggiornate, nuovi TAG vengono inseriti

## How to apply

Quando si aggiungono nuove funzionalità alle colonne, verificare sempre che non tocchino le system columns (`is_system=1`). Quando si serializza una riga, `__log` viene esposto come `log` per la UI.
