# sidebar_groups.js

## Description

IIFE that owns the group popover UI and group/engine drag-drop assignment logic. Extracted from `main.js` to keep group-specific code isolated and prevent `main.js` from exceeding the 400-line limit.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 5 | `ICONS` | Shared 18-emoji set — same set used in `app_shell.js` tool popover |
| 12 | `openGroupPopover(anchor, opts)` | Renders group create/edit popover anchored below `anchor`; calls `opts.onSave(name, icon)` on confirm |
| 80 | `closeGroupPopover()` | Removes popover from DOM |
| 84 | `_draggedGroupId` | Module-private drag state for group reordering |
| 86 | `onGroupDragStart` | Sets `_draggedGroupId`; stops propagation so engine drag state in `main.js` is not overwritten |
| 92 | `onGroupDrop` | Reorders dragged group by patching its position to the target group's position |
| 110 | `onEngineDropToGroup` | Assigns a dragged engine to a group via PATCH `/engines/{id}/group` |

## Decisions

- Uses `escapeAttr` from `main.js` global scope (both files load in the same HTML page; no import).
- `onGroupDrop` fetches the fresh group list to resolve the target's current `position` rather than trusting stale client-side state — groups can shift between render and drop.
- `_draggedGroupId` is guarded in `onEngineDropToGroup` so that a group drag landing on a group header does not also trigger engine re-assignment.
