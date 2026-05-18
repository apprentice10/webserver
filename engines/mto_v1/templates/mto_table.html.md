# templates/mto_table.html

**Description:** Main HTML template for an MTO tool instance. Extends `base.html`. Provides the tab bar shell (one tab per typical) and placeholder page areas. `mto_shell.js` populates the tab bar and handles switching.

## Decisions

- Template is discovered automatically by `main.py`'s Jinja2 multi-loader (any `engines/*/templates/` directory is added to the loader path).
- Injects `MTO_DB` and `MTO_TOOL` as global JS variables (from Jinja2 context) so `mto_shell.js` knows which tool to fetch without parsing the URL.
- Served at `/mto?db=...&tool=...` (route added to `main.py` at Step 4).
- Includes `utils.js` (Step 6) so `mto_shell.js` can call `Utils.showToast` for ETL run feedback.
- "▶ Run ETL" button in topbar triggers `etl_run` via `mto_shell._runEtl` — calls the saved ETL model and reloads the tab bar.
- "⇗ Export" button (`#btn-export-typical`) in topbar opens `MtoExport` modal — wired by `mto_export.js`.
- Script load order: `utils.js` → `mto_annotation.js` → `mto_image.js` → `mto_materials.js` → `mto_shell.js` → `mto_import.js` → `mto_export.js`.
