---
name: undo-manager
description: Frontend undo/redo controller — Ctrl+Z/Y keyboard, toolbar buttons, stack state
type: project
---

# engines/sheet_v1/static/js/undo/undo-manager.js

**Description:** IIFE that wires Ctrl+Z (undo) and Ctrl+Y (redo) to the backend undo/redo endpoints, and keeps the toolbar buttons disabled/enabled in sync.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 5–6 | `_canUndo`, `_canRedo` | Local state mirroring server stack availability |
| 8–22 | `_updateButtons`, `_applyState`, `refreshState` | Read `{can_undo, can_redo}` from server and update DOM buttons |
| 28–44 | `undo()`, `redo()` | Call API, apply returned state, reload grid, show toast |
| 47–58 | `_onKeyDown` | Captures Ctrl+Z / Ctrl+Y only when NOT in cell edit mode |
| 61–67 | `init()` | Attaches keyboard listener, subscribes to `undo:updated` event, calls `refreshState` |

## Decisions

- **`CellKeyboard.isEditing()` guard**: browser-native undo inside a text input must not be intercepted. The guard lets the input handle its own undo until the user commits or escapes.
- **`undo:updated` custom event**: dispatched by `cell-save.js`, `row-ops.js`, and `grid.js` after every mutation. Keeps button state current without polling or modifying every API call.
- **Full grid reload on undo/redo**: simpler than patching individual rows. Acceptable since undo/redo is a deliberate, low-frequency action.
