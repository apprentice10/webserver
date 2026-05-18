# Group G — Shared Grid Toolkit

## Goal

Extract the Sheet V1 grid frontend into a shared, configurable toolkit that any engine can use. Define the "grid-api v1 backend contract" — the exact set of REST endpoints an engine backend must implement to host a grid. Sheet V1 becomes the first consumer (regression proof). MTO V1 becomes the second consumer (adds full grid to its materials table).

This unblocks the MTO revision and every future engine that needs a table. The `dashboard_uses: ["grid-api v1"]` field in `engine.json` already declared this intent — this task makes it real.

---

## Steps

- [ ] **G1 — Audit hardcoded URLs in Sheet V1 frontend**
  Find every URL string constructed in `engines/sheet_v1/static/js/`. List which files reference `/api/engines/` paths and how they build them. Identify if `apiBase` is already threaded through or hardcoded per-file. Output: a clear list of what must change.

- [ ] **G2 — Define the grid-api v1 backend contract**
  Write `_context/grid/GRID_API_CONTRACT.md`. List every endpoint the grid frontend calls (columns CRUD, rows CRUD, cell update, reorder, flags, audit/log, undo/redo, export, find-replace, etc.), their method + path pattern, request body shape, and response shape. The path pattern uses a configurable `{apiBase}/{toolId}` prefix — any engine sets that prefix to whatever its own backend serves.
  Include a note on "sub-table grids" (e.g. MTO materials filtered by typical_id): the grid supports this by accepting a full `endpointBase` string that already encodes any extra path segments (e.g. `/api/engines/mto/{toolId}/materials/{typicalId}`).

- [ ] **G3 — Parameterize the grid: replace hardcoded URLs with config**
  Add a `Grid.init({ endpointBase })` config parameter. All URL construction in every grid JS module reads from this config instead of building paths from a hardcoded prefix. No files moved yet — just the API path wiring changed. Sheet V1 passes its own prefix; smoke-test that it still works.

- [ ] **G4 — Move grid JS to `static/engine/js/grid/`**
  Move all generic grid files from `engines/sheet_v1/static/js/` to `static/engine/js/grid/`. Update all `<script src="...">` tags in `engines/sheet_v1/templates/table.html` to point to the new shared paths. Update `MODULE_LAYOUT.md`.
  Files that stay in Sheet V1 (Sheet-specific, not reusable): `etl_editor.js`, `sql_editor.js`, `toolbar.js` (contains Sheet-specific ETL run logic).

- [ ] **G5 — Full regression on Sheet V1**
  Open a real project, exercise every grid feature: cell edit, add/delete row, drag-reorder, FLAGS, LOG panel, REV, undo/redo, find-replace, sort/filter, column resize, copy/paste, paste-special, fill handle, export. Fix any regressions. This is the acceptance gate.

- [ ] **G6 — Wire shared grid into MTO materials table**
  Implement the grid-api v1 backend contract in `engines/mto_v1/backend/` for the `mto_materials` table, scoped to a `typical_id`. Update `mto_table.html` and `mto_shell.js` to init the shared grid inside the materials panel with `endpointBase = /api/engines/mto/{toolId}/materials/{typicalId}`. Remove the old custom `mto_materials.js` table rendering code. Smoke-test: materials table in MTO has full grid features.

- [ ] **G7 — Update authoring docs**
  Update `_context/infra/ENGINE_AUTHORING.md`: add a "Using the shared grid" section explaining the contract and how to init the grid in a new engine. Update `_context/infra/MODULE_LAYOUT.md` with the new `static/engine/js/grid/` location.

---

## Decisions

- **`endpointBase` string, not a callback:** The grid accepts a plain string for the endpoint base. Sub-table grids (like MTO materials filtered by `typical_id`) encode the filter in the base string itself (e.g. `.../materials/42`). This keeps the grid stateless about filtering logic.
- **Sheet V1 keeps `toolbar.js` and `etl_editor.js`:** These contain Sheet-specific logic (ETL run, SQL editor). They are not moved to shared. If other engines need them, they declare their own.
- **Sheet V1 legacy prefix:** Sheet V1 uses `/api/engines` (no slug) as a legacy path. The shared grid just takes whatever `endpointBase` is given — no enforced prefix format. This avoids a breaking migration of Sheet V1's backend.
- **No framework, no build step:** The shared grid stays Vanilla JS IIFEs, consistent with the existing frontend standard (`_context/grid/FRONTEND_PATTERNS.md`).
- **`dashboard_uses: ["grid-api v1"]` in `engine.json`** is now a meaningful declaration: any engine listing it must implement the contract defined in `GRID_API_CONTRACT.md`.

---

## Risks

- **G4 (move files) breaks cached browser state:** Force-refresh during dev. Not a production risk since there are no external deployments yet.
- **G5 regression scope:** The Sheet V1 grid has ~30 JS modules. A missed URL reference will cause a silent 404. G3 (audit first) is the mitigation — identify every reference before moving.
- **G6 schema mismatch:** `mto_materials` does not have all system columns (`__id`, `__position`, `__log`, `__created_at`) that the grid contract may expect. The contract doc (G2) must be explicit about which columns are required vs optional so MTO can implement a compatible but simpler schema.
