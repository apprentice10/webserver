# PLAN — Group Q: Revision System

*Created: 2026-05-14 | Status: Planning — Q0 next*

---

## Goal

Add a project-wide revision system (integer counter, auto-incrementing from 0). Only the latest revision is editable; older revisions are read-only snapshots. Users can create, view, and delete revisions, or destructively revert to an older one. Snapshots store full row + column data per tool. The chip-rev button in the toolbar is the entry point.

---

## Steps

- [ ] Q0 — Schema + Migration
- [ ] Q1 — Backend: Revision CRUD Endpoints
- [ ] Q2 — Backend: Auto-update REV on Mutations
- [ ] Q3 — Backend: Snapshot Read Endpoint
- [ ] Q4 — Frontend: chip-rev Button + Picker
- [ ] Q5 — Frontend: Read-only Mode + Revert Flow

---

## Decisions

| # | Decision |
|---|----------|
| Q-D1 | REV system column changes from TEXT to INTEGER. Auto-managed — never editable by the user. Stores the revision number when that row was last modified. |
| Q-D2 | Snapshots are full copies (rows + column definitions) stored as JSON in the DB. Taken when moving away from a revision. |
| Q-D3 | Viewing an old revision = full app switch (all tools switch at once). No side-by-side comparison. |
| Q-D4 | Creating a new revision is always an explicit user action. No auto-create on first edit. |
| Q-D5 | Each revision record stores: `number` (auto-int), `created_at` (auto timestamp), `description` (optional), `author` (optional). |
| Q-D6 | Snapshot includes both row data and column definitions (structure + data, exact state). |
| Q-D7 | REV on a row = revision number of the last time any cell in that row was modified (including ETL changes). |
| Q-D8 | **Delete revision**: number disappears but data + history preserved — merged into previous revision. REV values + audit entries retagged. |
| Q-D9 | **Revert to revision**: destructive. Creates permanent safety backup (`{stem}_discarded_rev{N}_{YYYYMMDD_HHMMSS}.db`, never auto-deleted), then wipes latest revision and restores live tables from target snapshot. |
| Q-D10 | ETL button is disabled when viewing an old revision. No preview against old data. |
| Q-D11 | Audit history is scoped per revision. Viewing revision 2 shows only changes made during revision 2. |
| Q-D12 | Read-only mode: amber banner ("Viewing revision N — read only" + "Back to current") + subtle grey overlay on the grid. |
| Q-D13 | chip-rev picker: compact popover listing all revisions. "Create new revision…" at top. "Revert" button only in the read-only banner — not in the picker. |
| Q-D14 | New projects start at **revision 0** ("First issue"), auto-created. No user action needed. |

### New DB Tables

```sql
CREATE TABLE _revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      INTEGER NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    description TEXT,
    author      TEXT
);

CREATE TABLE _revision_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id  INTEGER NOT NULL REFERENCES _revisions(id),
    tool_slug    TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    rows_json    TEXT NOT NULL
);
```

---

## Risks

- **Migration failure on REV column type change**: wrap in `_run_migrations` transaction; check `PRAGMA table_info` before altering to avoid re-running on already-migrated tables.
- **Snapshot integrity on revert**: truncate + re-insert for all tool tables must succeed atomically. Wrap entire revert operation in a single transaction; roll back on any error.
- **Backup naming collision on revert**: `{stem}_discarded_rev{N}_{YYYYMMDD_HHMMSS}.db` — verify file does not already exist before writing.
- **ETL graph mismatch in old snapshots**: an old snapshot may reference tools that no longer exist. Mitigation: ETL fully disabled in read-only mode (Q-D10).
- **Dynamic DDL (R07)**: any new DDL using slugs must pass through `slugify()`. Never use raw user input as a table/column name.

---

## Step Q0 — Schema + Migration

**Goal:** Add revision tables, change REV column type, wire up migration.

1. In `engine/project_db.py`:
   - Add `_revisions` + `_revision_snapshots` to `DDL_SYSTEM_TABLES`.
   - Change `SYSTEM_COLUMN_DEFS` entry for `rev`: `col_type` → `"integer"`, `default` → `0`.
   - Change inline DDL in `_create_tool_table()`: `rev INTEGER DEFAULT 0`.
   - Bump `SCHEMA_VERSION` by 1.

2. In `_run_migrations()`, add new step:
   - `CREATE TABLE IF NOT EXISTS _revisions (...)`.
   - `CREATE TABLE IF NOT EXISTS _revision_snapshots (...)`.
   - `INSERT INTO _revisions ... VALUES (0, <now>, 'First issue', '')` only if `_revisions` is empty.
   - For each tool: `ALTER TABLE {slug} ADD COLUMN rev INTEGER DEFAULT 0` if column is currently TEXT (check `PRAGMA table_info`). Then `UPDATE {slug} SET rev = 0`.
   - `UPDATE _audit SET revision = '0' WHERE revision IS NULL OR revision = ''`.

3. Update `engine/project_db.py.md`.

**Verify:** Open existing project → no crash → `_revisions` has one row (rev 0) → `_revision_snapshots` is empty.

**Write-back:** mark Q0 done above + append to `session/DONE/project.md` + update `engine/project_db.py.md`.

---

## Step Q1 — Backend: Revision CRUD Endpoints

**Goal:** All server-side logic for creating, listing, deleting, and reverting revisions.

**New file:** `engine/routes_revisions.py`

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/project/revisions?db=...` | List all revisions |
| `POST` | `/api/project/revision?db=...` | Create new revision |
| `DELETE` | `/api/project/revision/{number}?db=...` | Delete latest (merge into previous) |
| `POST` | `/api/project/revision/{number}/revert?db=...` | Revert live data to snapshot |

**Create:** read latest N → snapshot all tools → insert new revision N+1.

**Delete:** assert `number` is latest → find P=N-1 → update `rev` + `_audit` rows → delete snapshots + revision row.

**Revert:** assert `number` is NOT latest → safety backup → truncate + re-insert each tool from snapshot → delete all revisions + snapshots where `number > target`.

Register router in `main.py`. Create `engine/routes_revisions.py.md`.

**Write-back:** mark Q1 done + `session/DONE/project.md` + `infra/URL_STRUCTURE.md`.

---

## Step Q2 — Backend: Auto-update REV on Mutations

**Goal:** REV column on each row automatically tracks which revision last touched it.

1. `update_cell`, `create_row`, `restore_row`: set `rev = SELECT MAX(number) FROM _revisions` after mutation.
2. `etl_apply`: set `rev = current_revision_number` on every actually-modified row.
3. `audit()` in `project_db.py`: change `revision` param from `str` to `int`. Update all callers.

**Verify:** edit cell on rev 0 → `rev = 0`. Create rev 1 (Q1 done) → edit → `rev = 1`.

**Write-back:** mark Q2 done + `session/DONE/project.md` + companion .md files for changed modules.

---

## Step Q3 — Backend: Snapshot Read Endpoint

**Goal:** Serve frozen snapshot data when frontend switches to an old revision.

Add to `engine/routes_revisions.py`:

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/project/revision/{number}/tool/{tool_slug}?db=...` | Return columns + rows from snapshot |

Returns `{ columns: [...], rows: [...] }` — same shape as live endpoints. Also add current revision number to `GET /api/project/revisions`.

**Write-back:** mark Q3 done + `session/DONE/project.md`.

---

## Step Q4 — Frontend: chip-rev Button + Picker

**Goal:** Toolbar button showing current revision; popover to switch or create revisions.

**New file:** `static/engine/js/revision-picker/revision-picker.js` (+ `.md` companion)

1. **chip-rev button**: shows `Rev N`, highlighted when on latest.
2. **Picker popover**: lists all revisions (number, date, author, description); "＋ Create new revision…" at top → inline dialog.
3. **Create dialog**: Description + Author fields; "Create revision N+1"; on confirm: `POST /api/project/revision`.
4. **ApiClient additions**: `getRevisions(db)`, `createRevision(db, description, author)`, `deleteRevision(db, number)`.

**Write-back:** mark Q4 done + `session/DONE/project.md` + `grid/FRONTEND_PATTERNS.md`.

---

## Step Q5 — Frontend: Read-only Mode + Revert Flow

**Goal:** Full read-only experience when viewing an old revision, plus the revert flow.

1. **View-switch**: on selecting old revision, call snapshot endpoint → replace grid data → set `viewingRevision` flag.
2. **Read-only banner** (`table.html` + CSS): amber bar — "Viewing revision N — read only" + "Back to current" + "Revert to revision N" (red, confirmation dialog). On confirm: `POST /api/project/revision/{N}/revert` → reload.
3. **Grid enforcement**: `_onCellBlur` no-ops; row add/delete disabled; context menu edit actions disabled; `data-readonly` on `#data-grid` → CSS grey overlay.
4. **Disable ETL**: ETL run button disabled when `viewingRevision` is set.
5. **History scoping**: pass `?revision={N}` to audit endpoint; `GET /api/tools/{id}/history` filters by `revision`.

**Write-back:** mark Q5 done + `session/DONE/project.md` + `static/engine/js/api.js.md` + `infra/GLOSSARY.md` (add Revision, Snapshot, viewingRevision terms).
