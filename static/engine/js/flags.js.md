# static/engine/js/flags.js

**Description:** IIFE module for the FLAG management sidebar panel. Renders a list of all project flags (system + user), allows creating, renaming, recoloring, and deleting non-system flags.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| `_flagItemHtml(flag)` | Renders one flag row: color picker, name input (disabled if system), system badge, delete button |
| `_render(flags)` | Builds the full flag list HTML |
| `_addFormHtml()` | Inline "add new flag" form at the bottom of the panel |
| `show()` | Opens sidebar, fetches flags via `ApiClient.listFlags()`, renders content |
| `submitCreate()` | Reads name/color from add-form inputs, calls `ApiClient.createFlag`, refreshes panel |
| `saveColor(flagId, color)` | Called on color `<input type=color>` change; sends PATCH |
| `saveName(flagId, name)` | Called on name input blur; sends PATCH; no-op if blank (refreshes panel) |
| `confirmDelete(flagId, flagName)` | Confirm-then-DELETE; removes flag from cells via `GridManager.removeFlagFromCells`; refreshes panel |
| `toggleHide(flagId)` | Adds/removes flagId from `_hiddenIds`; updates eye button CSS; calls `GridManager.render()` |
| `getHiddenIds()` | Returns the `Set<number>` of currently hidden flag IDs; consumed by `GridManager._flagBadgesHtml` |

## Decisions

- **Inline editing via blur/change**: no explicit "Save" button per row — color applies on `change`, name applies on `blur` or Enter. Keeps the UI compact inside the 320px sidebar.
- **System flags**: color editable (color `<input>` enabled), name disabled (`disabled` attr). Delete button omitted entirely (not just disabled) to avoid confusion.
- **Full re-render on mutation**: `show()` is called again after create/delete/error — simpler than patching DOM in place; list is always small (tens of flags).
- **Load order**: loaded after `sidebar.js` (dep: `SidebarManager`), before `sql_editor.js`. Depends on `ApiClient` (api.js) and `Utils` (utils.js).
