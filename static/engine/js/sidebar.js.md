# static/engine/js/sidebar.js

**Description:** IIFE module managing the collapsible right-side sidebar panel. Provides open/close/toggle and content injection API for future sections (LOG, FLAGS).

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 1–5            | Module declaration, `_isOpen` state |
| 8–10           | `toggle()` — open if closed, close if open |
| 12–21          | `open(title)` — remove `sidebar-closed` class, set title, mark button active |
| 23–28          | `close()` — add `sidebar-closed` class, remove active from button |
| 30–32          | `isOpen()` — returns internal state |
| 35–46          | `setTitle(html)`, `setContent(html)`, `clearContent()` — content injection API for future sections |
| 48             | Public API export |

## Decisions

- **CSS class toggle only**: open/close uses `sidebar-closed` class on `#sidebar-panel` (no inline style), matching the project's CSS toggle pattern (`toggleLog`, `toggleRev`). Width transition in CSS ensures smooth animation without JS timers.
- **Content injection API**: `setContent(html)` / `clearContent()` are used by callers. Pattern: `SidebarManager.open('LOG'); SidebarManager.setTitle('LOG — col'); SidebarManager.setContent(html)`. The sidebar does not own the LOG logic — `grid.js::showCellLog` builds and injects the HTML.
- **Load order**: loaded after `toolbar.js`, before `sql_editor.js`. Has no deps on other modules.
- **Cell LOG CSS classes** (defined in `sidebar.css`): `.sidebar-log-meta` (column/row header grid), `.sidebar-log-label`, `.sidebar-log-value`, `.sidebar-log-list` (ul), `.sidebar-log-entry` (li), `.sidebar-log-ts`, `.sidebar-log-change`, `.sidebar-log-empty`.
