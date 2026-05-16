---
# engines/sheet_v1/static/css/sidebar.css

**Description:** Sidebar shell and flag-sidebar styles for Sheet V1 — the right-side panel that hosts history logs, row info, and the flag list.

## Index

| Lines | Section | Description |
|-------|---------|-------------|
| 1–23 | Sidebar shell | `.sidebar-panel` container, base layout, z-index, transition |
| 24–58 | Resize handle | `.sidebar-resize-handle` — drag left edge to resize dock width (K-6) |
| 54–59 | Closed state | `.sidebar-panel.sidebar-closed` — collapsed to 0 width |
| 60–98 | Header | `.sidebar-header`, `.sidebar-title`, icon/button layout |
| 100–167 | Log meta | `.sidebar-log-meta`, `.sidebar-log-label`, `.sidebar-log-value`, `.sidebar-log-list` |
| 140–196 | Log entry | `.sidebar-log-entry`, `.sidebar-log-ts`, `.sidebar-log-change`, type badge, rollback button |
| ~200–end | Flag sidebar | `.flag-sidebar`, flag pill, colour swatch, flag edit controls |

## Decisions

- **CSS transitions on width**: sidebar open/close uses CSS `transition: width` so JS only needs to toggle a class, not animate manually.
- **Resize handle on left edge**: resizing drags the left border of the right-docked panel, consistent with OS panel conventions.
