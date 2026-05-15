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

## Script load order

### base.html (all pages)
```
main.js → i18n.js → app_shell.js
```
`i18n.js` must precede `app_shell.js` (AppShell calls `I18n.t()`). `app_shell.js` auto-inits via `DOMContentLoaded`.

### table.html extra_js block (tool pages only)
```
utils.js → api.js → columns.js → resize.js → paste.js → grid.js → toolbar.js → panel_system.js → sidebar.js → flags.js → sql_editor.js
```
`utils.js` must be first (provides `escHtml`, `showToast`, `formatTimestamp` used by all others). `panel_system.js` must precede `sidebar.js` because `sidebar.js` is now a thin adapter that calls `PanelSystem`. `ApiClient` calls inside `app_shell.js` save handlers are safely wrapped in `try/catch` — on pages without `api.js`, errors are silently swallowed.

## showToast è globale via Utils

`showToast(msg, type)` è definita in `utils.js` come `Utils.showToast`. Tutti i moduli la chiamano direttamente come `Utils.showToast(...)`. NON ridefinirla inline in template HTML (era duplicata in `etl.html` — ora rimossa).

## Globals iniettati da Jinja2

`PROJECT_ID` e `TOOL_ID` sono window globals iniettati direttamente in `table.html` e `etl.html` da Jinja2. Tutti i moduli li leggono direttamente senza parametri. `ApiClient` li usa come default in ogni chiamata fetch.

## Moduli e dipendenze

```
i18n.js          ← nessuna dep (base.html first)
app_shell.js     ← I18n, Utils, ApiClient (api.js — optional, errors caught)
utils.js         ← nessuna dep (root utility)
api.js           ← nessuna dep (root HTTP client)
columns.js       ← ApiClient, ResizeManager
resize.js        ← ColumnsManager.updateLocalWidth
paste.js         ← ApiClient, GridManager
grid.js          ← ApiClient, ColumnsManager, PasteManager
toolbar.js       ← ApiClient, GridManager
panel_system.js  ← nessuna dep (no modules required at load time)
sidebar.js       ← PanelSystem (adapter — all methods forward to PanelSystem)
flags.js         ← ApiClient, SidebarManager
sql_editor.js    ← ApiClient
etl_editor.js    ← ApiClient (+ opzionale ToolbarManager fallback)
```
## PanelSystem v3 API

State shape (localStorage key `instrumentManager.layout.v2`):
```js
{
  version: 3,
  rightDock: { open: bool, width: 320, activeTab: string|null, tabs: string[] },
  floats: [{ id: string, x: number, y: number, w: number, h: number }]
}
```

Public API:
- `register(config)` — `{id, title, icon, onActivate?}`
- `showPanel(id, opts?)` — opens in dock (or activates float if already floating); `opts.silent=true` skips `onActivate`
- `hidePanel(id)` — removes from dock or floats
- `moveToFloat(id, x, y)` — removes from dock, creates floating window at x/y
- `dockPanel(id)` — removes from floats, adds to dock
- `togglePanel(id)` — smart toggle: float→hide, dock+active→hide, dock+inactive→activate, absent→show
- `closeAll()` — clears dock + all floats
- `isPanelOpen(id)` — true if in dock OR in floats
- `isActivePanel(id)` — true only if active tab in dock
- `allPanels()` — all registered panel configs

DnD behaviour: dragging a tab within the tab bar reorders it. Dragging a tab outside the dock converts it to a floating window at drop position. `_dragDropped` flag distinguishes intra-bar drops from outside drops in the `dragend` handler.

## Module layout

| `static/engine/css/layout.css` | Container, topbar, global buttons | `static/engine/css/layout.css.md` |
| `static/engine/css/toolbar.css` | Secondary toolbar, search input | `static/engine/css/toolbar.css.md` |
| `static/engine/css/grid.css` | Grid, cells, select/edit mode, context menu, drag | `static/engine/css/grid.css.md` |
| `static/engine/css/note.css` | Tool note area | `static/engine/css/note.css.md` |
| `static/engine/css/sql_editor.css` | Power SQL Editor inline panel | `static/engine/css/sql_editor.css.md` |
| `static/engine/css/modal.css` | Modal log, toast, icon picker, settings tabs | `static/engine/css/modal.css.md` |
| `static/engine/css/etl.css` | ETL Editor layout | `static/engine/css/etl.css.md` |
| `static/engine/css/sidebar.css` | Sidebar panel layout, open/close transition | — |
