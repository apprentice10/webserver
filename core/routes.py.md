---
# core/routes.py

**Descrizione:** Project CRUD — `/api/projects/` list, create, get, delete. Nessun ORM: usa `engine/project_index.py` per l'indice e `engine/project_db.py` per creare/eliminare il file DB.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `_slugify(text)` | Normalizza testo a `[a-z0-9_]` per generare filename sicuri |
| `_make_db_filename(client, name)` | Compone `{client}_{name}.db` con gestione parti vuote |
| `ProjectCreate` | Schema Pydantic input: `name`, `client`, `description` |
| `ProjectResponse` | Schema Pydantic output: `id`, `name`, `client`, `description`, `db_path` |
| `GET /` | `list_projects()` → `project_index.list_projects()` |
| `POST /` | `create_project()` — crea file DB, popola `_project`, registra in index |
| `GET /{project_id}` | `get_project()` → `project_index.get_project()` |
| `DELETE /{project_id}` | `delete_project()` — rimuove da index + cancella file DB |

## Decisioni

- **Nessun SQLAlchemy**: post-refactor, rimossi `from database import get_db`, `from core.models import Project`, `db: Session = Depends(get_db)` da tutte le route.
- **Collision detection filename**: se `{client}_{name}.db` esiste già su disco, aggiunge `_2`, `_3`, ecc. — garantisce unicità senza fallire.
- **`_project` popolata al momento della creazione**: `INSERT` in `_project` con `id=NULL` lascia SQLite assegnare l'ID automaticamente (sempre 1 in ogni DB di progetto — l'ID univoco è in `projects.db`).
- **Delete è distruttivo e immediato**: elimina dalla index + `unlink()` del file. Nessun cestino per i progetti.
