---
# engine/project_index.py

**Descrizione:** Gestisce `data/projects.db` — indice leggero che mappa `project_id → db_path`. Nessun ORM, nessuna logica business: solo discovery dei progetti. Sostituisce `data/registry.db` (SQLAlchemy).

## Indice

| Funzione | Descrizione |
|---------|-------------|
| `_connect()` | Apre `data/projects.db`, crea la tabella se non esiste (idempotente via `CREATE TABLE IF NOT EXISTS`) |
| `init_index()` | Chiamata da `main.py` all'avvio — garantisce che il DB esista |
| `add_project(name, client, db_path)` | INSERT, restituisce `id` generato |
| `remove_project(project_id)` | DELETE silenzioso |
| `list_projects()` | SELECT ordinato per `id` |
| `get_project(project_id)` | SELECT singolo, raise `HTTPException 404` se non trovato |
| `get_db_path(project_id)` | Restituisce `Path` al file DB del progetto |

## Schema tabella

```sql
CREATE TABLE IF NOT EXISTS projects (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    client  TEXT NOT NULL DEFAULT '',
    db_path TEXT NOT NULL UNIQUE
);
```

## Decisioni

- **`_connect()` è idempotente**: esegue il DDL (`CREATE TABLE IF NOT EXISTS`) ad ogni connessione. Sicuro se chiamata più volte, non richiede migrazione.
- **`check_same_thread=False`**: ogni request apre e chiude la propria connessione — sicuro perché non si condivide la connessione tra thread.
- **`PRAGMA journal_mode=WAL`**: riduce la contesa in caso di letture concorrenti mentre una scrittura è in corso.
- **Questo file NON contiene metadati progetto** (`name`, `client`, `description` nel senso completo): quelli vivono in `_project` dentro il per-project DB. Qui solo l'indice per la discovery.
