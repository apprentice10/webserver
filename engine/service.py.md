---
# engine/service.py

**Descrizione:** Tutta la business logic del Table Engine: tool CRUD, colonne, righe, delete/restore, paste, template ETL. Le route in `engine/routes.py` sono un thin layer che delega qui. Staleness helpers sono in `engine/staleness.py`.

## Indice (~790 righe)

| Righe | Sezione |
|-------|---------|
| 1–25 | Import (`datetime`, `json`, `sqlite3`, utils, staleness) |
| 40–155 | Tool CRUD: `get_tool`, `get_tools_for_project`, `create_tool`, `update_tool_settings` |
| 157–280 | Column CRUD: `get_columns`, `add_column`, `update_column`, `delete_column`, `reorder_columns`, `update_column_width` |
| 282–430 | Row CRUD: `get_rows`, `create_row`, `update_cell` |
| 436–620 | Soft-delete / restore / hard-delete / paste |
| 684–740 | `rollback_cell` |
| 762–807 | Template CRUD: `get_templates`, `create_template`, `delete_template` |

## Decisioni

- **Template CRUD usa `conn` (sqlite3)**: post-refactor i template vivono in `_templates` dentro il per-project DB. Non c'è più dipendenza da SQLAlchemy o `registry_db`.
- **`create_tool` non riceve più `registry_db`**: il lookup del template per `template_id` avviene su `_templates` via `conn`.
- **Staleness helpers estratti** in `engine/staleness.py` (RISKS.md R01 split): `mark_tool_stale` e `mark_dependents_stale` non sono più in questo file.
- **`delete_column` — ETL sync**: se la colonna ha `lineage_info`, rimuove la sua espressione dal SELECT della query ETL salvata (via `sql_parser.remove_col_from_sql`) e aggiorna `query_config` atomicamente nello stesso `conn.commit()`. Ritorna `etl_sql_updated: bool`.
- **`update_column` — ETL rename sync**: se il nome cambia e la colonna ha `lineage_info`, calcola `new_slug = slugify(new_name)`. Se `new_slug != old_slug`: aggiorna l'alias AS nel SQL salvato (via `sql_parser.rename_col_in_sql`), rinomina la colonna nella tabella dati (`ALTER TABLE RENAME COLUMN`), aggiorna `_overrides.col_slug` e `_columns.slug`. Ritorna `etl_sql_updated: bool`.
- **Deferred import in `delete_column` e `update_column`**: `from engine.sql_parser import ...` è dentro il body delle funzioni per evitare import circolari (RISKS.md R06).
- **File a rischio splitting** (vedi RISKS.md R01): le prossime estrazioni candidate sono template CRUD → `engine/templates.py` e delete/restore → `engine/row_ops.py`.
