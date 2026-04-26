---
# engine/project_db.py

**Descrizione:** Gestisce il ciclo di vita dei per-project DB: DDL di sistema, migrazione schema, dipendenza FastAPI `get_project_conn`, audit log.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `DATA_DIR` | `Path` → `data/` nella root del progetto |
| `SYSTEM_COLUMN_DEFS` | Lista colonne sistema obbligatorie (tag, rev, log) — contratto architetturale |
| `DDL_SYSTEM_TABLES` | SQL per creare `_project`, `_templates`, `_tools`, `_columns`, `_trash`, `_overrides`, `_audit` |
| `create_project_db(path)` | Crea un nuovo per-project DB con lo schema completo |
| `open_project_db(path)` | Apre DB esistente + chiama `_migrate_project_db` per aggiornare schema |
| `_migrate_project_db(conn)` | Migrazione non-distruttiva: aggiunge colonne/tabelle mancanti, non tocca dati |
| `get_project_conn(request)` | Dependency FastAPI: legge `project_id` da path o query params, apre connessione, chiude a fine request |
| `audit(conn, tool_slug, row_tag, col_slug, old, new, rev)` | Inserisce riga in `_audit` |

## Decisioni

- **`SYSTEM_COLUMN_DEFS` non si sposta nei plugin**: ETL merge richiede `tag` come chiave; `SYSTEM_SLUGS` in `etl.py` dipende da questi nomi. Sono un contratto engine universale.
- **`_migrate_project_db` è sempre non-distruttiva**: usa `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Mai DROP, mai riscrittura dati.
- **`get_project_conn` non usa `Query(...)`** per `project_id`: legge da `request.path_params` o `request.query_params` direttamente per evitare conflitti con route che hanno `project_id` sia come path param che come query param.
- **Post-refactor**: rimossa dipendenza da SQLAlchemy. `get_project_conn` ora usa `engine.project_index.get_db_path` invece di `core.models.Project` via ORM.
