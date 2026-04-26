"""
engine/catalog.py
------------------
Catalogo dinamico dei tipi di tool disponibili.

I tool type vengono scoperti scansionando la cartella /tools/.
Ogni sottocartella con un file tool.json valido viene registrata automaticamente.
Per aggiungere un nuovo tool type: creare /tools/{nome}/tool.json con type_slug, name, description, icon.
"""

import json
from pathlib import Path

_TOOLS_DIR = Path(__file__).parent.parent / "tools"


def _scan_tools() -> list[dict]:
    catalog = []
    if not _TOOLS_DIR.exists():
        return catalog
    for d in sorted(_TOOLS_DIR.iterdir()):
        manifest = d / "tool.json"
        if d.is_dir() and manifest.exists():
            try:
                catalog.append(json.loads(manifest.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass
    return catalog


TOOL_CATALOG = _scan_tools()
