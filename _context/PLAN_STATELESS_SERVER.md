# Plan: Stateless Server + Local File Management

*Status: agreed, not yet started — 2026-05-08*

---

## Goal

Remove `data/projects.db` and all server-side project registry state. The server becomes a pure file-operation layer. Project discovery, recents, settings, and panel layout all move to the browser (`localStorage`).

---

## Decisions

| # | Decision |
|---|----------|
| D-S1 | Project identity is the full `.db` path, passed as `?db=...` query param |
| D-S2 | Server exposes `/api/fs/browse` + `/api/fs/cwd` for filesystem navigation |
| D-S3 | Path always required on "New Project" — no silent defaults |
| D-S4 | Backup lives at `{project_dir}/{subfolder_name}/{YYYYMMDD_HHMMSS}_{stem}.db` |
| D-S5 | Backup triggered by client: on project open (optional toggle) + `setInterval` timer |
| D-S6 | "Remove from recents" is pure localStorage; "Delete file" calls the API |
| D-S7 | Export endpoint removed — file is already local |
| D-S8 | `data/projects.db` deleted; existing project `.db` files re-opened manually |

---

## localStorage Keys

| Key | Content |
|-----|---------|
| `im_recent_projects` | `[{name, client, path, last_opened}]` — last 5 opened projects |
| `im.prefs` | Theme, accent, density, language + backup settings (merged in) |
| `im_panels_{hash(path)}` | Panel layout per project |

---

## URL Shape

| Page | URL |
|------|-----|
| Home — no project | `/` |
| Home — project open | `/?db=C%3A%5C...%5Cacme.db` |
| Tool page | `/tool?db=...&tool=7` |
| ETL editor | `/tool?db=...&tool=7&view=etl` |
| ETL design | `/project/etl-design?db=...` |

---

## API Changes

### Removed
- `GET /api/projects/` — list (replaced by localStorage)
- `GET /api/projects/{id}` — get by id
- `GET /api/projects/{id}/export` — download file
- `POST /api/projects/import` — replaced by open-from-path
- `engine/project_index.py` — entire module deleted
- `init_index()` call in `main.py`

### New (`core/routes.py`, prefix `/api/project`)

| Endpoint | Body / Params | Purpose |
|----------|---------------|---------|
| `POST /api/project/new` | `{path, name, client, description}` | Create new `.db` at given absolute path |
| `POST /api/project/open` | `{path}` | Validate `.db`, return `{name, client, tools[]}` |
| `DELETE /api/project?db=...` | — | Delete `.db` file from disk |
| `GET /api/project?db=...` | — | Read `_project` metadata |
| `POST /api/project/backup?db=...` | — | Write one backup; prune old ones beyond keep-count |
| `GET /api/fs/browse?path=...` | — | Return `{path, parent, entries:[{name,type}]}` — dirs + `.db` files only |
| `GET /api/fs/cwd` | — | Return server working directory (default start for browser) |

### Migrated
All `engine/routes.py` endpoints: `{project_id}` path param → `?db=...` query param throughout.

---

## Settings Modal — New Backup Tab

Fields saved into `im.prefs`:

| Field | Type | Default |
|-------|------|---------|
| Backup on open | toggle | off |
| Timer interval (min) | integer, 0 = disabled | 0 |
| Backups to keep | integer | 10 |
| Backup subfolder name | text | `_backups` |

---

## UI Changes

### `base.html` topbar-right
- Remove `<button id="btn-settings">` — already duplicated in side-bottom.

### `base.html` side-bottom bar
Add two new items (always visible):
- **New Project** — opens "New Project" modal
- **Open Project** — opens "Open Project" modal

Existing items: ETL Design *(shown only when project open)* · Settings.

### Welcome card (`index.html`)
- Remove "Nuovo Progetto" and "Apri Progetto" buttons from the card.
- Replace card body with a **recent projects list** (from `im_recent_projects`).
- Stale entry (file not found on disk): show inline error with one-click "Remove" action.

### "New Project" modal
- Add **path field** with a folder-browse button (uses `/api/fs/browse`).
- Create button disabled until path + name are both filled.

### "Open Project" modal
- Replace server-fetched list with `im_recent_projects` from localStorage.
- Add **Browse** button → file picker via `/api/fs/browse`.
- Rename "Import from file" button to **"Browse…"**.
- Each recent entry: click to open, ✕ remove from recents, 🗑 delete file.

---

## Implementation Order

1. **Backend — API migration**
   - Delete `engine/project_index.py`
   - Rewrite `core/routes.py` with new `/api/project/*` endpoints
   - Migrate all `engine/routes.py` endpoints to `?db=...`
   - Add `/api/fs/browse` and `/api/fs/cwd`
   - Add `POST /api/project/backup`
   - Update `main.py` (remove `init_index`, update page routes to pass no `project_id`)

2. **Frontend — localStorage layer**
   - `im_recent_projects` read/write helpers in `app_shell.js`
   - Panel layout key changed to `im_panels_{hash(path)}`
   - Backup settings merged into `im.prefs`

3. **Frontend — UI changes**
   - Welcome card → recent projects list
   - Side-bottom bar: New + Open buttons
   - Topbar settings button removed
   - "New Project" modal: path field + browser
   - "Open Project" modal: localStorage list + browse

4. **Frontend — Backup**
   - Settings modal: new Backup tab
   - `app_shell.js`: on-open backup call + `setInterval` timer

5. **Cleanup**
   - Delete `data/projects.db`
   - Update `_context/DECISIONS.md` (add D-S1…D-S8)
   - Update companion `.md` files for changed modules
