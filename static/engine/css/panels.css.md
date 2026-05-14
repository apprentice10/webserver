# static/engine/css/panels.css

**Description:** Content styles for all dockable/floating panel bodies registered with `PanelSystem`: Notes, Cell info, History (timeline), Flags, and SQL Editor. Does not define panel chrome (that lives in `panel_system.css`).

## Index (~313 lines)

| Lines | Symbol / Section |
|-------|-----------------|
| 1–36 | Notes panel: `.panel-notes-input`, `.panel-placeholder` |
| 39–64 | Cell info header: `.panel-cell-header`, `.panel-cell-tag-label`, `.panel-cell-tag-val` |
| 67–77 | Range header: `.panel-range-header` |
| 81–96 | Shared utilities: `.panel-divider`, `.panel-section-label` |
| 99–137 | Meta grid (Info panel): `.panel-meta-grid`, `.panel-meta-row`, `.panel-meta-key`, `.panel-meta-val`, `.panel-meta-muted`, `.panel-meta-etl` |
| 140–157 | Lineage badges: `.panel-lineage-etl`, `.panel-lineage-manual`, `.panel-lineage-override` |
| 160–197 | Distinct values list: `.panel-dv-list`, `.panel-dv-item`, `.panel-dv-value`, `.panel-dv-tag` |
| 199–281 | Timeline (History panel): `.panel-timeline`, `.panel-tl-{change_type}` colour rules on `.panel-hist-subgroup-tag`, `.panel-tl-header`, `.panel-tl-time`, `.panel-tl-rollback-btn`, `.panel-tl-change`, `.panel-tl-old`, `.panel-tl-new`, `.panel-tl-arrow` |
| 283–313 | History grouped view: `.panel-hist-group`, `.panel-hist-group-col`, `.panel-hist-subgroup`, `.panel-hist-subgroup-tag` |

## Decisions

- **`panel-hist-group` structure (not dot/item/col)**: The timeline was redesigned from a flat dot-per-entry layout to a grouped `panel-hist-group → panel-hist-subgroup → panel-hist-subgroup-tag + panel-tl-header + panel-tl-change` nesting. This mirrors the JS `_renderTimeline()` output in `templates/engine/table.html` and supports both single-cell (flat) and range (grouped by col/row) history views.
- **Rollback button opacity-on-hover**: `.panel-tl-rollback-btn` is invisible (`opacity:0`) by default and becomes visible only when the parent `.panel-hist-group` is hovered. This avoids visual clutter while keeping the button discoverable. The hover trigger is on `.panel-hist-group:hover`, not on the button itself, so the button stays visible while the user moves the cursor to click it.
- **Change-type colours via `panel-tl-{ct}` class on group**: Colour is applied to `.panel-hist-subgroup-tag` using a parent-class selector (e.g. `.panel-tl-edit .panel-hist-subgroup-tag`). This avoids inline styles and allows theming. The class is generated from `e.change_type || e.action` in JS.
- **Panel chrome separation**: Visual structure of the panel frame (tab bar, dock header, resize handle) is in `panel_system.css`. This file only styles the scrollable body content injected by `onActivate` callbacks. Never mix chrome and content styles here.
- **CSS custom property fallbacks**: Every `var()` uses a fallback (e.g. `var(--border, var(--color-border))`) for forward-compatibility if the design token set changes.
