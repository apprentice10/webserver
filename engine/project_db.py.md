---
# engine/project_db.py

**Descrizione:** Gestisce il ciclo di vita dei per-project DB: DDL di sistema, migrazione schema, dipendenza FastAPI `get_project_conn`, audit log.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `DATA_DIR` | `Path` → `data/` nella root del progetto |
| `BACKUPS_DIR` | `Path` → `data/backups/` — pre-migration safety copies |
| `SCHEMA_VERSION` | Current schema version integer — bump this when DDL changes (see rule below) |
| `SYSTEM_COLUMN_DEFS` | Lista colonne sistema obbligatorie (tag, rev, log) — contratto architetturale |
| `DDL_SYSTEM_TABLES` | SQL per creare `_project`, `_templates`, `_tools`, `_columns`, `_trash`, `_overrides`, `_audit`, `_flags`, `_cell_flags` |
| `create_project_db(path)` | Crea un nuovo per-project DB con lo schema completo, stampato a `SCHEMA_VERSION` |
| `open_project_db(path)` | Apre DB, legge `PRAGMA user_version`, esegue migrazioni se necessario, setta `conn._newer_than_server` |
| `_backup_pre_migration(db_path, from_version)` | Copia safety in `BACKUPS_DIR` prima di migrare; idempotente (salta se esiste già) |
| `_migrate_to_v1(conn)` | Migrazione formale v0→v1: assorbe tutti i check ad-hoc precedenti |
| `_run_migrations(conn, db_path)` | Runner versionato: esegue ogni step in una transazione, fa backup prima |
| `get_project_conn(request)` | Dependency FastAPI: apre connessione, restituisce 403 su richieste non-GET se DB è più nuovo del server |
| `audit(conn, tool_slug, row_tag, col_slug, old, new, rev)` | Inserisce riga in `_audit` |

## Decisioni

- **Schema version bump rule (MANDATORY):** Before committing any change to `DDL_SYSTEM_TABLES` or any system table structure, you MUST: (1) add a new `_migrate_to_vN` function, (2) register it in `_MIGRATIONS`, (3) increment `SCHEMA_VERSION`. Triggers: adding/dropping a column on a system table, adding a new system table, changing a constraint or index. Not triggers: tool table changes, business logic, API changes.

- **`SYSTEM_COLUMN_DEFS` non si sposta nei plugin**: ETL merge richiede `tag` come chiave; `SYSTEM_SLUGS` in `etl.py` dipende da questi nomi. Sono un contratto engine universale.
- **`_migrate_project_db` è sempre non-distruttiva**: usa `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ADD COLUMN IF NOT EXISTS`. Mai DROP, mai riscrittura dati.
- **`get_project_conn` non usa `Query(...)`** per `project_id`: legge da `request.path_params` o `request.query_params` direttamente per evitare conflitti con route che hanno `project_id` sia come path param che come query param.
- **Post-refactor**: rimossa dipendenza da SQLAlchemy. `get_project_conn` ora usa `engine.project_index.get_db_path` invece di `core.models.Project` via ORM.
- **`_flags` / `_cell_flags`**: sistema flag (Group E). `_flags` registra flag disponibili con nome, colore, `is_system`. `_cell_flags` associa flag a (tool_slug, row_tag, col_slug) — `col_slug=''` per flag a livello riga. System flags "manual_edit" e "ETL: Eliminated" sono seedati in `_migrate_project_db` con `INSERT OR IGNORE` (idempotente).
- **col_slug='' per flag riga**: invece di NULL nel PK (che SQLite non garantisce unique), si usa stringa vuota come sentinel per flag applicati a una riga intera.
