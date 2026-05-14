# PLAN — Group Q: Revision System

*Created: 2026-05-14 | Status: Planning*

Each step below is designed to start from a fresh session. Read this file at the beginning of each step.

---

## Decisions Made (grilling session 2026-05-14)

| # | Decision |
|---|----------|
| Q-D1 | REV system column changes from TEXT to INTEGER. Auto-managed by the system — never editable by the user. Stores the revision number when that row was last modified. |
| Q-D2 | Snapshots are full copies (rows + column definitions) stored as JSON in the DB. Taken when moving away from a revision. |
| Q-D3 | Viewing an old revision = full app switch (all tools switch at once). No side-by-side comparison. |
| Q-D4 | Creating a new revision is always an explicit user action. No auto-create on first edit. |
| Q-D5 | Each revision record stores: `number` (auto-int), `created_at` (auto timestamp), `description` (user text, optional), `author` (user types their name, optional — auth later). |
| Q-D6 | Snapshot includes both row data and column definitions (structure + data, exact state). |
| Q-D7 | REV on a row = revision number of the last time any cell in that row was modified (including ETL changes). |
| Q-D8 | **Delete revision**: the revision number disappears but all data and history are preserved — merged into the previous revision. REV values pointing to the deleted revision are updated to the previous revision number. Audit entries are retagged. |
| Q-D9 | **Revert to revision**: destructive. Creates a permanent safety backup (`{stem}_discarded_rev{N}_{YYYYMMDD_HHMMSS}.db`, never auto-deleted), then wipes the latest revision completely and restores the live tables from the target snapshot. Page returns to editable mode. |
| Q-D10 | ETL button is disabled when viewing an old revision. No preview against old data. |
| Q-D11 | Audit history is scoped per revision. Viewing revision 2 shows only changes made during revision 2. |
| Q-D12 | Read-only mode: amber banner ("Viewing revision N — read only" + "Back to current") + subtle grey overlay on the grid. |
| Q-D13 | chip-rev picker: compact popover listing all revisions (number, date, author, description). "Create new revision…" at the top opens a dialog. "Revert to this revision" button appears only inside the read-only banner, not in the picker — forcing the user to first navigate to the revision and see what they are reverting to. |
| Q-D14 | New projects start at **revision 0** ("First issue"), created automatically. No user action needed. |

---

## New DB Tables

```sql
-- Master revision registry
CREATE TABLE _revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      INTEGER NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    description TEXT,
    author      TEXT
);

-- Frozen snapshots: one row per (revision, tool)
-- columns_json: serialized list of _columns rows
-- rows_json:    serialized list of all data rows (same shape as API response)
CREATE TABLE _revision_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id  INTEGER NOT NULL REFERENCES _revisions(id),
    tool_slug    TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    rows_json    TEXT NOT NULL
);
```

---

## Step Q0 — Schema + Migration

**Goal:** Add revision tables, change REV column type, wire up migration.

**What to do:**

1. In `engine/project_db.py`:
   - Add `_revisions` and `_revision_snapshots` to `DDL_SYSTEM_TABLES`.
   - Change `SYSTEM_COLUMN_DEFS` entry for `rev`: `col_type` → `"integer"`, `default` → `0`.
   - Change the inline DDL for `rev` in `_create_tool_table()`: `rev INTEGER DEFAULT 0`.
   - Bump `SCHEMA_VERSION` by 1.

2. In `_run_migrations()`, add a new migration step:
   - `INSERT INTO _revisions (number, created_at, description, author) VALUES (0, <now>, 'First issue', '')` (only if `_revisions` is empty).
   - `CREATE TABLE IF NOT EXISTS _revisions (...)`.
   - `CREATE TABLE IF NOT EXISTS _revision_snapshots (...)`.
   - For each tool: `ALTER TABLE {slug} ADD COLUMN rev INTEGER DEFAULT 0` only if column is currently TEXT (check `PRAGMA table_info`). Then `UPDATE {slug} SET rev = 0`.
   - `UPDATE _audit SET revision = '0' WHERE revision IS NULL OR revision = ''` (keep as TEXT in `_audit` for now — convert properly in Q2).

3. Update `engine/project_db.py.md` index to reflect new tables and SCHEMA_VERSION bump.

**Verify:** Open an existing project, confirm no crash, `_revisions` has one row (rev 0), `_revision_snapshots` is empty.

---

## Step Q1 — Backend: Revision CRUD Endpoints

**Goal:** All server-side logic for creating, listing, deleting, and reverting revisions.

**New file:** `engine/routes_revisions.py`

**Endpoints:**

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/project/revisions?db=...` | List all revisions (id, number, created_at, description, author) |
| `POST` | `/api/project/revision?db=...` | Create new revision — see logic below |
| `DELETE` | `/api/project/revision/{number}?db=...` | Delete latest revision (merge into previous) |
| `POST` | `/api/project/revision/{number}/revert?db=...` | Revert live data to this revision snapshot |

**Create new revision logic:**
1. Read current latest revision number N from `_revisions`.
2. For each tool in `_tools`: serialize current `_columns` rows → `columns_json`, serialize all rows from the tool table → `rows_json`. Insert into `_revision_snapshots` (revision_id = id of revision N).
3. Insert into `_revisions`: `number = N+1`, `created_at = now()`, `description`, `author` from request body.
4. Return the new revision record.

**Delete latest revision logic (merge, no data loss):**
1. Assert `number` is the current latest.
2. Find the previous revision P = N-1.
3. For each tool: `UPDATE {slug} SET rev = P WHERE rev = N`.
4. `UPDATE _audit SET revision = P WHERE revision = N` (cast as needed).
5. Delete `_revision_snapshots` WHERE `revision_id` = id of revision N.
6. Delete from `_revisions` WHERE `number = N`.

**Revert to revision logic:**
1. Assert `number` is NOT the latest (you can only revert to an older one).
2. Find the current latest revision N.
3. Create safety backup: copy the `.db` file to `data/backups/{stem}_discarded_rev{N}_{YYYYMMDD_HHMMSS}.db`. Mark it with a flag so auto-cleanup skips it (e.g. filename prefix or a `_backup_protected` table row).
4. For each tool: load `rows_json` and `columns_json` from `_revision_snapshots` for the target revision. Truncate the live tool table. Re-insert all rows. Restore `_columns` to match the frozen column list.
5. Delete all `_revisions` and `_revision_snapshots` rows where `number > target`.
6. Return success.

**Register** the router in `main.py`.

**Create** `engine/routes_revisions.py.md`.

---

## Step Q2 — Backend: Auto-update REV on Mutations

**Goal:** REV column on each row automatically tracks which revision last touched it.

**What to do:**

1. In `engine/service.py` (or `service_row_ops.py`):
   - In `update_cell`: after the `UPDATE` statement, also set `rev = current_revision_number` on that row. Read the current revision number once at the start of the function from `SELECT MAX(number) FROM _revisions`.
   - In `create_row`: set `rev = current_revision_number` on insert.
   - In `restore_row` (trash restore): set `rev = current_revision_number`.

2. In `engine/etl.py`:
   - In `etl_apply`: after updating each row's cells, also set `rev = current_revision_number` on any row that was actually modified.

3. In `engine/project_db.py` → `audit()`:
   - Change `revision` parameter type from `str` to `int`. Update all callers.
   - Store `revision` as integer in `_audit`.

4. Update companion `.md` files for any changed modules.

**Verify:** Edit a cell on revision 0. Confirm `rev` on that row becomes 0. Create revision 1 (Step Q1 must be done). Edit another cell. Confirm `rev` becomes 1.

---

## Step Q3 — Backend: Snapshot Read Endpoint

**Goal:** Endpoint to serve frozen snapshot data to the frontend when viewing an old revision.

**Add to `engine/routes_revisions.py`:**

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/project/revision/{number}/tool/{tool_slug}?db=...` | Return columns + rows from snapshot |

**Logic:**
1. Look up `_revision_snapshots` by `revision_id` + `tool_slug`.
2. Parse `columns_json` and `rows_json`.
3. Return `{ columns: [...], rows: [...] }` — same shape as the live endpoints so the frontend grid can render without special-casing.

Also add to `GET /api/project/revisions` the current revision number (max number in `_revisions`) so the frontend knows which is latest.

---

## Step Q4 — Frontend: chip-rev Button + Picker

**Goal:** Toolbar button showing current revision; popover to switch or create revisions.

**New file:** `static/engine/js/revision-picker/revision-picker.js`

**What to build:**

1. **chip-rev button** in the toolbar (after the existing chips). Shows `Rev N` when on latest, highlighted. Shows `Rev N ⚠` or similar accent when on an old revision (shouldn't happen since navigation switches the app, but guard anyway).

2. **Picker popover** (inline, no page navigation):
   - Header: "Revisions"
   - List: each revision as a row — `Rev N | date | author | description`. Current revision highlighted.
   - Clicking a row switches to that revision (calls the view-switch logic, see Step Q5).
   - Top action: "＋ Create new revision…" → opens inline dialog.

3. **Create revision dialog**:
   - Fields: Description (text input), Author (text input).
   - Button: "Create revision N+1".
   - On confirm: `POST /api/project/revision`, then reload toolbar chip and refresh picker.

4. Wire `ApiClient` (`api.js`) with new methods:
   - `getRevisions(db)`
   - `createRevision(db, description, author)`
   - `deleteRevision(db, number)`

**Create** `static/engine/js/revision-picker/revision-picker.js.md`.

---

## Step Q5 — Frontend: Read-only Mode + Revert Flow

**Goal:** Full read-only experience when viewing an old revision, plus the revert flow.

**What to build:**

1. **Revision view-switch** (`revision-picker.js` or a new `revision-view.js`):
   - On selecting an old revision: call `GET /api/project/revision/{N}/tool/{slug}` to load snapshot rows + columns.
   - Replace the grid's data with snapshot data.
   - Set a module-level `viewingRevision` flag (number or `null` for live).

2. **Read-only banner** (`templates/engine/table.html` + new CSS):
   - Amber bar at top: "Viewing revision N — {description} — read only".
   - "Back to current (Rev M)" button → calls view-switch back to live data.
   - "Revert to revision N" button (red/destructive, clearly separated):
     - Shows a confirmation dialog: "This will permanently discard all changes made in revisions {N+1…M}. A backup will be created first. This cannot be undone."
     - On confirm: `POST /api/project/revision/{N}/revert`.
     - On success: reload the page in normal (editable) mode.

3. **Grid read-only enforcement**:
   - When `viewingRevision` is set: disable all cell editing (`_onCellBlur` no-ops), disable row add/delete, disable context menu edit actions.
   - Add `data-readonly` attribute to `#data-grid` → CSS applies subtle grey overlay.

4. **Disable ETL**: when `viewingRevision` is set, the ETL run button is disabled.

5. **History scoping**: when `viewingRevision` is set, pass `?revision={N}` to the audit log endpoint so it returns only entries where `revision = N`.
   - Update `GET /api/tools/{id}/history` (in `routes.py`) to accept optional `revision` query param and filter accordingly.

**Update** `static/engine/js/api.js.md`.

---

## Context Files to Update After Each Step

| Step | Files to update |
|------|----------------|
| Q0 | `engine/project_db.py.md`, `_context/DECISIONS.md` (new D-Q decisions), `_context/DONE.md` |
| Q1 | `engine/routes_revisions.py.md`, `_context/DONE.md`, `_context/URL_STRUCTURE.md` |
| Q2 | `engine/service.py.md` or `service_row_ops.py.md`, `engine/etl.py.md`, `_context/DATA_FLOWS.md`, `_context/DONE.md` |
| Q3 | `engine/routes_revisions.py.md`, `_context/DONE.md` |
| Q4 | `static/engine/js/revision-picker/revision-picker.js.md`, `_context/FRONTEND_PATTERNS.md`, `_context/DONE.md` |
| Q5 | `static/engine/js/revision-picker/revision-picker.js.md`, `_context/DONE.md`, `_context/GLOSSARY.md` |

---

## Glossary Additions (add to `_context/GLOSSARY.md` in Step Q0)

| Term | Definition |
|------|-----------|
| **Revision** | A project-wide integer counter (0, 1, 2…). Revision 0 ("First issue") is auto-created on project creation. Only the latest revision is editable. |
| **Snapshot** | A frozen copy of all tool tables (rows + column definitions) taken when the user moves to a new revision. Stored in `_revision_snapshots`. |
| **Delete Revision** | Removes the latest revision number but keeps all data — merges into the previous revision. Non-destructive. |
| **Revert to Revision** | Destructive: restores live data from a frozen snapshot, discarding all changes made after that revision. Creates a permanent safety backup before proceeding. |
| **viewingRevision** | Frontend flag (integer or null). When set, the app is in read-only mode showing a snapshot; `null` means live/editable mode. |
