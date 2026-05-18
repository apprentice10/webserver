# static/engine/js/panels/panel-floats.js

**Description:** Float window subsystem for `PanelSystem`. Manages creation, drag-to-reposition, resize, and proximity-snap-to-dock (K-7) for all floating panels. Extracted from `panel_system.js` in P4-P1.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 1 | `PanelFloats` IIFE | Module declaration |
| 1–9 | Private vars | Injected deps: `_state`, `_registry`, constants, DOM getters, `_dockPanel`, `_hidePanel`, `_saveState`; `_dropTarget` proximity state |
| 11–19 | `configure(deps)` | One-time init; called from `PanelSystem.init()` before `_applyLayout()` |
| 22–30 | `_getFloatLayer()` | Lazy-creates `#panel-float-layer` div in `document.body` |
| 33–41 | `_getDropHighlight()` | Lazy-creates `#panel-drop-highlight` div (K-7 overlay) |
| 43–62 | `_checkProximity(cx, cy)` | On every float drag move: checks cursor against open dock bounding rects ± `SNAP_DIST`; calls `_showDropHighlight` / `_hideDropHighlight` |
| 64–78 | `_showDropHighlight(dockName)` | Positions and shows `.dock-drop-highlight` overlay; sets `_dropTarget` |
| 80–84 | `_hideDropHighlight()` | Removes `visible` class; clears `_dropTarget` |
| 87–116 | `_initFloatDrag(el, id)` | Mousedown on titlebar → drag loop; calls `_checkProximity` on move; on mouseup docks to `_dropTarget` (if set) or saves position |
| 118–133 | `_initFloatResize(el, id)` | Bottom-right resize handle; saves on mouseup |
| 135–155 | `_createFloatEl(id)` | Builds float DOM (titlebar / body / resize); wires dock-to-bottom, dock-to-right, close buttons |
| 158–182 | `render()` | Reconciles `_state.floats` against DOM: removes stale floats, creates new ones, applies position/size |

## Decisions

- **`_getFloatLayer` moved here**: only `render()` uses it; kept internal so panel_system.js doesn't carry a float-only helper.
- **`_dropTarget` private to this module**: the float drag is the only consumer of proximity snap; tab bar drag (handled by `PanelTabBar`) has its own `_dragDropped` logic that calls `moveToFloat` directly.
- **State by reference**: `configure` receives the live `_state` object. All mutations on `_state.floats[i].x/y/w/h` propagate back to `PanelSystem` automatically (same object reference).
- **`dockPanel` / `hidePanel` injected as forward refs**: these public API functions exist as named closures inside `PanelSystem`; passing them at `init()` time is safe because they are called only at runtime (user interaction), not at configure time.
