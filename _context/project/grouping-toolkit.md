# Plan: Phase 2 — Grouping Toolkit

## Goal

Implement a generic, configuration-driven Grouping Toolkit that presents a combobox populated from unique values in a source column. Selecting a value injects a client-side filter into one or more target Grid Toolkit instances, creating the illusion of navigating between pages while technically filtering a shared dataset. All behavior is driven by `engine.json` config; no backend changes.

---

## Steps

- [ ] Step 1 — Add `grid:loaded` DOM event to `grid.js` `reloadData` (one `dispatchEvent` line after rows are set)
- [ ] Step 2 — Add `_groupingOwned` ownership set to `SortFilterManager`: `setGroupingOwned(slug, bool)` method + guard in header click listener and filter dropdown open
- [ ] Step 3 — Create minimal Grid Toolkit adapter: `static/engine/js/toolkits/grid/grid.js` IIFE exposing `setGroupingFilter`, `clearGroupingFilter`, `setGroupingOwned`, `releaseGroupingOwned` on its returned object; wires to `SortFilterManager` and `GridManager`
- [ ] Step 4 — Create `static/engine/js/toolkits/grouping/grouping.js` IIFE
  - On `init(ctx)`: parse config, mount combobox into `ctx.config.slot`, subscribe to `grid:loaded` on source toolkit
  - On `grid:loaded`: read `getAllRows()` from source toolkit, extract distinct non-empty values, render `(All)` + sorted options
  - On combobox change: call `setGroupingFilter(slug, value)` on each target toolkit (or `clearGroupingFilter` for `(All)`)
  - On init: call `setGroupingOwned(slug)` on each target toolkit
- [ ] Step 5 — Create companion `.md` files for `grouping.js` and `grid.js` (Grid adapter)
- [ ] Step 6 — Update `engines/mto_v1/engine.json`: declare `grouping` toolkit and `grid` adapter toolkit with correct config
- [ ] Step 7 — Update MTO engine HTML template: add `[data-toolkit-slot="grouping"]` in the correct position, remove old tab-bar typical-switching DOM if superseded
- [ ] Step 8 — Smoke-test: verify `(All)` shows full dataset, selecting a value filters all target grids, owned column absent from sort-filter header, multiple instances compose correctly

---

## Decisions

**D-GT-01**: Grouping Toolkit is a filter system, not a page-switcher. It extracts unique values from a source column and drives client-side column filters on target grids.

**D-GT-02**: Filter propagation is client-side via `SortFilterManager.setColumnFilter`. No backend calls, no grid reload. Fits the toolkit constraint: toolkits cannot define backend behavior.

**D-GT-03**: Column ownership enforced via `_groupingOwned` set in `SortFilterManager`. Header click listener and dropdown skip owned slugs. Grid Toolkit exposes `setGroupingOwned(slug)` / `releaseGroupingOwned(slug)`.

**D-GT-04**: Unique values read from `getAllRows()` on the source Grid Toolkit after `grid:loaded` DOM event fires. The event is added to `grid.js` `reloadData` — one `dispatchEvent` line, additive.

**D-GT-05**: Combobox mounts into pre-allocated `[data-toolkit-slot="grouping"]` in the engine HTML template. Engine author controls placement; toolkit does no DOM surgery.

**D-GT-06**: Grid Toolkit adapter (Phase 2 minimal) exposes `setGroupingFilter(slug, value)` / `clearGroupingFilter(slug)` on its instance object. Grouping Toolkit calls via `ctx.getToolkit(targetId)`.

**D-GT-07**: Default = `(All)` at combobox position 0, no filter active on load. First-item-default deferred as future `default_selection` config option.

**D-GT-08**: All config static in `engine.json`. `toolkit_config` DB table is not used by the Grouping Toolkit in Phase 2. Fields: `source_toolkit_id`, `source_column`, `target_toolkit_ids` (array), `slot` (CSS selector string).

**D-GT-09**: Multiple Grouping Toolkit instances are allowed per engine. Each has a distinct `id`, distinct `slot`, distinct `source_column`. Filters from multiple instances compose via AND on the target grid.

**D-GT-10**: Empty / null / `""` values in the source column are excluded from the combobox group list. These rows are visible under `(All)`. Future extension point: `empty_value_handling: "exclude" | "group"` config flag — not implemented in Phase 2.

---

## Risks

- **`grid:loaded` timing**: if a target grid is not the source grid, it may load after the Grouping Toolkit's `grid:loaded` handler fires. Grouping Toolkit must subscribe to all target grids' `grid:loaded` events and re-apply filter on each.
- **Multiple Grouping Toolkits on same column**: two instances claiming the same slug on the same target grid will conflict in `_groupingOwned`. Engine authors must use distinct columns per instance — not enforced, only documented.
- **MTO tab-bar migration**: `mto_shell.js` currently owns typical-switching via `_switchTab`. Replacing it with the Grouping Toolkit changes the navigation model. The tab-bar DOM and switch logic must be removed carefully to avoid breaking image / utilities loading that currently piggybacks on `_switchTab`.
- **Sort-filter state persistence**: `setColumnFilter` inside `setGroupingFilter` calls `persistState()` which PATCHes sort-filter-state. The grouping selection will be persisted to the DB as a column filter. On reload, `loadState` will restore it — meaning the last selected group persists across page loads. Verify this is acceptable UX before shipping; if not, suppress `persistState` for grouping-owned columns.
