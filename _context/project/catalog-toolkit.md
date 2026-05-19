Updated: 2026-05-19 10:00

# Plan: Phase 4 — Grid + Catalog Toolkit

## Goal

Implement a Catalog Toolkit that decorates the existing Grid Toolkit adapter to add catalog synchronization behavior: autocomplete from a curated catalog, automatic fill of tracked columns on TAG match, divergence detection between grid values and catalog reference values, and explicit write-back ("Save to catalog"). The toolkit is generic and configurable — catalog semantics are driven by `engine.json` config and `toolkit_config` runtime overrides. No grid machinery is duplicated; the Catalog Toolkit consumes the Grid Toolkit's public API.

---

## Steps

- [x] Step 1 — Backend: catalog table bootstrap + snapshot endpoint (extend toolkit init flow)
- [x] Step 2 — Backend: `/catalog/` CRUD route group (`GET rows`, `POST entry`, `DELETE entry/{tag}`)
- [x] Step 3 — Frontend: `catalog.js` IIFE — state bucket init, catalog pre-load, event wiring
- [x] Step 4 — Frontend: TAG autocomplete (`<datalist>`) + pull logic (datalist select + blur fallback)
- [x] Step 5 — Frontend: tracked-column autocomplete (`<datalist>` per column, distinct values from state bucket)
- [x] Step 6 — Frontend: divergence detection — `catalog-drift` CSS class on `<td>` + hover tooltip
- [x] Step 7 — Frontend: catalog mode toggle — dataset switch (data ↔ catalog rows), grouping still active
- [x] Step 8 — Frontend: "Save to catalog" action — collision check, confirmation dialog, upsert
- [x] Step 9 — Config: `engine.json` schema hint for `tracked_columns`; `toolkit_config` runtime override wiring
- [x] Step 10 — Companion docs: `catalog.js.md`, update `SHARED_GRID_TOOLKIT.md`, update `ENGINE_AUTHORING.md`
- [x] Step 11 — Smoke test: full flow (autocomplete → pull → divergence → save → catalog mode)
- [x] Step 12 — Write-back: check off Step 5 in master plan, append to DECISIONS.md, update GLOSSARY.md

---

## Decisions

**D-CAT-01 — Architecture: decorator, not fork**
Catalog Toolkit decorates the Grid Toolkit adapter. Stack: `grid.js → Grid Toolkit adapter → Catalog extension layer`. Grid Toolkit is the single source of truth for grid behavior. The Catalog Toolkit consumes the Grid Toolkit's public API (`getAllRows`, `setEndpointBase`, etc.) — no grid machinery duplicated.

**D-CAT-02 — Catalog storage: tool-local SQLite**
Catalog lives in `catalog_<tool_id>` inside the same per-project SQLite as the engine data table. Tool-local — not shared across tools. Consistent with D01 per-project isolation.

**D-CAT-03 — Catalog schema: mirrored columns**
`catalog_<tool_id>` mirrors the grid data table's column structure (same dynamic column slugs). A catalog row looks exactly like a grid row. ETL owns actual column structure — the toolkit only hints at which columns are tracked; no DDL side effects from the toolkit.

**D-CAT-04 — Match key: TAG (hardcoded)**
TAG system column is the hardcoded catalog match key. Not configurable. A grid row matches a catalog entry when their TAG values are equal. Rows with empty TAG are skipped by all catalog sync operations.

**D-CAT-05 — Sync direction: pull-automatic / push-on-demand**
Catalog → grid fill is automatic on TAG match. Grid → catalog is explicit only: user triggers "Save to catalog." Catalog entries are never mutated implicitly. Catalog is authoritative reference data; grid is authoritative working state.

**D-CAT-06 — Tracked column definition**
A tracked column receives all four behaviors: (1) automatic pull fill on TAG match, (2) autocomplete from distinct catalog values for that column, (3) included in "Save to catalog" push, (4) divergence detection against catalog reference. `tracked ≠ always synchronized` — grid remains editable.

**D-CAT-07 — Autocomplete: native `<datalist>`**
TAG cell gets `<datalist>` from global catalog TAG index. Each tracked column cell gets `<datalist>` from distinct values for that column across all catalog entries. Both fed from in-memory `toolkits.catalog` state bucket. No async calls during autocomplete.

**D-CAT-08 — Pull trigger: datalist selection + blur fallback**
Primary trigger: datalist selection event (immediate fill). Fallback trigger: cell blur (catches manual typing, paste, autocomplete bypass). Both call the same idempotent fill function. Blur guard: TAG matches catalog entry AND at least one tracked column value differs.

**D-CAT-09 — Divergence indicator: CSS class + tooltip**
Tracked cells that differ from the catalog reference receive `catalog-drift` class on the `<td>`. A hover tooltip shows "Catalog value: X". Visual-only, non-blocking — no forced overwrite, no automatic conflict resolution.

**D-CAT-10 — Catalog mode: dataset switch inside grid**
A toggle switches the grid between `data mode` (ETL/material rows) and `catalog mode` (catalog table rows). Same grid instance — only the dataset changes. Grouping Toolkit continues to apply as a filter layer on top of whichever dataset is active. Stack: `base dataset (data OR catalog) → grouping filter → rendered grid`.

**D-CAT-11 — Save to catalog: collision dialog**
`POST /catalog/entry` returns `{ exists: true, conflict: true }` if TAG already exists. Frontend shows confirmation dialog ("TAG X already in catalog — overwrite?") before confirming upsert. No silent overwrite.

**D-CAT-12 — Catalog pre-load: snapshot at init**
On `Catalog Toolkit.init(ctx)`, backend returns full catalog snapshot (tracked columns keyed by TAG). Stored in host state bucket under `toolkits.catalog`. Snapshot-style — updated only via explicit refresh events, not per-row re-fetch.

**D-CAT-13 — Catalog table bootstrap: toolkit init side-effect**
Backend ensures `catalog_<tool_id>` exists during toolkit init (idempotent CREATE TABLE IF NOT EXISTS). No new endpoint — side-effect of existing `/toolkit/init` flow. Migration system untouched.

**D-CAT-14 — Backend API surface**
- Toolkit init (existing endpoint) — includes catalog snapshot + table bootstrap
- `GET /engines/{project_id}/{tool_id}/catalog/rows` — full catalog dataset for catalog mode
- `POST /engines/{project_id}/{tool_id}/catalog/entry` — upsert single entry (TAG-based); returns conflict flag
- `DELETE /engines/{project_id}/{tool_id}/catalog/entry/{tag}` — remove entry by TAG
- Backend is CRUD-only; no workflow logic server-side.

**D-CAT-15 — Config: dual-layer**
`engine.json` declares `tracked_columns` as design-time defaults (schema hints, not enforced DDL). `toolkit_config` table stores runtime overrides. Runtime takes precedence; missing runtime values fall back to `engine.json`. TAG key is infrastructure — never appears in config.

**D-CAT-16 — `engine.json` config shape**
```json
{
  "toolkits": [
    { "id": "grid",    "src": "toolkits/grid/catalog_grid.js" },
    { "id": "catalog", "src": "toolkits/catalog/catalog.js",
      "config": { "tracked_columns": ["manufacturer", "model", "unit"] } }
  ]
}
```
No `catalog_key` field. No `autocomplete` toggle. `tracked_columns` is the only required config field.

---

## Risks

- **Grid Toolkit API surface may be incomplete**: The Catalog Toolkit needs `getAllRows` and possibly a row-update API from the Grid Toolkit adapter. If the Phase 3 public API is missing a method, the adapter must be extended — read `SHARED_GRID_TOOLKIT.md` before Step 3.
- **Catalog mode + Grouping Toolkit interaction**: Dataset switch must not reset grouping state. The grouping filter must re-apply after dataset switch — verify the `grid:loaded` event fires correctly in catalog mode.
- **Divergence detection on large grids**: `catalog-drift` class is applied during render pass. If the grid has many rows with many tracked columns, the diff loop may cause visible lag. Benchmark before marking Step 6 done.
- **Empty TAG rows**: All catalog operations skip rows with empty TAG. Ensure the fill function, divergence check, and "Save to catalog" all guard on `TAG !== ""` consistently.
- **Schema drift**: If ETL adds or removes columns after the catalog table was created, the catalog table schema diverges from the grid data table. The toolkit must handle missing columns gracefully (ignore, not crash).
