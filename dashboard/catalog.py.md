---
# engine/catalog.py

**Description:** Scans `engines/*/engine.json` at startup and builds separate `ENGINE_CATALOG` and `UTILITY_CATALOG`. Also provides compatibility check functions used when opening a project DB.

## Index

| Symbol | Description |
|--------|-------------|
| `_ENGINES_DIR` | `Path` → `engines/` in project root |
| `_REQUIRED_FIELDS` | Set of fields that must be present in every manifest: `name`, `slug`, `version`, `type` |
| `_scan_engines()` | Scans subdirectories, reads each `engine.json`, skips malformed or incomplete manifests with a warning |
| `_ALL_CATALOG` | Full list of all valid manifests from scan |
| `ENGINE_CATALOG` | Manifests where `type=engine` only — user-creatable instances |
| `UTILITY_CATALOG` | Manifests where `type=utility` only — capability add-ons |
| `UTILITY_BY_CATEGORY` | `dict[utility_category → list[manifest]]` — used by the utilities endpoint |
| `ENGINE_BY_SLUG` | `dict[slug → manifest]` for `type=engine` only — used by `check_requirements` and `create_engine` |
| `get_db_engine_requirements(db_path)` | Opens a DB and returns distinct `(tool_type, engine_version)` pairs from `_tools` |
| `check_requirements(requirements)` | Compares a requirements list against `ENGINE_BY_SLUG`; returns `{missing, mismatched}` |

## Decisions

- **Scanning at import time, not lazy**: catalogs are constant for the process lifetime. A server restart is required to detect new plugins.
- **Empty list fallback** if `engines/` does not exist — never crashes.
- **Required field validation**: manifests missing `name`, `slug`, `version`, or `type` are skipped with a warning log. A broken plugin does not block others.
- **`ENGINE_CATALOG` is type=engine only** (R5): utilities are not user-creatable and must not appear in the +new Engine modal or the `ENGINE_BY_SLUG` lookup.
- **`UTILITY_BY_CATEGORY` is the lookup used by `GET /api/engines/utilities?category=`** (R5): frontend calls this to discover installed ETL utilities before rendering the switcher.
- **`check_requirements` is pure**: takes a list, compares in-memory against `ENGINE_BY_SLUG`. `get_db_engine_requirements` handles the DB I/O separately.
- **Version match is strict equality**: any difference (e.g., `"1.0"` vs `"1.1"`) is flagged as mismatch. No semver range logic.
