# static/engine/js/sidebar.js

**Description:** Thin backward-compatibility adapter. All methods forward to `PanelSystem`. Allows `grid.js` and `flags.js` to keep using `SidebarManager.open(title)` / `SidebarManager.setContent(html)` without changes.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1–3 | module comment | Explains adapter role and silent-open contract |
| 4 | `_ID_MAP` | Maps legacy title strings to panel IDs: History/LOG→history, Flags/FLAG MANAGER→flags, Info→info |
| 13 | `_idFor(title)` | Looks up ID from map; falls back to 'info' |
| 15 | `toggle()` | → `PanelSystem.togglePanel('info')` |
| 16 | `open(title)` | → `PanelSystem.showPanel(id, { silent: true })` — skips onActivate so callers fill body themselves |
| 17 | `close()` | → `PanelSystem.closeAll()` |
| 19–22 | `isOpen()` | Reads `.sidebar-closed` class from `#sidebar-panel` DOM directly |
| 24–27 | `setTitle(title)` | Writes directly to `#sidebar-title` (no PanelSystem involvement) |
| 29–32 | `setContent(html)` | Writes directly to `#sidebar-body` innerHTML |
| 34–36 | `clearContent()` | Calls `setContent` with empty placeholder |

## Decisions

- **`open()` uses `silent: true`**: `flags.js` calls `SidebarManager.open('Flags')` then immediately overwrites the body with `setContent(html)`. Without silent, `PanelSystem.showPanel` would fire the `onActivate` callback which would overwrite the caller's content. See `panel_system.js.md` for the full contract.
- **Direct DOM writes for `setTitle`/`setContent`**: These methods don't need PanelSystem involvement — they write directly to the DOM elements that PanelSystem also manages. PanelSystem re-sets `sidebar-title` only when `_applyLayout` runs, so direct writes are safe in between.
- **Cell LOG CSS classes** (defined in `sidebar.css`): `.sidebar-log-meta`, `.sidebar-log-label`, `.sidebar-log-value`, `.sidebar-log-list`, `.sidebar-log-entry`, `.sidebar-log-ts`, `.sidebar-log-change`, `.sidebar-log-empty`, `.sidebar-log-type`, `.sidebar-log-rollback`, `.sidebar-log-actions`, `.sidebar-log-group`, `.sidebar-log-group-header`, `.sidebar-log-row-label`.
