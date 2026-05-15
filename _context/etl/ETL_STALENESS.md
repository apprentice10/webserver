# ETL Staleness e Topological Execution

## Staleness tracking

`_tools.is_stale` (INTEGER, default 0) nel DB per-progetto:
- Impostato a **1** quando i dati del tool vengono mutati manualmente (edit/insert/delete/paste) O quando un tool da cui dipende esegue ETL
- Resettato a **0** dopo `etl_run_saved` completato con successo
- UI: dot badge arancione nella sidebar, pulsante "↺ Ricarica" evidenziato nel toolbar

## etl_deps

Campo JSON dentro `_tools.query_config`:
```json
{
  "etl_sql": "SELECT ...",
  "etl_history": [...],
  "etl_deps": ["instrument_list", "cable_list"]
}
```

`etl_deps` è una lista di slug di tool estratta automaticamente dalle clausole FROM/JOIN al momento del salvataggio (`save_etl_version`). **Viene calcolata al save, non al run** — se il SQL cambia senza salvare, `etl_deps` può essere stale.

## Propagazione staleness (ogni mutazione riga)

Chiamata in: `create_row`, `update_cell`, `soft_delete_row`, `restore_row`, `paste_rows`

```
mark_tool_stale(conn, tool_id)         # tool corrente stale
mark_dependents_stale(conn, slug)      # scansiona tutti i tool, marca stale quelli che listano slug in etl_deps
```

`mark_dependents_stale` è in `engine/service.py` (~riga 565).

## etl_run_saved — esecuzione topologica

`engine/etl.py::etl_run_saved(conn, tool_id, _visited=set())`

1. Legge `etl_deps` del tool corrente
2. Per ogni dep che è stale E ha un proprio ETL SQL: chiama ricorsivamente `etl_run_saved(conn, dep_id, _visited)`
3. `_visited` previene loop infiniti — se un tool appare due volte → raise HTTP 400 "circular dependency"
4. Applica ETL del tool corrente
5. `UPDATE _tools SET is_stale=0`
6. `mark_dependents_stale(conn, tool_slug)` — propaga staleness a valle

## Circular import etl.py ↔ service.py

`etl.py` chiama `mark_dependents_stale` da `service.py`, ma `service.py` importa da `etl.py`. Fix: import **differito** dentro il corpo di `etl_run_saved`:
```python
from engine.service import mark_dependents_stale  # dentro la funzione, non al top-level
```

## Note

**Why:** Feature complessa con molti edge case; ogni mutazione ha effetti a cascata.
**How to apply:** Prima di qualsiasi modifica a row CRUD o ETL, verificare se tocca la catena `mark_tool_stale → mark_dependents_stale → etl_run_saved`. Non rimuovere mai le chiamate a `mark_dependents_stale` dalle funzioni di mutazione.
