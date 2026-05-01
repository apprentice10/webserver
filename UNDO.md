# UNDO.md — Rollback of Architectural Refactor

This file describes how to undo the refactor completed on 2026-04-26 and return to the previous stable version.

---

## What the refactor changed

| Category           | Before                                   | After                                                                                             |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Project registry   | `data/registry.db` (SQLAlchemy ORM)      | `data/projects.db` (sqlite3 raw)                                                                  |
| Project model      | `core/models.py::Project` (ORM)          | `engine/project_index.py` (raw)                                                                   |
| ETL templates      | `data/registry.db::tool_templates` (ORM) | `_templates` inside each project DB                                                               |
| Tool types catalog | Static list in `engine/catalog.py`       | Dynamic scanner `tools/*/tool.json`                                                               |
| Deleted files      | —                                        | `database.py`, `core/models.py`, `core/audit.py`, `engine/models.py`                              |
| New files          | —                                        | `engine/project_index.py`, `tools/instrument_list/tool.json`, `tools/instrument_list/__init__.py` |

---

## Rollback via Git (recommended method)

The tag `v-pre-refactor` points to the stable version before the refactor.

```bash
# Verify that the tag exists
git tag | grep v-pre-refactor

# Option A — temporary checkout (non-destructive)
git checkout v-pre-refactor
# Work, test, then go back to main:
git checkout main

# Option B — hard reset to v-pre-refactor (DESTRUCTIVE — you lose all post-tag work)
git reset --hard v-pre-refactor
git push --force origin main   # only if necessary to update the remote
```

**Warning:** after the rollback the server will use `data/registry.db` again. If you created projects after the refactor, their `.db` files are compatible but will not be in the SQLAlchemy index. You will need to re-insert them manually or delete them.

---

## Manual rollback (if Git is not available)

### 1. Restore deleted files

Recover the deleted files from git:

```bash
git show v-pre-refactor:database.py > database.py
git show v-pre-refactor:core/models.py > core/models.py
git show v-pre-refactor:core/audit.py > core/audit.py
git show v-pre-refactor:engine/models.py > engine/models.py
```

### 2. Restore modified files

```bash
git show v-pre-refactor:engine/catalog.py > engine/catalog.py
git show v-pre-refactor:engine/project_db.py > engine/project_db.py
git show v-pre-refactor:engine/service.py > engine/service.py
git show v-pre-refactor:engine/routes.py > engine/routes.py
git show v-pre-refactor:core/routes.py > core/routes.py
git show v-pre-refactor:main.py > main.py
```

### 3. Delete new files

```bash
del engine\project_index.py
del tools\instrument_list\tool.json
del tools\instrument_list\__init__.py
rmdir /s /q tools\instrument_list   # if you want to remove the folder
```

### 4. Recreate the registry DB

```bash
venv\Scripts\activate
alembic upgrade head
```

### 5. Start the server and verify

```bash
uvicorn main:app --reload
# GET http://127.0.0.1:8000/api/projects/ must respond with the project list
```

---

## Notes on data

* Per-project `.db` files (in `data/`) are **compatible** with both versions: the `_project` and `_templates` tables added by the refactor are additive and do not interfere with the old schema.
* `data/projects.db` (created by the refactor) can be ignored in the pre-refactor version — the server will only use `data/registry.db`.
* ETL templates created post-refactor (in `_templates`) will not be visible after the rollback (they were in `_templates` inside the project DB, not in `registry.db::tool_templates`).

---
