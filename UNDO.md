# UNDO.md — Rollback del Refactor Architetturale

Questo file descrive come annullare il refactor completato il 2026-04-26 e tornare alla versione stabile precedente.

---

## Cosa ha cambiato il refactor

| Categoria | Prima | Dopo |
|-----------|-------|------|
| Registry progetti | `data/registry.db` (SQLAlchemy ORM) | `data/projects.db` (sqlite3 raw) |
| Modello progetto | `core/models.py::Project` (ORM) | `engine/project_index.py` (raw) |
| Template ETL | `data/registry.db::tool_templates` (ORM) | `_templates` dentro ogni project DB |
| Catalog tool types | Lista statica in `engine/catalog.py` | Scanner dinamico `tools/*/tool.json` |
| File eliminati | — | `database.py`, `core/models.py`, `core/audit.py`, `engine/models.py` |
| File nuovi | — | `engine/project_index.py`, `tools/instrument_list/tool.json`, `tools/instrument_list/__init__.py` |

---

## Rollback via Git (metodo raccomandato)

Il tag `v-pre-refactor` punta alla versione stabile precedente al refactor.

```bash
# Verifica che il tag esista
git tag | grep v-pre-refactor

# Opzione A — checkout temporaneo (non distruttivo)
git checkout v-pre-refactor
# Lavora, testa, poi torna a main:
git checkout main

# Opzione B — reset hard a v-pre-refactor (DISTRUTTIVO — perdi tutto il lavoro post-tag)
git reset --hard v-pre-refactor
git push --force origin main   # solo se necessario aggiornare il remote
```

**Attenzione:** dopo il rollback il server userà di nuovo `data/registry.db`. Se hai creato progetti dopo il refactor, i loro file `.db` sono compatibili ma non saranno nell'indice SQLAlchemy. Dovrai re-inserirli manualmente o cancellarli.

---

## Rollback manuale (se Git non è disponibile)

### 1. Ripristina i file eliminati

Recupera da git i file eliminati:

```bash
git show v-pre-refactor:database.py > database.py
git show v-pre-refactor:core/models.py > core/models.py
git show v-pre-refactor:core/audit.py > core/audit.py
git show v-pre-refactor:engine/models.py > engine/models.py
```

### 2. Ripristina i file modificati

```bash
git show v-pre-refactor:engine/catalog.py > engine/catalog.py
git show v-pre-refactor:engine/project_db.py > engine/project_db.py
git show v-pre-refactor:engine/service.py > engine/service.py
git show v-pre-refactor:engine/routes.py > engine/routes.py
git show v-pre-refactor:core/routes.py > core/routes.py
git show v-pre-refactor:main.py > main.py
```

### 3. Elimina i file nuovi

```bash
del engine\project_index.py
del tools\instrument_list\tool.json
del tools\instrument_list\__init__.py
rmdir /s /q tools\instrument_list   # se vuoi rimuovere la cartella
```

### 4. Ricrea il registry DB

```bash
venv\Scripts\activate
alembic upgrade head
```

### 5. Avvia il server e verifica

```bash
uvicorn main:app --reload
# GET http://127.0.0.1:8000/api/projects/ deve rispondere con lista progetti
```

---

## Nota sui dati

- I file per-project `.db` (in `data/`) sono **compatibili** con entrambe le versioni: le tabelle `_project` e `_templates` aggiunte dal refactor sono additive e non interferiscono con il vecchio schema.
- `data/projects.db` (creato dal refactor) può essere ignorato nella versione pre-refactor — il server userà solo `data/registry.db`.
- I template ETL creati post-refactor (in `_templates`) non saranno visibili dopo il rollback (erano in `_templates` inside project DB, non in `registry.db::tool_templates`).
