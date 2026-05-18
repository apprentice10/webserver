---
name: mto_export.js
description: MTO export dialog IIFE — centered modal for selecting typicals, checking name conflicts, resolving them per-item, and exporting to an external project DB.
type: module
---

# engines/mto_v1/static/js/mto_export.js

**Description:** Self-contained IIFE that renders a centered overlay modal. The user enters a destination `.db` file path, selects typicals via checkboxes, and clicks Export. Before calling the backend, the dialog checks for name conflicts. If any are found, it renders an inline resolution row per conflict (Overwrite or Rename); the Export button stays disabled until every conflict is resolved.

## Index

| Symbol | Lines | Description |
|--------|-------|-------------|
| `_conflictItems` | state | `null` = not yet checked; `[]` = no conflicts; `[{name,id,mode,newName}]` = pending resolutions. |
| `_buildModal` | ~15–55 | Creates overlay + dialog DOM once (lazy); includes `.mto-export-conflicts` section between list and footer. |
| `_loadTypicals` | ~58–73 | Fetches `GET /api/engines/mto/{tool_id}/typicals?db=…` and delegates to `_renderList`. |
| `_renderList` | ~75–95 | Renders one `label.mto-export-row` per typical (pre-checked). Checkbox change calls `_resetConflicts`. |
| `_syncToggleLabel` | ~97–102 | Updates "Select all / Deselect all" toggle label. |
| `_toggleAll` | ~104–109 | Inverts all checkboxes, then resets conflict state. |
| `_resetConflicts` | ~113–119 | Clears `_conflictItems`, empties conflict section, calls `_updateExportBtn`. |
| `_allResolved` | ~121–125 | Returns true when every conflict item is either "overwrite" or "rename" with a non-empty new name. |
| `_updateExportBtn` | ~127–135 | Sets button label ("Export" / "Confirm Export") and disabled state. |
| `_renderConflicts` | ~137–183 | Renders one conflict row per conflicting name with Overwrite/Rename radios and a text input. |
| `_doExport` | ~185–211 | Three-phase dispatcher: check → show conflicts → execute (or execute immediately if no conflicts). |
| `_runConflictCheck` | ~213–240 | Calls `GET /export/check`, then `_renderConflicts`. If no conflicts, calls `_executeExport` directly. |
| `_executeExport` | ~242–278 | `POST /{tool_id}/export` with `rename_map` built from resolved conflict items. Shows per-typical error list or success toast. |
| `open` | ~281–291 | Resets state, clears conflict section, loads typicals. |
| `close` | ~293–295 | Removes `.open` class. |
| DOMContentLoaded | ~297–300 | Wires `#btn-export-typical` topbar button. |

## Decisions

- **Modal, not slide-in panel**: export is a multi-step action that warrants a centered dialog blocking interaction until dismissed.
- **Pre-check all**: default is to export everything; the user opts out per typical.
- **Check-then-confirm flow**: conflict check (`GET /export/check`) is deferred to the first Export click, not on path-input change, to avoid spurious requests before the user is done typing.
- **Path/selection change resets conflict state**: any change to destination path or checkbox selection clears `_conflictItems` and the conflict section so stale results are never shown.
- **Always sends `conflict_strategy: "overwrite"`**: renamed typicals get a new `target_name` via `rename_map` and land as new rows in the destination (no conflict on arrival). The overwrite flag handles the remaining items that the user explicitly chose to overwrite.
- **Overlay click closes modal**: clicking outside the dialog dismisses it.
- **No tab bar reload after export**: typicals are only copied to the destination DB — the source tool is unchanged.
