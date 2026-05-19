# Plan: Phase 2 — Grouping Toolkit

## Goal

Implement a generic, configuration-driven Grouping Toolkit that presents a combobox populated from unique values in a source column. Selecting a value injects a client-side filter into one or more target Grid Toolkit instances, creating the illusion of navigating between pages while technically filtering a shared dataset. All behavior is driven by `engine.json` config; no backend changes.

---

## Steps

- [x] Step 1 — Add `grid:loaded` DOM event to `grid.js` `reloadData` (one `dispatchEvent` line after rows are set) — also added to `init()` end-of-setup
- [x] Step 2 — Add `_groupingOwned` ownership set to `SortFilterManager`: `setGroupingOwned(slug, bool)` method + guard in header click listener and filter dropdown open
- [x] Step 3 — Grid Toolkit adapter already existed (Phase 3 of shared-toolkit plan); fixed async `init` → synchronous so ToolkitHost stores real instance before Grouping.init runs
- [x] Step 4 — Created `static/engine/js/toolkits/grouping/grouping.js` IIFE
- [x] Step 5 — Created companion `.md` for `grouping.js`; updated `grid.js.md` with sync-init decision
- [x] Step 6 — Updated `engines/mto_v1/engine.json`: added `grouping` toolkit with `source_column: "material"`, `target_toolkit_ids: ["grid"]`, `slot: "[data-toolkit-slot='grouping']"`
- [x] Step 7 — Added `[data-toolkit-slot="grouping"]` div above tab-bar in `mto_table.html`; tab-bar left intact (image/utilities loading still depends on mto_shell.js)
- [x] Step 8 — Smoke-test: static files served correctly, grid:loaded dispatched at both init and reloadData, setGroupingOwned in SortFilter API, Grid.init synchronous. Manual browser test pending (user to verify combobox populates and filters grid).

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
