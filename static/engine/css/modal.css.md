# modal.css

Stili per modal log, form-select, toast notifiche, icon picker e settings modal con tab.

## Indice

| Sezione | Classi principali |
|---------|-------------------|
| Modal log | `.modal-wide`, `.log-entry`, `.log-removed`, `.log-restored`, `.log-empty` |
| Form select | `.form-select` |
| Toast | `.toast`, `.toast-error`, `.toast-success`, `.toast-info` |
| Icon picker | `.icon-picker`, `.icon-option`, `.icon-option.selected` |
| Settings modal | `.modal-settings-wide` |
| Settings tabs | `.settings-tabs`, `.settings-tab`, `.settings-tab.active`, `.settings-tab-content` |

## Decisioni

- **Toast z-index 999**: sopra modal (z-index 100 in main.css) e context menu (z-index 500 in grid.css).
- **`.modal-settings-wide`**: `width: 95vw` con `max-width: 900px` per adattarsi a schermi piccoli senza diventare troppo largo su widescreen.
- **`.form-select`**: unico select stilizzato del progetto — background `--color-bg` per distinguerlo da input su surface.
