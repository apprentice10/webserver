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
| `/api/engines/project/{project_id}` | Lista/crea tool per progetto |
| `/api/engines/{tool_id}/*` | Colonne, righe, celle, ETL, SQL |

### Dettaglio `/api/engines/{tool_id}/*`

Tutti richiedono `?project_id=N` per ownership validation.

| Metodo + Path | Descrizione |
|---------------|-------------|
| `GET /api/engines/{tid}?project_id=` | Get tool metadata |
| `PUT /api/engines/{tid}/settings?project_id=` | Update nome/icona/rev |
| `GET /api/engines/{tid}/columns?project_id=` | Lista colonne |
| `POST /api/engines/{tid}/columns?project_id=` | Aggiungi colonna |
| `PUT /api/engines/{tid}/columns/reorder?project_id=` | Riordina colonne (PRIMA di PATCH!) |
| `PATCH /api/engines/{tid}/columns/{col_id}?project_id=` | Update colonna |
| `DELETE /api/engines/{tid}/columns/{col_id}?project_id=` | Elimina colonna |
| `GET /api/engines/{tid}/rows?project_id=` | Lista righe |
| `POST /api/engines/{tid}/rows?project_id=` | Crea riga |
| `PATCH /api/engines/{tid}/rows/{row_id}/cell?project_id=` | Update cella |
| `DELETE /api/engines/{tid}/rows/{row_id}?project_id=` | Soft delete riga |
| `POST /api/engines/{tid}/rows/{row_id}/restore?project_id=` | Restore riga |
| `DELETE /api/engines/{tid}/rows/{row_id}/hard?project_id=` | Hard delete (trash only) |
| `POST /api/engines/{tid}/rows/paste?project_id=` | Paste multi-riga |
| `POST /api/engines/{tid}/sql?project_id=` | Power SQL editor |
| `POST /api/engines/{tid}/etl/preview?project_id=` | Anteprima ETL |
| `POST /api/engines/{tid}/etl/apply?project_id=` | Applica ETL |
| `POST /api/engines/{tid}/etl/run?project_id=` | Run ETL salvato (topologico) |
| `POST /api/engines/{tid}/etl/save?project_id=` | Salva versione ETL |
| `GET /api/engines/{tid}/etl/config?project_id=` | Get config ETL corrente |
| `GET /api/engines/{tid}/etl/schema?project_id=` | Schema browser |
| `GET /api/engines/templates?project_id=&type_slug=` | Lista template ETL |
| `POST /api/engines/templates?project_id=` | Salva template |
| `DELETE /api/engines/templates/{tmpl_id}` | Elimina template |
| `GET /api/engines/flags?project_id=` | Lista flag progetto |
| `POST /api/engines/flags?project_id=` | Crea nuovo flag (non-system) |
| `PATCH /api/engines/flags/{flag_id}?project_id=` | Aggiorna colore (tutti) o nome (non-system) |
| `DELETE /api/engines/flags/{flag_id}?project_id=` | Elimina flag (solo non-system) |

### Revision endpoints (`/api/project/…?db=…`)

| Metodo + Path | Descrizione |
|---------------|-------------|
| `GET /api/project/revisions?db=` | Lista tutte le revisioni + current number |
| `POST /api/project/revision?db=` | Crea nuova revisione (snapshot stato corrente → inserisce N+1) |
| `DELETE /api/project/revision/{number}?db=` | Elimina revisione più recente (merge in precedente) |
| `POST /api/project/revision/{number}/revert?db=` | Ripristina dati live da snapshot (operazione distruttiva, crea backup) |
| `GET /api/project/revision/{number}/tool/{tool_slug}?db=` | Legge snapshot frozen: `{ columns, rows }` — stesso shape degli endpoint live |

## Convenzione project_id

`get_project_conn` in `engine/project_db.py` legge `project_id` da:
- `request.path_params` (URL come `/project/{project_id}/...`)
- `request.query_params` (URL come `/tools/{tool_id}?project_id=N`)

**Non usare `Query(...)` in firma route** se `project_id` compare anche come path param — pitfall documentato.

## Git Workflow

Commit format: `<type>: <descrizione breve>`
Types: `feat`, `fix`, `refactor`, `style`, `docs`, `chore`

Non committare: `venv/`, `__pycache__/`, `*.pyc`, `*.db`, `.env`
