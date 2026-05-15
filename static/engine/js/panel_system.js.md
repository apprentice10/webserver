# static/engine/js/panel_system.js

**Description:** Panel system IIFE. Manages a right dock (tabbed sidebar), a bottom dock zone, and floating windows with registry, open/close/toggle, and localStorage layout persistence. K-5 (bottom dock), K-6 (sidebar resize), K-7 (proximity snap) are coordinated here; float rendering is delegated to `PanelFloats`, tab bar rendering to `PanelTabBar`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1 | `PanelSystem` IIFE | Module declaration |
| 10–14 | Constants / state vars | `FLOAT_W/H`, `SNAP_DIST` (48px), `_registry`, `_state` |
| 17–44 | `_loadState` | Reads localStorage; migrates v2→v3→v4 (`bottomDock` added in v4); returns default if missing |
| 43–45 | `_saveState` | Persists `_state` to localStorage |
| 49–53 | DOM accessors | `_getDock/Body/TitleEl`, `_getBottomDock/Body` — shared helpers passed to sub-modules |
| 57–61 | `_applyLayout` | Delegates to `_applyRightDock`, `_applyBottomDock`, `PanelFloats.render()` |
| 63–75 | `_applyRightDock` | Sets `sidebar-closed` class, `--sidebar-width` prop, calls `PanelTabBar.renderTabBar`, updates title |
| 77–91 | `_applyBottomDock` | Sets `bottom-dock-closed` class, `--bottom-dock-height`, calls `PanelTabBar.renderBottomTabBar`, updates title; shows header only for single-panel dock |
| 95–121 | `_initSidebarResize` | K-6: mousedown on `#sidebar-resize-handle`; drag left → wider; disables transition during drag; saves on mouseup |
| 123–153 | `_initBottomResize` | K-5: mousedown on `#bottom-dock-resize-handle`; drag up → taller; re-opens if panels exist |
| 157 | `register(config)` | Add panel to registry |
| 159–160 | `getExtra(key) / setExtra(key, value)` | Read/write arbitrary extra fields into `_state.extra` and save; used by ColumnsManager for `hiddenColumns` and `columnOrder` |
| 162–203 | `showPanel(id, opts)` | Checks existing location first (float → dock) before using caller's `opts.dock` hint; `opts.silent` skips `onActivate` |
| 188–220 | `hidePanel(id)` | Remove from floats, then bottom dock, then right dock; closes dock if empty; calls `onActivate` on newly-exposed active tab |
| 222–226 | `_refreshDockBody(dockName, id)` | Calls `onActivate` for the panel that became active after another was hidden |
| 228–247 | `moveToFloat(id, x, y)` | Remove from both docks, push to `floats` array; calls `onActivate` on newly-exposed tab in each dock |
| 249–272 | `dockPanel(id, target)` | Remove from floats + other dock; add to target dock; call `onActivate` |
| 274–284 | `closeAll` | Clear all panels and floats in both docks |
| 286–292 | `closeBottomDock` | Clear only the bottom dock |
| 294–307 | `togglePanel(id)` | Float→hide; dock present+active→hide; dock present+inactive→`PanelTabBar.activateTabIn`; absent→open in right dock |
| 309–313 | `isPanelOpen / isActivePanel / allPanels` | Query helpers; check both docks + floats |
| 321–328 | `getPanelBody(id)` | Returns the live body DOM element for any panel: float body, right dock body, or bottom dock body |
| 330–349 | `init` | Configure `PanelFloats` + `PanelTabBar`; restore layout; wire sidebar close button; call resize inits |

## Sub-modules

| Module | Responsibility |
|--------|---------------|
| `panels/panel-floats.js` | Float create/drag/resize/proximity-snap; `render()` reconciles DOM against `_state.floats` |
| `panels/panel-tab-bar.js` | Tab HTML, render, drag-to-reorder, drag-to-float, close, `activateTabIn` |

## State shape (v4)

```js
{
  version: 4,
  rightDock:  { open: bool, width: 320, activeTab: string|null, tabs: string[] },
  bottomDock: { open: bool, height: 200, activeTab: string|null, tabs: string[] },
  floats: [{ id: string, x: number, y: number, w: number, h: number }],
  extra: { hiddenColumns: string[], columnOrder: string[] }  // optional, written by ColumnsManager
}
```

Migration chain: v2 → v3 (added `floats: []`) → v4 (added `bottomDock`). `extra` field added without version bump — safe because readers use `|| {}` guard.

## Bottom dock HTML structure (table.html)

```
#bottom-dock (.bottom-dock, positioned after .tool-body)
  .bottom-dock-resize-handle  — 5px in-flow top bar, cursor: row-resize
  .bottom-dock-header         — title + close button (shown only when 1 tab, hidden when 2+)
  .panel-tab-bar              — injected dynamically before #bottom-dock-body
  #bottom-dock-body           — panel content area
```

## Panel content registration (table.html)

The `info`, `log`, `flags`, `notes`, `sql` panels are registered in `templates/engine/table.html` (DOMContentLoaded block).

- **`info` panel**: `onActivate(body)` calls `_refreshInfo(body)` — container-agnostic.
- **`log` panel**: same pattern.
- **Legacy `open(title)+setContent(html)` path**: `SidebarManager.open()` calls `showPanel(id, { silent: true })`, then callers fill `#sidebar-body` directly. This always targets the right dock body — not portable to bottom dock.

## Decisions

- **`opts.dock='bottom'`**: caller hint used only when panel is not currently in any dock or float. If the panel already has a location, it is activated there regardless of hint. This prevents panels from ending up in two docks simultaneously.
- **Proximity snap only when dock has tabs (K-7)**: `_checkProximity` (in PanelFloats) checks `tabs.length > 0`; empty docks don't attract floats.
- **CSS custom properties for dock size**: `--sidebar-width` and `--bottom-dock-height` set inline on dock elements. `.sidebar-closed / .bottom-dock-closed` class rules win via specificity.
- **`closeBottomDock`**: exposed so the bottom dock close button only closes the bottom dock, not the right dock (unlike `closeAll`).
- **Tab bar hidden when only one panel**: single-tab dock shows `.bottom-dock-header` instead. Two+ tabs: header hidden, tab bar shown.
- **Transition disabled during resize drag**: `dock.style.transition = 'none'` set on mousedown, restored on mouseup.
- **Float position persisted on mouseup only**: not on every mousemove to avoid localStorage thrashing.
- **Sub-module configure pattern**: `PanelFloats` and `PanelTabBar` receive `_state` by object reference — mutations propagate back. Public API functions (`dockPanel`, `hidePanel`, `moveToFloat`) are passed as forward refs, safe because they are closures already defined before `init()` runs.
