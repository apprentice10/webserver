# REFACTOR_TRACKER.md

Master coordination document for the incremental modular refactor.
Read this at the start of every session before touching any file.

---

## Architecture Goals

- Break large files into single-responsibility modules
- Reduce file sizes toward ≤400 LOC per file
- Isolate pure logic from orchestration and I/O
- Separate UI rendering from state management (frontend)
- Preserve all existing behavior — no silent changes
- Leave the project runnable after every commit

---

## Phasing

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Safe backend extraction — pure functions, helpers, ETL compiler internals | **ACTIVE** |
| 2 | Bug isolation instrumentation — columns endpoint race condition | Pending |
| 3 | routes.py / service.py decomposition | Blocked until Phase 2 complete |
| 4 | Frontend decomposition — grid.js, etl_editor.js, panel_system.js | Pending |

---

## Unstable Zone (DO NOT refactor aggressively)

The following files/flows are near an unresolved intermittent 500 on the columns endpoint.
Do not restructure request lifecycle code here until Phase 2 produces observations.

- `engine/routes.py` — route handlers, context switching
- `engine/service.py` — tool loading, column loading, CURRENT_STATE management
- `engine/project_db.py` — connection lifecycle
- Any page/tool switch flow

---

## Phase 1 Task Log

### COMPLETED

**P1-001 — Extract expression-to-SQL cluster from `etl_compiler.py`** ✓ 2026-05-14

- Created `engine/etl_compiler_expr.py` (124 LOC): exceptions, grammar constants, SPLIT_PART helpers, `expr_to_sql`
- `etl_compiler.py` imports and re-exports all names for backward compatibility
- `etl_compiler.py` reduced from 727 → ~596 LOC (active lines)
- Verification: 32/32 tests pass
- Companion files: created `engine/etl_compiler_expr.py.md`, updated `engine/etl_compiler.py.md`

### ACTIVE

*(none — commit P1-001, then start P1-002)*

### PENDING

**P1-002 — Extract graph utilities from `etl_compiler.py`**

- Target: `engine/etl_compiler_graph.py`
- Extract: `_kahn_sort`, `_collect_ancestors`
- Depends on: P1-001 complete
- Note: `_output_aliases_for` depends on `EtlModel` — evaluate whether it moves too

**P1-003 — Extract validation helpers from `etl_compiler.py`**

- Target: `engine/etl_compiler_validate.py`
- Extract: `_validate_expr`, `_exprs_in_transformation`, `validate_model`
- Depends on: P1-001, P1-002 complete

**P1-004 — Assess `sql_to_model.py` (895 LOC) for extraction targets**

- No existing test coverage → new tests required before splitting
- Do not start until P1-001–003 establish the extraction pattern

---

## Module Decomposition Plan

### Backend

| File | Current LOC | Target | Strategy |
|------|-------------|--------|----------|
| `engine/etl_compiler.py` | 727 | ~300 (orchestration only) | Extract expr, graph, validate |
| `engine/sql_to_model.py` | 895 | TBD | Assess after P1-001 |
| `engine/service.py` | 914 | Phase 3 | Blocked — unstable zone |
| `engine/routes.py` | 832 | Phase 3 | Blocked — unstable zone |
| `engine/etl_compiler.py` | 727 | ~300 | Phase 1 active |

### Frontend (Phase 4)

| File | Current LOC | Strategy |
|------|-------------|----------|
| `static/engine/js/grid.js` | 1670 | Extract selection, keyboard, history — Option C first |
| `static/engine/js/etl_editor.js` | 1174 | Extract DSL helpers, validation, rendering |
| `static/engine/js/panel_system.js` | 634 | Extract state store from rendering |

---

## Naming Conventions

- Phase 1 extracted files: `engine/<base>_<role>.py` (flat, role-suffix)
- Phase 1 role suffixes: `_expr`, `_graph`, `_validate`, `_types`, `_errors`
- Phase 3+: move to subdirectories (`engine/etl/`, `engine/sql/`) if cohesion warrants it
- Frontend (Phase 4): IIFE/globals pattern preserved; new IIFEs use sub-namespace pattern

---

## Commit Format

```
refactor(scope): short description
```

One commit per logical task. Each commit must:
- Leave project runnable
- Pass `pytest tests/` (backend) or server smoke test
- Include updated companion `.md` files
- Update this file

---

## Verification Protocol

- **Default:** `pytest tests/` passes + `uvicorn main:app --reload` + manual smoke test on affected endpoint
- **Escalate to new tests when:** extracted module has no indirect test coverage

---

## Known Risks

| Risk | Affected | Mitigation |
|------|----------|------------|
| Intermittent 500 on columns endpoint | `routes.py`, `service.py` | Do not refactor these until Phase 2 |
| `sql_to_model.py` has hidden coupling | `sql_to_model.py` | Requires new tests before splitting |
| Frontend has no automated tests | All JS files | Manual verification only; extra care on each extraction |

---

## Session Log

| Date | Session | Work Done | Next Step |
|------|---------|-----------|-----------|
| 2026-05-14 | S01 | Grilling complete; decisions locked; REFACTOR_TRACKER created; P1-001 complete | Commit P1-001, then start P1-002 (graph utilities) |
