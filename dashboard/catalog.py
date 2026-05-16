"""
engine/catalog.py
------------------
Dynamic scanner for available engine types.

Engine types are discovered by scanning the engines/ folder.
Each subfolder with a valid engine.json is registered automatically.
To add a new engine type: create engines/{name}/engine.json with the required fields.
"""

import json
import logging
import sqlite3
from pathlib import Path

logger = logging.getLogger("engine.catalog")

_ENGINES_DIR = Path(__file__).parent.parent / "engines"

_REQUIRED_FIELDS = {"name", "slug", "version", "type"}


def _scan_engines() -> list[dict]:
    catalog = []
    if not _ENGINES_DIR.exists():
        return catalog
    for d in sorted(_ENGINES_DIR.iterdir()):
        manifest_path = d / "engine.json"
        if not (d.is_dir() and manifest_path.exists()):
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("catalog: skipping %s — cannot read engine.json: %s", d.name, exc)
            continue
        missing = _REQUIRED_FIELDS - manifest.keys()
        if missing:
            logger.warning("catalog: skipping %s — missing required fields: %s", d.name, missing)
            continue
        catalog.append(manifest)
    return catalog


_ALL_CATALOG: list[dict] = _scan_engines()

# Only type=engine manifests — user-creatable engine instances.
ENGINE_CATALOG: list[dict] = [e for e in _ALL_CATALOG if e.get("type") == "engine"]

# Only type=utility manifests — capability add-ons, not user-created instances.
UTILITY_CATALOG: list[dict] = [e for e in _ALL_CATALOG if e.get("type") == "utility"]

# Grouped by utility_category for fast lookup by the utilities endpoint.
UTILITY_BY_CATEGORY: dict[str, list[dict]] = {}
for _u in UTILITY_CATALOG:
    _cat = _u.get("utility_category", "")
    UTILITY_BY_CATEGORY.setdefault(_cat, []).append(_u)

# Lookup: slug → manifest entry (type=engine only)
ENGINE_BY_SLUG: dict[str, dict] = {e["slug"]: e for e in ENGINE_CATALOG}


def get_db_engine_requirements(db_path: Path) -> list[tuple[str, str]]:
    """Returns distinct (tool_type, engine_version) pairs used in the given DB."""
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT DISTINCT tool_type, engine_version FROM _tools"
            ).fetchall()
            return [(r["tool_type"], r["engine_version"]) for r in rows]
        except sqlite3.OperationalError:
            return []
        finally:
            conn.close()
    except Exception:
        return []


def check_requirements(requirements: list[tuple[str, str]]) -> dict:
    """
    Compares requirements against ENGINE_BY_SLUG.
    Returns {"missing": [...], "mismatched": [...]}.
    missing   = slug not in catalog at all
    mismatched = slug found but installed version differs from required
    """
    missing: list[dict] = []
    mismatched: list[dict] = []
    for slug, version in requirements:
        entry = ENGINE_BY_SLUG.get(slug)
        if entry is None:
            missing.append({"slug": slug, "required_version": version})
        elif entry["version"] != version:
            mismatched.append({
                "slug": slug,
                "name": entry.get("name", slug),
                "installed_version": entry["version"],
                "required_version": version,
            })
    return {"missing": missing, "mismatched": mismatched}
