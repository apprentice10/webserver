# CURRENT_STATE.md

*Last updated: 2026-05-08*

Completed feature history → `_context/DONE.md`

---


## Active Plans

~~[Stateless Server + Local File Management](_context/PLAN_STATELESS_SERVER.md)~~ — **Done (2026-05-08)**. All D-S1–D-S8 decisions implemented. See `_context/DONE.md` and `_context/DECISIONS.md`.

---

## Next Priorities (ordered by value/effort)

### Group G — LOG system (medium effort)

~~43. **Performance** — virtual scrolling + `__position` index~~ — Done (2026-05-08).

### Group I — Project file management (high effort, architecture ready)

The refactor (2026-04-26) made each project DB self-contained (`_project` + `_templates` inside the file). The infrastructure for portable files is now in place.

~~47. **Save project as file**~~ — Done (2026-05-07).
~~48. **Open project from file**~~ — Done (2026-05-07).
~~49. **Automatic backup**~~ — Done (2026-05-08). On-open toggle + timer interval in Settings → Backup tab.

### Group J — DB ↔ Webserver compatibility (done)

~~50. **Schema versioning**~~ — Done (2026-05-08). `PRAGMA user_version` + `SCHEMA_VERSION` constant.
~~51. **Compatibility check on open**~~ — Done (2026-05-08). HTTP 403 on writes + `schema_warning` in metadata.
~~52. **Automatic migrations**~~ — Done (2026-05-08). `_run_migrations` versioned runner.
~~53. **Safety rollback**~~ — Done (2026-05-08). Backup to `data/backups/` before migration.
54. **DuckDB compatibility study** — `_context/DUCKDB_COMPAT.md` document — separate follow-up task.

### Group K — Panel System (in progress)

Core done: `PanelSystem` with registry, tab bar, floats, DnD. `sidebar.js` thin adapter. Info + Log panels are selection-reactive. `panels.css` created.

~~K-4. **Standardise General Notes + SQL Editor as panels**~~ — Done (2026-05-07).
~~K-5. **Bottom dock zone**~~ — Done (2026-05-07).
~~K-6. **Right sidebar resizable**~~ — Done (2026-05-07).
~~K-7. **Drag-to-dock proximity detection**~~ — Done (2026-05-07).

---

### Group L — Grid UX fixes (done)

~~L-1. Disable native text selection in grid~~ — already implemented via `.data-grid.selecting { user-select: none }` pattern.


### Tools backlog (low priority)

* **Cable List tool** (new type_slug, custom system columns)
* **I/O List tool** (new type_slug)
* **Workspace file system** (`.imanager` files — largest effort)

---

### Group Q — Revision system (high effort)

A revision is project-wide (not per-tool). Integer counter, auto-incrementing.

**`chip-rev` button behaviour:**
- Shows **Latest (#N)** (highlighted) when on the latest revision.
- Opens a picker to select an older revision or create a new one.

**Revision semantics (branch model, inspired by Git):**
- Creating a new revision freezes the current state of every tool and continues editing on the new revision number.
- A tool's state is always tied to its revision; switching revisions restores the frozen snapshot.

**LOG / history:**
- The LOG is attached to the revision. When a new revision is created each tool starts a fresh history on that revision.
- Older revision histories are never deleted; they are viewable by navigating back to that revision.
- The `REV` column on a row updates only when any cell value in that row changes (including changes triggered by ETL).

**Mutability rules:**
- Only the latest revision is editable. Older revisions are read-only.
- The user may delete the latest revision. On deletion:
  - All `REV` column values that were set under the deleted revision revert to the revision that now becomes latest.
  - The history of the deleted revision is merged (appended) into the history of the surviving revision.

---

### Group O — Selection / keyboard UX clarity (discovery)

- **/grill-me session needed**: clarify exact expected behaviour for every keyboard command and context-menu action when a **cell is selected** (single, select-mode) vs. a **range is selected** (multi-cell). Outcome: a written spec / decision that drives any UX fixes.

### Group P — Theme (medium effort)

- **Dark theme too dark** — current dark palette is difficult to read (contrast too low in several areas). Redesign the dark token set for better legibility.
- **Add a middle-ground theme** — a third option between the current light and dark themes (e.g. a dim/slate grey).

### Bug — History panel: click-old-value restore (fixed 2026-05-08)

Clicking an old value in the History sidebar (e.g. `panel-tl-new`) used to restore that value to the selected cell. This broke at some point (likely during Group K panel refactor). Fix: `old_val` text in audit entries is now a clickable `<span class="sidebar-log-rollback">` that calls `_rollbackCell` directly; the separate `↩` button and the `confirm()` dialog were removed. CSS updated to render the span as underlined link text instead of a floating button.

### Bug — Intermittent 500 on columns endpoint

- `GET /api/tools/{id}/columns?db=...` occasionally returns HTTP 500 on first page load but recovers after a browser reload. No consistent repro yet. Likely a race condition or transient DB connection issue. Needs investigation — add logging to `get_project_conn` and the columns route to capture the error before it disappears.

---

## Paused / Deferred

* EAV→flat migration tooling (already migrated, no active need)
* Multi-user / concurrency (single-user app for now)
* **flags/overrides bulk-load optimisation** — `get_rows()` loads all `_cell_flags` and `_overrides` in two bulk queries then attaches them per-row in Python. Acceptable at 20k rows (no N+1), but the Python serialisation loop may become a bottleneck at higher scale. Profile before acting; consider pushing the join into SQL if needed.
