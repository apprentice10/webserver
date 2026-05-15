# static/engine/js/panels/panel-tab-bar.js

**Description:** Tab bar subsystem for `PanelSystem`. Renders the tab strip for both the right dock and bottom dock, wires click/drag/drop events, handles tab reorder (drag within bar) and tab-to-float (drag off bar), and exposes `activateTabIn` for external callers. Extracted from `panel_system.js` in P4-P2.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1 | `PanelTabBar` IIFE | Module declaration |
| 1–10 | Private vars | Injected deps + `_dragId` / `_dragDropped` drag state |
| 12–22 | `configure(deps)` | One-time init; called from `PanelSystem.init()` before `_applyLayout()` |
| 25–35 | `_tabsHtml(tabs, activeTab)` | Shared HTML builder for tab buttons; produces draggable `<button>` elements |
| 38–50 | `renderTabBar(tabs, activeTab)` | Creates/updates right dock `.panel-tab-bar`; wires events |
| 52–63 | `renderBottomTabBar(tabs, activeTab)` | Creates/updates bottom dock `.panel-tab-bar`; wires events |
| 66–107 | `_initTabBarEvents(bar, dockName)` | Wires: click→activate, dragstart/dragend (drag-to-float if dropped outside), dragover/drop (reorder within bar), close button |
| 109–117 | `_reorderTabIn(dockName, dragId, targetId)` | Splice reorder within named dock; saves + re-renders |
| 120–127 | `activateTabIn(dockName, id)` | Set `activeTab`, save, re-render, call `onActivate` with correct body element. Called by tab click and `PanelSystem.togglePanel`. |

## Decisions

- **`activateTabIn` is public**: `PanelSystem.togglePanel` calls it for inactive-tab activation; it was `_activateTabIn` (private) in `panel_system.js` before extraction.
- **`_dragId` / `_dragDropped` moved here**: these vars track the in-progress tab drag; they were in `panel_system.js` IIFE scope before, but are only read/written by tab bar event handlers.
- **`_applyLayout` injected**: `_reorderTabIn` must re-render after reorder; `applyLayout` is passed as a dep rather than called via `PanelSystem` to avoid a public-API round-trip.
- **`moveToFloat` injected**: dragend handler calls `_moveToFloat(_dragId, x, y)` when a tab is dropped outside the bar; this is a forward ref to `PanelSystem.moveToFloat`, safe at call time.
