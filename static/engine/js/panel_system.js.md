# static/engine/js/panel_system.js

**Description:** Panel system IIFE. Manages a right dock (tabbed sidebar), a bottom dock zone, and floating windows with registry, open/close/toggle, drag-and-drop tab reorder, drag-to-float, and localStorage layout persistence. K-5 (bottom dock), K-6 (sidebar resize), K-7 (proximity snap) are all implemented here.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1 | `PanelSystem` IIFE | Module declaration |
| 2–8 | Constants / state vars | `STORAGE_KEY`, `FLOAT_W/H`, `SNAP_DIST` (48px), `_registry`, `_state`, `_dragId`, `_dragDropped`, `_dropTarget` |
| 11–37 | `_loadState` | Reads localStorage; migrates v2→v3→v4 (`bottomDock` added in v4); returns default if missing |
| 39–41 | `_saveState` | Persists `_state` to localStorage |
| 45–55 | DOM accessors | `_getDock/Body/TitleEl`, `_getBottomDock/Body`, `_getFloatLayer` (lazy-creates `#panel-float-layer`) |
| 59–61 | `_applyLayout` | Delegates to `_applyRightDock`, `_applyBottomDock`, `_renderFloats` |
| 63–75 | `_applyRightDock` | Sets `sidebar-closed` class, applies `--sidebar-width` custom property, renders tab bar, updates title |
| 77–90 | `_applyBottomDock` | Sets `bottom-dock-closed` class, applies `--bottom-dock-height`, renders bottom tab bar, updates title; shows header only for single-panel dock |
| 94–102 | `_tabsHtml` | Shared HTML builder for tab buttons (both docks) |
| 104–114 | `_renderTabBar` | Creates/updates right dock `.panel-tab-bar`; inserts before `#sidebar-body` |
| 116–127 | `_renderBottomTabBar` | Creates/updates bottom dock `.panel-tab-bar`; inserts before `#bottom-dock-body` |
| 129–166 | `_initTabBarEvents(bar, dockName)` | Wires click (activate), close, dragstart/dragend (drag-to-float), dragover/drop (reorder) for either dock |
| 168–177 | `_reorderTabIn(dockName, dragId, targetId)` | Splice reorder within the named dock |
| 179–186 | `_activateTabIn(dockName, id)` | Set activeTab, save, re-render, call `onActivate` with correct body element |
| 190–215 | `_renderFloats` | Creates/destroys `.panel-float` elements in `#panel-float-layer`; applies position/size |
| 217–234 | `_createFloatEl(id)` | Builds float DOM (titlebar / body / resize handle); wires dock-to-bottom, dock-to-right, and close buttons |
| 236–258 | `_initFloatDrag(el, id)` | Mousedown drag for float position; calls `_checkProximity` on every mousemove (K-7); on mouseup, docks to `_dropTarget` if set |
| 260–277 | `_initFloatResize(el, id)` | Bottom-right resize; saves on mouseup |
| 281–300 | `_getDropHighlight / _checkProximity` | K-7: creates `#panel-drop-highlight`; checks cx/cy against open dock bounding rects ± SNAP_DIST |
| 302–314 | `_showDropHighlight / _hideDropHighlight` | Positions and shows/hides `.dock-drop-highlight` overlay; sets `_dropTarget` |
| 318–356 | `_initSidebarResize` | K-6: mousedown on `#sidebar-resize-handle`; drag left → wider; disables transition during drag; saves on mouseup |
| 358–382 | `_initBottomResize` | K-5: mousedown on `#bottom-dock-resize-handle`; drag up → taller; same pattern as sidebar resize |
| 386 | `register(config)` | Add panel to registry |
| 388–405 | `showPanel(id, opts)` | Open dock + activate; `opts.dock='bottom'` targets bottom dock; `opts.silent` skips `onActivate`; floating panels refreshed in-place |
| 407–430 | `hidePanel(id)` | Remove from floats, then bottom dock, then right dock; closes dock if empty; calls `onActivate` on newly-exposed active tab |
| 432–450 | `moveToFloat(id, x, y)` | Remove from both docks, push to `floats` array; calls `onActivate` on newly-exposed tab in each dock |
| 447–463 | `dockPanel(id, target)` | Remove from floats + other dock; add to target dock; call `onActivate` |
| 465–474 | `closeAll` | Clear all panels and floats in both docks |
| 476–481 | `closeBottomDock` | Clear only the bottom dock |
| 483–494 | `togglePanel(id)` | Float→hide; dock present+active→hide; dock present+inactive→activate; absent→open in right dock |
| 496–502 | `isPanelOpen / isActivePanel / allPanels` | Query helpers; check both docks + floats |
| 504–510 | `getPanelBody(id)` | Returns the live body DOM element for any panel: float body, right dock body, or bottom dock body; used by table.html `_getPanelContainer` |
| 506–512 | `init` | Restore layout; wire sidebar close button; call `_initSidebarResize` + `_initBottomResize` |

## State shape (v4)

```js
{
  version: 4,
  rightDock:  { open: bool, width: 320, activeTab: string|null, tabs: string[] },
  bottomDock: { open: bool, height: 200, activeTab: string|null, tabs: string[] },
  floats: [{ id: string, x: number, y: number, w: number, h: number }]
}
```

Migration chain: v2 → v3 (added `floats: []`) → v4 (added `bottomDock`).

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

- **`opts.dock='bottom'`**: panels opened with this option go to the bottom dock; default is right. `togglePanel` always defaults to right for initial opens.
- **Proximity snap only when dock has tabs (K-7)**: `_checkProximity` checks `tabs.length > 0`; empty docks don't attract floats. Avoids accidental docking when dragging near viewport edges.
- **CSS custom properties for dock size**: `--sidebar-width` and `--bottom-dock-height` are set inline on the dock elements. `.sidebar-closed / .bottom-dock-closed` class rules (`width: 0 / height: 0`) win via specificity, so the custom property doesn't fight with the closed state.
- **`closeBottomDock`**: exposed so the bottom dock close button only closes the bottom dock, not the right dock (unlike `closeAll`).
- **`panel-float-dock-bottom` button**: every floating panel titlebar has both a "Dock to right" (⤵) and "Dock to bottom" (⊟) button; this is the only way to initially populate the bottom dock, since `togglePanel` always opens panels in the right dock.
- **`bottom-dock-closed` shows 5px (not 0)**: keeps the resize handle strip always visible and draggable. If the user drags up while `tabs.length > 0`, the dock re-opens. If tabs is empty the handle exists but resizing has no effect (dock stays visually empty).
- **Tab bar hidden when only one panel**: single-tab dock shows the `.bottom-dock-header` title bar instead. Two or more tabs: header hidden, tab bar shown.
- **Transition disabled during resize drag**: `dock.style.transition = 'none'` set on mousedown, restored on mouseup; prevents the CSS transition from fighting the drag.
- **Float position persisted on mouseup only**: not on every mousemove to avoid localStorage thrashing.
