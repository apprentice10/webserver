# Frontend Patterns and Pitfalls

## IIFE module pattern

Every JS file is a self-contained IIFE: `const ModuleName = (() => { ... return { public }; })();`
Modules communicate via public APIs (`GridManager.render()`, `ColumnsManager.getColumns()`).
Globals `PROJECT_ID` and `TOOL_ID` are injected by Jinja2 into the page template.

## CSS class toggle vs re-render

**Prefer CSS class toggles** over re-rendering the DOM when possible:
- `toggleLog()` adds `.log-hidden` class to `#data-grid` — no `render()` call needed
- `toggleDeleted()` must call `render()` because the set of visible rows changes
- The CSS class persists across `tbody.innerHTML` re-writes because the `<table>` element itself is never replaced

**Required**: cells that need CSS-class hiding must have a `data-slug="log"` (or equivalent) attribute. Rule: `.data-grid.log-hidden [data-slug="log"] { display: none; }`

## Drag-and-drop vs resize conflict

`<th draggable="true">` intercepts mousedown on ALL child elements, including `.resize-handle`.
**Fix** (both are needed):
1. Add `draggable="false"` to `.resize-handle` div in `columns.js::renderHeader()`
2. In `dragstart` listener, check `if (e.target.classList.contains("resize-handle")) { e.preventDefault(); return; }`

**Why:** Without both fixes, clicking the resize handle starts a column drag instead of a resize.

## Context menu pattern

Right-click context menu lives in `#row-context-menu` (added to `table.html`).
State: `_ctxRowId` variable in `grid.js`. Initialized once via `_initContextMenu()` called from `init()`.
Items have `data-action` attributes (`delete`, `restore`, `hard-delete`, `log`).
`GridManager.openContextMenu(e, rowId)` is called via `oncontextmenu` inline attribute on `<tr>`.

## Script load order in table.html

Order is strict — dependencies must load before dependents:
```
utils.js → api.js → columns.js → resize.js → paste.js → grid.js → toolbar.js → sql_editor.js
```
`utils.js` must be first (provides `escHtml`, `showToast`, `formatTimestamp` used by all others).

## showToast è globale via Utils

`showToast(msg, type)` è definita in `utils.js` come `Utils.showToast`. Tutti i moduli la chiamano direttamente come `Utils.showToast(...)`. NON ridefinirla inline in template HTML (era duplicata in `etl.html` — ora rimossa).

## Globals iniettati da Jinja2

`PROJECT_ID` e `TOOL_ID` sono window globals iniettati direttamente in `table.html` e `etl.html` da Jinja2. Tutti i moduli li leggono direttamente senza parametri. `ApiClient` li usa come default in ogni chiamata fetch.

## Moduli e dipendenze

```
utils.js     ← nessuna dep (root utility)
api.js       ← nessuna dep (root HTTP client)
columns.js   ← ApiClient, ResizeManager
resize.js    ← ColumnsManager.updateLocalWidth
paste.js     ← ApiClient, GridManager
grid.js      ← ApiClient, ColumnsManager, PasteManager
toolbar.js   ← ApiClient, GridManager
sql_editor.js ← ApiClient
etl_editor.js ← ApiClient (+ opzionale ToolbarManager fallback)
```
