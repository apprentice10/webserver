# RISKS.md
_Known technical risks and dangerous areas. Check before touching flagged modules._

---

## R01 — `engine/service.py` oversized [HIGH]

**Rule violated:** No file > 400 lines (project rule).  
**Current size:** ~650 lines post-refactor (template CRUD rewritten to sqlite3, ~50 lines saved).  
**Risk:** High AI token cost per task that touches this file; growing harder to navigate.  
**Safe split candidates:**
- L555–600 staleness helpers → `engine/staleness.py`
- L570–650 template CRUD → `engine/templates.py`
- L436–550 delete/restore/paste → `engine/row_ops.py`  
**Action needed:** Split before next major feature addition. Do NOT add more code to service.py without splitting first.

---

## R02 — `engine/routes.py` at 520 lines [MEDIUM]

**Rule violated:** No file > 400 lines.  
**Risk:** Pydantic schemas (L1–143) and route handlers are mixed in one file.  
**Safe split:** Extract schemas to `engine/schemas.py`, keep routes thin.  
**Action needed:** Split when next schema is added.

---

## R03 — `static/engine/js/grid.js` at 638 lines [HIGH]

**Rule violated:** No file > 400 lines.  
**Risk:** High AI context cost; hard to test in isolation.  
**Safe split candidates:**
- Cell save / delete / restore (L331–470) → `grid_mutations.js`  
- Context menu (L403–480) → `context_menu.js`  
**Note:** IIFE pattern means split requires careful exposure via `window.GridMutations` etc.  
**Action needed:** Plan split before adding more grid features.

---

## R04 — ETL deps stale when SQL changed without saving [MEDIUM]

**Behavior:** `etl_deps` reflects SQL at last `save_etl_version`, not current editor content.  
**Trigger:** User edits ETL SQL, clicks "Run" without saving first — deps may be wrong, topological order may be wrong.  
**Mitigation in place:** None at code level. Requires UX prompt ("Save before run").  
**Action needed:** Add a pre-run check: if current SQL != last saved SQL, block run or auto-save.

---

## R05 — `check_same_thread=False` in project_db.py [LOW, uncommitted]

**Change:** `sqlite3.connect(..., check_same_thread=False)` in `open_project_db()`.  
**Risk:** Suppresses SQLite's thread safety guard. Safe only if connections are not shared across requests (each request opens/closes its own connection via `get_project_conn` dependency).  
**Current behavior:** FastAPI creates a new connection per request via generator dependency → safe.  
**Risk would activate if:** Someone caches a connection outside the dependency. Don't do this.

---

## R06 — Circular import etl.py ↔ service.py [LOW, mitigated]

**Status:** Fixed via deferred import in `etl_run_saved` body (see DECISIONS.md D05).  
**Risk if broken:** Startup failure with `ImportError`. Easy to reintroduce by moving the import to module top-level.  
**Guard:** Never add `from engine.service import ...` or `from engine.etl import ...` at the top of the other file.

---

## R07 — Dynamic DDL via f-strings [MEDIUM]

**Location:** `project_db.py::create_tool_table`, `add_column_to_table`; `etl.py::etl_apply`.  
**Risk:** SQL injection if `slug` or `col_slug` is not sanitized before use as identifier.  
**Current mitigation:** `slugify()` in `utils.py` normalizes to `[a-z0-9_]` before any slug is stored.  
**Guard:** Never use raw user input as a table/column name. Always pass through `slugify()` first.
