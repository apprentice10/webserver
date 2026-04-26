---
# engine/service.py

**Descrizione:** Tutta la business logic del Table Engine: tool CRUD, colonne, righe, delete/restore, paste, staleness, template ETL. Le route in `engine/routes.py` sono un thin layer che delega qui.

## Indice (~650 righe post-refactor)

| Righe | Sezione |
|-------|---------|
| 1–40 | Import (`datetime`, `json`, `sqlite3`, utils) |
| 64–155 | Tool CRUD: `get_tool`, `get_tools_for_project`, `create_tool`, `update_tool_settings` |
| 157–280 | Column CRUD: `get_columns`, `add_column`, `update_column`, `delete_column`, `reorder_columns`, `update_column_width` |
| 282–430 | Row CRUD: `get_rows`, `create_row`, `update_cell` |
| 436–550 | Soft-delete / restore / hard-delete / paste |
| ~555 | `mark_tool_stale(conn, tool_id)` |
| ~565 | `mark_dependents_stale(conn, source_slug)` |
| 570–650 | Template CRUD: `get_templates`, `create_template`, `delete_template` |

## Decisioni

- **Template CRUD usa `conn` (sqlite3)**: post-refactor i template vivono in `_templates` dentro il per-project DB. Non c'è più dipendenza da SQLAlchemy o `registry_db`.
- **`create_tool` non riceve più `registry_db`**: il lookup del template per `template_id` avviene su `_templates` via `conn`.
- **`mark_dependents_stale` è chiamata dopo ogni mutazione riga**: garantisce che i tool dipendenti vengano marcati stale automaticamente.
- **Circular import con `etl.py`**: `from engine.service import mark_dependents_stale` è dentro il body di `etl_run_saved`, non a livello modulo. Non spostare.
- **File a rischio splitting** (vedi RISKS.md R01): non aggiungere nuove sezioni significative senza prima estrarre staleness helpers o template CRUD in file separati.
