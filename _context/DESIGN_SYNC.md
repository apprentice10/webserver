# DESIGN_SYNC.md

*Created: 2026-05-07*

Context for syncing the Claude Design prototype (exported from `api.anthropic.com/v1/design/h/ZH0UdQ2jAhSnlh6Q2xVKXQ`) with the real codebase. Saves the full analysis so future sessions don't need to re-extract or re-compare.

---

## Source bundle

The design was exported as a gzip-tar bundle. Key files inside:
- `webserver/chats/chat1.md` — full conversation transcript (user intent, rationale for each design choice)
- `webserver/project/CHANGELOG.md` — v0.1–v0.7.1 history
- `webserver/project/app/styles.css` — design tokens (light + dark, 4 accents, density)
- `webserver/project/app/grid.css` — grid, gutter, context menu, range readout
- `webserver/project/app/panel-system.css` — dock zones, tab groups, floating windows
- `webserver/project/app/panels.css` — sidebar panel, info, log, flags styles
- `webserver/project/app/app.jsx` — React shell (App, Topbar, Sidebar, Settings)
- `webserver/project/app/grid.jsx` — interactive grid with keyboard nav + drag-select
- `webserver/project/tweaks-panel.jsx` — live tweaks (theme/accent/density/sidebar/lang)

---

## Full diff (design vs implementation) — status as of 2026-05-07

| # | Feature | Status |
|---|---------|--------|
| 1 | Light/dark theme toggle | ✅ Done (`main.css` + `app_shell.js`) |
| 2 | Accent selector (cobalt/crimson/pine/amber) | ✅ Done |
| 3 | Derived accent tokens (`--accent-soft/faint/ink`) | ✅ Done |
| 4 | `--font-display: 'Instrument Serif'` | ✅ Done (2026-05-07) |
| 5 | Status chip (REV + state dot) | ✅ Done |
| 6 | Tool pill inline popover (name + icon) | ✅ Done (`app_shell.js`) |
| 7 | REV popover with A/B/C/D chips | ✅ Done |
| 8 | Ghost row / no "+Row" button | ✅ Done |
| 9 | Row gutter marker rail (56px: num + REV + flags) | ✅ Done (2026-05-07) |
| 10 | Range selection readout chip ("3R × 2C") | ✅ Done (2026-05-07) |
| 11 | Cell focus ring 1.5px | ✅ Done (2026-05-07) |
| 12 | Context menu icon column | ✅ Done (2026-05-07) |
| 13 | Search `<kbd>/</kbd>` shortcut hint | ✅ Done (2026-05-07) |
| 14 | Sidebar stale dot + dashed new-tool button | ✅ Done |
| 15 | i18n system (IT/EN) | ✅ Done (`i18n.js` loaded in `base.html`) |
| 16 | Panel dock/float/tab system | ✅ Done (`panel_system.js`) |
| 17 | ETL fullscreen 3-column overlay | ❌ Skipped — kept as separate route |
| 18 | Flags manager panel | ✅ Done |
| 19 | Info panel range summary (SUM/AVG/MIN/MAX) | ✅ Done |
| 20 | Tweaks live panel (theme/accent/density/lang) | ✅ Done (Settings modal) |

---

## Conflict A — Row gutter marker rail — ✅ Resolved

**What the design wants:** a single 56px sticky-left column (`.gutter`) that combines:
- Row number (`.gutter-num`, tabular-nums, 10px mono)
- REV badge (`.gutter-rev`, 9px mono, surface-2 bg, border)
- Flag dots (`.gutter-flags`, absolute top-right, 6px circles)

**Why it's a conflict:** the current implementation uses `.row-num` (40px) and scatters flag dots onto individual cells. Changing it requires touching rendering logic in multiple files.

### Files and lines to change

| File | Line(s) | Current | Change to |
|------|---------|---------|-----------|
| `grid.js` | ~125 | `<td class="row-num row-num-flags" data-row-idx="…">…</td>` | `<td class="gutter" data-row-idx="…"><div class="gutter-inner"><span class="gutter-num">N</span><span class="gutter-rev">REV X</span><div class="gutter-flags">…</div></div></td>` |
| `grid.js` | ~200 | `<td class="row-num"></td>` (ghost row) | `<td class="gutter"><div class="gutter-inner"></div></td>` |
| `grid.js` | ~245 | `querySelectorAll("td.row-num[data-row-idx]")` | `querySelectorAll("td.gutter[data-row-idx]")` |
| `grid.js` | ~492 | comment: `// -1 for row-num <th>` | update comment only (logic unchanged, position is the same) |
| `grid.js` | ~939 | context-menu guard: "not row-num" | update to "not gutter" (exact line: search `data-col-idx` guard in context menu open handler) |
| `columns.js` | ~50 | `<th class="col-row-num"></th>` | `<th class="col-gutter"></th>` |
| `grid.css` | `.col-row-num`, `.row-num` block | 40px, text-align:right | replace entirely with `.col-gutter` (56px) + `.gutter`, `.gutter-inner`, `.gutter-num`, `.gutter-rev`, `.gutter-flags`, `.flag-dot` |

### CSS to add to grid.css

```css
/* Gutter — combined row-num + REV badge + flag dots */
.col-gutter,
.gutter {
    width: 56px;
    min-width: 56px;
    max-width: 56px;
    background: var(--surface, var(--color-surface));
    border-right: 1px solid var(--border-strong, var(--color-border));
    position: sticky;
    left: 0;
    z-index: 5;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
}

.col-gutter { z-index: 11; }  /* header gutter above body gutter */

.gutter-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 5px 0 7px;
    height: 100%;
    position: relative;
}

.gutter-num {
    font-family: var(--font-mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-subtle, var(--color-text-muted));
}

.gutter-rev {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    color: var(--ink-muted, var(--color-text-muted));
    background: var(--surface-2, var(--color-surface));
    border: 1px solid var(--border, var(--color-border));
    border-radius: 3px;
    padding: 0 3px;
    letter-spacing: 0.5px;
}

.gutter-flags {
    display: flex;
    gap: 2px;
    position: absolute;
    top: 3px;
    right: 3px;
}

.gutter-flag-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.15);
}

tr:hover .gutter { background: var(--surface-2, var(--color-surface)); }
tr.row-selected .gutter { background: var(--accent-faint, rgba(233,69,96,0.06)); }
```

### JS rendering change (`_renderRow` in grid.js)

The REV value comes from `row.rev` (or `row['rev']`) which is already in the row data returned by the API. The row-level flag dots currently rendered via `_flagBadgesHtml(rowFlags)` should move into the gutter's `.gutter-flags` div.

Replace the row-num TD generation in `_renderRow` with:
```js
const rev = row['rev'] || '';
const gutterFlags = (rowFlags || [])
    .filter(f => !hidden.has(f.id))
    .map(f => `<span class="gutter-flag-dot" style="background:${Utils.escAttr(f.color)}" title="${Utils.escAttr(f.name)}"></span>`)
    .join('');

// <td class="gutter" ...>
//   <div class="gutter-inner">
//     <span class="gutter-num">N</span>
//     <span class="gutter-rev">B</span>   ← only if rev is non-empty
//     <div class="gutter-flags">…</div>
//   </div>
// </td>
```

**Note:** `_flagBadgesHtml` for row-level flags (where `col_slug === ''`) currently also includes the `row-num-flags` class on the `<td>`. After this refactor, row-level flags go into `.gutter-flags` and the `.row-num-flags` class is no longer needed.

### Risk level: medium
No API calls affected. No state management affected. Visual output and event flow for row-click selection change selector from `td.row-num` → `td.gutter` (one line).

---

## Conflict B — Context menu icon column — ✅ Resolved

**What the design wants:** each context menu item rendered as a 3-column grid:
```
[ 18px icon ] [ label ] [ kbd shortcut ]
```
Currently `.ctx-item` is `display:flex; justify-content:space-between` with no icon placeholder.

### Files to change

| File | Change |
|------|--------|
| `grid.css` | Change `.ctx-item` from `display:flex` to `display:grid; grid-template-columns: 18px 1fr auto` |
| `table.html` | Add icon span to every `<div class="ctx-item">` in row + column context menus |
| `grid.js` | Update the dynamically built flag submenu items (search: `ctx-flag-item` string in the context menu builder) |

### HTML structure change

Every static `ctx-item` in `table.html` changes from:
```html
<div class="ctx-item" data-action="delete">✕ Delete row<span class="ctx-shortcut">Del</span></div>
```
to:
```html
<div class="ctx-item" data-action="delete"><span class="ctx-icon">✕</span><span>Delete row</span><span class="ctx-shortcut">Del</span></div>
```

Items with no shortcut get an empty `<span class="ctx-shortcut"></span>` to keep the grid aligned.

### CSS change in grid.css

```css
.ctx-item {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    gap: 6px;
    align-items: center;
    padding: 7px 12px;
    /* ... rest unchanged ... */
}

.ctx-icon {
    font-size: 13px;
    text-align: center;
}
```

The `.ctx-shortcut` rule stays as-is (already `opacity:.5`, mono font).

### Items to update in table.html (row context menu)

| action | icon | shortcut |
|--------|------|---------|
| delete | ✕ | Del |
| restore | ↩ | — |
| hard-delete | 🗑 | — |
| keep-row | ✓ | — |
| remove-override | ↩ | — |
| log | 📋 | — |
| cell-log | 📋 | — |
| range-log | 📋 | — |
| flags-trigger | 🏷 | — |

Column context menu: rename (✏), delete (✕).

### Risk level: low
No JS logic changes. The `data-action` attributes that drive click handlers are on the same element — adding icon/shortcut spans inside doesn't affect event delegation. The flags submenu uses separate `.ctx-flag-item` class, not `.ctx-item`, so the grid layout doesn't apply to it.

---

## What was NOT ported (intentional)

- **ETL fullscreen 3-column overlay** — kept as separate route (`/tool/{id}/etl`). Moving it inline would require restructuring `engine/etl.py`, the ETL template, and the breadcrumb/back navigation. Low value given it already works well as a dedicated page.
- The React prototype used mock data; all real API contracts, audit trail, ETL compiler, paste, column resize, `.row-eliminated` state, column context menu, SQL editor remain only in the real implementation and have no design counterpart.
