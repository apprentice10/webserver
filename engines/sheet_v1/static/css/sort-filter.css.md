---
Description: Styles for the Sort & Filter subsystem — column header controls, per-column filter dropdowns, and the Sort panel dock.
Index:
  L5-53:  Column header sort/filter controls — `.th-label.th-sortable`, `.th-sort-arrow`, `.th-sort-badge`, `.th-filter-btn`; `.sf-filter-active` signals a live filter on that column.
  L55-249: Filter dropdown — `.sf-filter-dropdown` positioned absolutely under the header; includes search terms, checkbox list, pattern list, and foot actions.
  L250-363: Sort panel — `.sf-panel` floats as a dock panel; `.sf-sort-row` per sort rule, `.sf-add-row` button, `.sf-apply` / `.sf-clear`.
Decisions:
  - Lives in `engines/sheet_v1/static/css/` rather than `static/engine/css/` because the sort-filter JS (now shared in `static/engine/js/grid/sort-filter/`) hasn't had its CSS co-located yet. Move here when the shared CSS structure is defined (planned for Group P).
  - `.sf-filter-active` class is toggled by JS (`SortFilterManager.updateHeaderIndicators`) so the column header visually indicates a live filter without a DOM query on every render.
---
