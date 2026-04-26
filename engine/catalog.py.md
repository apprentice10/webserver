---
# engine/catalog.py

**Descrizione:** Scansiona `tools/*/tool.json` all'avvio e costruisce `TOOL_CATALOG` — lista dizionari con `type_slug`, `name`, `description`, `icon`. Sostituisce la lista statica precedente.

## Indice

| Simbolo | Descrizione |
|---------|-------------|
| `_TOOLS_DIR` | `Path` → `tools/` nella root del progetto |
| `_scan_tools()` | Scansiona subdirectory, legge ogni `tool.json`, ignora manifest malformati |
| `TOOL_CATALOG` | Lista risultante, costruita a import time |

## Decisioni

- **Scanning a import time, non lazy**: `TOOL_CATALOG` è costante per tutta la vita del processo. Un riavvio del server rileva nuovi plugin.
- **Fallback lista vuota** se `tools/` non esiste — mai crash.
- **Manifest malformati silenziosi** (`json.JSONDecodeError`, `OSError` → skip) — un plugin rotto non blocca gli altri.
- **`SYSTEM_COLUMN_DEFS` non appartiene qui**: tag/rev/log sono contratto engine, non plugin-specific. Non spostarli nel manifest.
