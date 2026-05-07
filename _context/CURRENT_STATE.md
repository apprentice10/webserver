# CURRENT_STATE.md

*Last updated: 2026-05-07*

Completed feature history → `_context/DONE.md`

---


## Next Priorities (ordered by value/effort)

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

## Paused / Deferred

* EAV→flat migration tooling (already migrated, no active need)
* Multi-user / concurrency (single-user app for now)
