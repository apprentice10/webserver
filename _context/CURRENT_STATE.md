# CURRENT_STATE.md

*Last updated: 2026-05-07*

Completed feature history → `_context/DONE.md`

---

## Next Priorities (ordered by value/effort)

### Group F — ETL Editor (low effort, independent)

32. **Code folding** — optional; syntax validation (inline compile-error banner) already done

### Group G — LOG system (medium effort, depends on D and C)

42. **Advanced LOG filtering** — future UI: filter by column, filter by change type, before/after diff
43. **Performance** — avoid heavy SQLite rows on large datasets (+10,000 rows); evaluate pagination or pruning

### Group H — Bidirectional ETL (high effort)

46. **Visual transformations → SQL** — prefix/suffix/replace/formula automatically generate equivalent SQL

### Group I — Project file management (high effort, architecture ready)

The refactor (2026-04-26) made each project DB self-contained (`_project` + `_templates` inside the file). The infrastructure for portable files is now in place.

47. **Save project as file** — copy of project `.db` to user-selected location (API `GET /projects/{id}/export`)
48. **Open project from file** — upload/path of an existing `.db`, register in `projects.db` via `add_project()` (API `POST /projects/import`)
49. **Automatic backup** — periodic or pre-destructive-operation backup

### Group J — DB ↔ Webserver compatibility (high effort, depends on I)

50. **Schema versioning** — `schema_version` field in each project DB; `_schema_version` table with current version number
51. **Compatibility check on open** — version check at `open_project_db()`, warning on mismatch
52. **Automatic migrations** — migration runner to bring old DBs to current version
53. **Safety rollback** — automatic backup pre-migration
54. **Future PostgreSQL compatibility** — abstract raw sqlite3 queries into a compatible layer

### Group K — View Sidebar & Toolbar Cleanup (medium effort, depends on D and E)

Consolidate column-visibility toggles into a collapsible sidebar panel (mirrors Flags sidebar pattern). Clean up redundant toolbar/topbar buttons.

55. **View sidebar shell** — new sidebar panel with items: "Deleted rows" (replaces `btn-show-deleted` / `GridManager.toggleDeleted()`) and "Rev column" (replaces `btn-toggle-rev` / `GridManager.toggleRev()`); each item has an eye icon to toggle visibility; removes both standalone toolbar buttons; saves state per-project/tool via localStorage (same pattern as Flags hidden-state in `static/engine/js/flags.js`)
56. **View toolbar button** — add "View" button after Flags in toolbar (`table.html`); opens View sidebar; mutually exclusive toggle with Flags button (only one sidebar active at a time)
57. **Remove "Cambia Rev" topbar button** — revision letter is already editable in the Settings modal (`ToolbarManager.openSettings()`); remove the redundant `{% block topbar_actions %}` button from `table.html`
58. **Replace "Info" button** — replace current `btn-toggle-sidebar` ("Info") with a dedicated toggle styled and behaving like the Flags/View buttons (shows active state when sidebar is open)
59. **Log sidebar — selection-reactive** — Log sidebar content updates automatically when the active cell or range changes (not only on context-menu trigger); if sidebar is open and selection changes, content refreshes; if nothing selected, show placeholder "Select a cell or range."

---

### Tools backlog (low priority)

* **Cable List tool** (new type_slug, custom system columns)
* **I/O List tool** (new type_slug)
* **Workspace file system** (`.imanager` files — largest effort)

## Paused / Deferred

* EAV→flat migration tooling (already migrated, no active need)
* Multi-user / concurrency (single-user app for now)
