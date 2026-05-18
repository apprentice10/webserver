---
name: sort-filter.js
description: Client-side sort & filter manager for Sheet V1 — multi-level sort and per-column filter with wildcard OR terms; state persisted to DB
type: reference
---

# engines/sheet_v1/static/js/sort-filter/sort-filter.js

**Description:** IIFE `SortFilterManager`. All sort and filter operations are client-side on the full in-memory array. State is persisted to the backend via `PATCH /{tool_id}/sort-filter-state`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–30 | State vars | `_sortLevels`, `_columnFilters`, `_filterDropdown`, timers, handlers |
| 32–45 | `loadState / getState / persistState` | Deserialize from API response; debounced 500ms PATCH on change |
| 47–78 | `applyToRows` / `_filterRows` / `_sortRows` | Filter then sort; wildcard regex via `_matchWildcard` |
| 80–103 | `getSortDir / getSortIndex / setSortLevel / clearAllSort` | Cycle asc→desc→none on header click; appends new level to end |
| 105–122 | `isFilterActive / getFilterTerms / setColumnFilter / clearColumnFilter / clearAll` | Filter state management |
| 124–155 | `_updateHeaderSortIndicators / _updateHeaderFilterIndicators / updateHeaderIndicators` | DOM sync for header arrows, rank badges, filter dot |
| 157–240 | `_makeTermRow / openFilterDropdown / _attachDropdownEvents` | Filter dropdown — search-term rows (wildcard `*/?`) with `+` to add more, checkbox list filtered live by first term |
| 242–252 | `closeFilterDropdown` | Remove dropdown from DOM, detach outside-click/key handlers |
| 246–264 | `attachHeaderListeners` | Event delegation on `#grid-header-row` — one binding, survives header re-renders |
| 266–320 | `registerPanel / _refreshSortPanel / _renderPanel` | PanelSystem-registered sort panel with level list and filter summary |
| 322–393 | `_attachPanelEvents / return` | Panel interactivity; public API |

## Decisions

- **Filter applied before sort** inside `applyToRows`: deleted-row filter and search filter happen before this in `grid.js._applyFilters()`, so all three stages compose correctly.
- **Checkbox list: all checked = no filter term** — when all values are checked, no `values` term is stored. This avoids storing large arrays and treats "all selected" as "no filter".
- **Wildcard patterns** use `*` (any sequence) and `?` (any single char), case-insensitive regex. Search-term inputs in the filter dropdown support these directly (e.g. `*02`).
- **Filter dropdown search rows**: all term inputs live-filter the checkbox list (OR across terms, wildcard-aware via `_matchWildcard`). `+` adds another OR condition; `×` removes it (re-filters immediately). All non-empty inputs become `pattern` terms on Apply.
- **Persist debounce 500ms** — rapid sort/filter changes don't flood the backend.
- **`attachHeaderListeners` binds once** via event delegation on `#grid-header-row`. The element persists across `renderHeader()` calls (only innerHTML changes), so the listener is never lost.
- **`typeof SortFilterManager !== 'undefined'` guard** — used in `columns.js` and `grid.js` so the module degrades gracefully if removed.
- **Sort panel uses `PanelSystem.getPanelBody('sort-filter')`** to refresh panel content after state changes regardless of dock location (right, bottom, float).
