# static/engine/js/app_shell.js

**Description:** Global app-shell manager. Handles theme/accent/density, the settings modal, and the tool-name/icon popover. REV chip is owned by `revision-picker.js`. Loaded globally via `base.html`; auto-inits on `DOMContentLoaded`.

## Index

| Lines | Symbol | Description |
|-------|--------|-------------|
| 5 | `PREFS_KEY` | `localStorage` key `'im.prefs'` for persisted appearance prefs |
| 9–16 | `_loadPrefs / _savePrefs` | Read/merge/write prefs object |
| 19–56 | `_DENSITY_TABLE / setTheme / setAccent / setDensity` | `setDensity(px: number)` looks up 9–16px in `_DENSITY_TABLE` and sets `--row-h`, `--cell-pad-y`, `--cell-pad-x` CSS vars + root font-size; `setTheme/setAccent` write `data-*` attributes |
| 58–240 | `openSettings / closeSettings / _renderSettingsModal` | Dynamic settings modal (Appearance + Language + Backup tabs); Appearance tab shows density as a range slider (9–16px) |
| 196–205 | `_initToolPill` | Wires click on `#topbar-tool-pill` → `_openToolPopover` |
| 207–277 | `_openToolPopover` | Floating popover with name input + 18-emoji icon grid; body-appended with `position:fixed` to avoid overflow clipping; saves via `ApiClient.updateToolSettings` |
| 279–281 | `_closeToolPopover` | Removes `#popover-tool` from DOM |
| 284–302 | `init` | Applies persisted prefs to `<html>`; syncs density buttons; calls `_initToolPill` |
| 387 | auto-init | `document.addEventListener('DOMContentLoaded', () => AppShell.init())` |

## Decisions

- **Body-appended popovers with `position:fixed`**: the tool-pill lives inside `.crumbs` which has `overflow:hidden`. Appending to `document.body` with `getBoundingClientRect()`-based positioning prevents clipping. A `requestAnimationFrame` pass clamps the popover to the viewport right edge.
- **`ApiClient` calls wrapped in `try/catch`**: both save paths silently swallow errors. On pages without `ApiClient` (index), the reference error is caught without UI disruption.
- **Settings modal is dynamic (not in HTML)**: only one settings modal exists globally regardless of how many pages load. `_settingsOpen` guard prevents double-open.
- **Language change requires page reload**: `I18n.setLang()` changes the in-memory locale and persists it, but existing DOM strings are not patched. The settings hint string explains this.
- **Density stored as integer (9–16)**: replaces legacy `'dense'`/`'comfortable'` strings. `init()` and `_renderSettingsModal` both migrate legacy values on read (`dense→12`, `comfortable→14`). The `[data-density="comfortable"]` CSS block is deleted; all sizing is driven by JS-set CSS vars.
- **Density slider**: settings modal Appearance tab shows a `<input type="range" id="density-slider">` that calls `AppShell.setDensity(this.value)` oninput; toolbar segmented-density buttons removed.
