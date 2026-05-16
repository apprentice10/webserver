# static/engine/js/flags.js

**Description:** IIFE module for the FLAG management sidebar panel. Renders flag list, allows create/rename/recolor/delete of non-system flags, and manages conditional flag rules.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| `_flagItemHtml(flag)` | Renders one flag row: color picker, name input, system badge, eye/delete buttons |
| `_render(flags)` | Builds the full flag list HTML |
| `_addFormHtml()` | Inline "add new flag" form |
| `_ruleItemHtml(rule)` | Renders one conditional rule row: col + operator + value → flag + delete button |
| `_rulesHtml(rules)` | Builds the full rules list HTML |
| `_ruleFormHtml(flags, columns)` | Builds the rule builder form (col/operator/value/flag selects + add button) |
| `_previewCount(colSlug, operator, value)` | Counts active rows that match the rule criteria (client-side, no fetch) |
| `_toggleRuleValue()` | Shows/hides the value input based on operator (hidden for `is_empty`) |
| `_updatePreviewCount()` | Updates the "X rows match" counter below the rule form |
| `show()` | Opens sidebar, fetches flags + rules in parallel, renders all sections |
| `submitCreate()` | Creates a new flag and refreshes |
| `saveColor(flagId, color)` | Sends PATCH on color change |
| `saveName(flagId, name)` | Sends PATCH on name blur; no-op if blank |
| `confirmDelete(flagId, flagName)` | Confirm-then-DELETE; removes flag from cells locally; refreshes |
| `toggleHide(flagId)` | Adds/removes flagId from `_hiddenIds`; updates eye button; calls `GridManager.render()` |
| `getHiddenIds()` | Returns `Set<number>` of hidden flag IDs; consumed by `GridRenderer.flagBadgesHtml` |
| `addRule()` | Reads form inputs, calls `ApiClient.createFlagRule`, refreshes |
| `deleteRule(ruleId)` | Confirm-then-DELETE rule, refreshes |
| `_toggleRuleValue` | Exposed on public API so `onchange` in the form HTML can call it |

## Decisions

- **Inline editing via blur/change**: no explicit Save button per flag row; color applies on `change`, name applies on `blur`/Enter.
- **System flags**: color editable, name disabled, delete button omitted.
- **Full re-render on mutation**: `show()` called again after create/delete/error — simpler than patching DOM; list always small.
- **Conditional rules are tool-scoped**: `ApiClient.listFlagRules()` and friends use `TOOL_ID` from api.js.
- **Preview count is client-side**: uses `GridManager.getAllRows()` — no network round-trip; same wildcard logic as backend.
- **`addRule`/`deleteRule` call `GridManager.reloadData()`**: rules are evaluated server-side in `get_rows`; a full reload is the only way to see them applied in the grid immediately after a change.
- **`_toggleRuleValue` on public API**: the form's `onchange="FlagsManager._toggleRuleValue()"` needs it; the leading `_` signals internal use but it must be exported for inline HTML handlers.
- **Load order**: after `sidebar.js`, before `sql_editor.js`. Depends on `ApiClient`, `Utils`, `ColumnsManager`, `GridManager`.
