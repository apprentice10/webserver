# URL Structure e Routing Conventions

## Page Routes

| URL | Template | Descrizione |
|-----|----------|-------------|
| `/` | `index.html` | Homepage shell, project navigation |
| `/tool/{project_id}/{tool_id}` | `engine/table.html` | Grid view del tool |
| `/tool/{project_id}/{tool_id}/etl` | `engine/etl.html` | ETL editor standalone |

## API Routes

| Pattern | Descrizione |
|---------|-------------|
| `/api/projects/` | CRUD progetti (registry DB) |
| `/api/tools/project/{project_id}` | Lista/crea tool per progetto |
| `/api/tools/{tool_id}/*` | Colonne, righe, celle, ETL, SQL |

### Dettaglio `/api/tools/{tool_id}/*`

Tutti richiedono `?project_id=N` per ownership validation.

| Metodo + Path | Descrizione |
|---------------|-------------|
| `GET /api/tools/{tid}?project_id=` | Get tool metadata |
| `PUT /api/tools/{tid}/settings?project_id=` | Update nome/icona/rev |
| `GET /api/tools/{tid}/columns?project_id=` | Lista colonne |
| `POST /api/tools/{tid}/columns?project_id=` | Aggiungi colonna |
| `PUT /api/tools/{tid}/columns/reorder?project_id=` | Riordina colonne (PRIMA di PATCH!) |
| `PATCH /api/tools/{tid}/columns/{col_id}?project_id=` | Update colonna |
| `DELETE /api/tools/{tid}/columns/{col_id}?project_id=` | Elimina colonna |
| `GET /api/tools/{tid}/rows?project_id=` | Lista righe |
| `POST /api/tools/{tid}/rows?project_id=` | Crea riga |
| `PATCH /api/tools/{tid}/rows/{row_id}/cell?project_id=` | Update cella |
| `DELETE /api/tools/{tid}/rows/{row_id}?project_id=` | Soft delete riga |
| `POST /api/tools/{tid}/rows/{row_id}/restore?project_id=` | Restore riga |
| `DELETE /api/tools/{tid}/rows/{row_id}/hard?project_id=` | Hard delete (trash only) |
| `POST /api/tools/{tid}/rows/paste?project_id=` | Paste multi-riga |
| `POST /api/tools/{tid}/sql?project_id=` | Power SQL editor |
| `POST /api/tools/{tid}/etl/preview?project_id=` | Anteprima ETL |
| `POST /api/tools/{tid}/etl/apply?project_id=` | Applica ETL |
| `POST /api/tools/{tid}/etl/run?project_id=` | Run ETL salvato (topologico) |
| `POST /api/tools/{tid}/etl/save?project_id=` | Salva versione ETL |
| `GET /api/tools/{tid}/etl/config?project_id=` | Get config ETL corrente |
| `GET /api/tools/{tid}/etl/schema?project_id=` | Schema browser |
| `GET /api/tools/templates?project_id=&type_slug=` | Lista template ETL |
| `POST /api/tools/templates?project_id=` | Salva template |
| `DELETE /api/tools/templates/{tmpl_id}` | Elimina template |
| `GET /api/tools/flags?project_id=` | Lista flag progetto |
| `POST /api/tools/flags?project_id=` | Crea nuovo flag (non-system) |
| `PATCH /api/tools/flags/{flag_id}?project_id=` | Aggiorna colore (tutti) o nome (non-system) |
| `DELETE /api/tools/flags/{flag_id}?project_id=` | Elimina flag (solo non-system) |

## Convenzione project_id

`get_project_conn` in `engine/project_db.py` legge `project_id` da:
- `request.path_params` (URL come `/project/{project_id}/...`)
- `request.query_params` (URL come `/tools/{tool_id}?project_id=N`)

**Non usare `Query(...)` in firma route** se `project_id` compare anche come path param — pitfall documentato.

## Git Workflow

Commit format: `<type>: <descrizione breve>`
Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`

Non committare: `venv/`, `__pycache__/`, `*.pyc`, `*.db`, `.env`
