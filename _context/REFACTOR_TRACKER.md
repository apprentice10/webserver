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

**P1-002 — Extract graph utilities from `etl_compiler.py`** ✓ 2026-05-14

- Created `engine/etl_compiler_graph.py` (87 LOC): `_kahn_sort`, `_collect_ancestors`, `_output_aliases_for`
- `_output_aliases_for` moved here (not to validate) — it is graph traversal, not semantic validation
- `etl_compiler.py` reduced from ~596 → ~480 LOC (active lines); `deque` import removed
- Verification: 32/32 tests pass
- Companion files: created `engine/etl_compiler_graph.py.md`, updated `engine/etl_compiler.py.md`

**P1-004c — Extract SQL lexer utilities → `sql_to_model_lexer.py`** ✓ 2026-05-14

- Created `engine/sql_to_model_lexer.py` (123 LOC): `_mask_strings`, `_unmask`, `_comma_split`, `_CLAUSE_PATTERNS`, `_COMPILED_CLAUSES`, `_find_clauses`
- `sql_to_model.py` imports all 4 public names; definitions removed — reduced from ~510 → 388 LOC
- Verification: 61/61 tests pass
- Companion files: created `engine/sql_to_model_lexer.py.md`, updated `engine/sql_to_model.py.md`

**P1-004b — Extract expression subsystem → `sql_to_model_expr.py`** ✓ 2026-05-14

- Created `engine/sql_to_model_expr.py` (~295 LOC): `_EXPR_KEYWORDS`, `_tokenize_expr`, `_ExprParser`, `_try_rewrite_split_part`, `_parse_expr`
- `sql_to_model.py` imports all 5 names; definitions removed — reduced from 895 → ~510 LOC
- Verification: 61/61 tests pass
- Companion files: created `engine/sql_to_model_expr.py.md`, updated `engine/sql_to_model.py.md`

**P1-004a — Write unit tests for `sql_to_model.py` internals** ✓ 2026-05-14

- Added 29 unit tests: 8 for `_tokenize_expr`, 17 for `_parse_expr`, 4 for `_try_rewrite_split_part`
- Total test count: 32 → 61
- All pass; P1-004b (expression extraction) is now unblocked

**P1-004 — Assess `sql_to_model.py` (895 LOC) for extraction targets** ✓ 2026-05-14

- Only 5 integration-level tests (all call `sql_to_model()` end-to-end); no unit tests for internals
- Key cross-dependency: `_extract_ctes` calls `_parse_expr` → expression subsystem must be extracted first
- Two clean extractions identified: expr subsystem (004b, ~385 LOC) + SQL lexer (004c, ~150 LOC)
- `_extract_ctes` stays in main to avoid cross-module imports for 42 LOC
- Next: P1-004a (unit tests as prerequisite)

**P1-003 — Extract validation helpers from `etl_compiler.py`** ✓ 2026-05-14

- Created `engine/etl_compiler_validate.py` (~230 LOC): `_validate_expr`, `_exprs_in_transformation`, `validate_model`
- `etl_compiler.py` reduced from ~480 → ~20 LOC (imports + `compile_sql` only) — orchestration-only
- Unused imports (`EtlModel`, `_ALLOWED_BINARY_OPS`, `_FIXED_ARITY_FUNCTIONS`, `_SPLIT_PART_MAX_INDEX`) removed from `etl_compiler.py`
- Verification: 32/32 tests pass
- Companion files: created `engine/etl_compiler_validate.py.md`, updated `engine/etl_compiler.py.md`

### ACTIVE

*(none)*

### PENDING

---

## Module Decomposition Plan

### Backend

| File | Current LOC | Target | Strategy |
|------|-------------|--------|----------|
| `engine/etl_compiler.py` | 727 | ~300 (orchestration only) | Extract expr, graph, validate |
| `engine/sql_to_model.py` | 895 | ~360 | Extract expr (004b) + lexer (004c) ✓ → 388 LOC |
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
| 2026-05-14 | S02 | P1-002 complete — graph utilities extracted to `etl_compiler_graph.py` | Commit P1-002, then start P1-003 (validation helpers) |
| 2026-05-14 | S03 | P1-003 complete — validation helpers extracted to `etl_compiler_validate.py`; `etl_compiler.py` is now orchestration-only | Commit P1-003, then assess P1-004 (`sql_to_model.py`) |
| 2026-05-14 | S04 | P1-003 committed; P1-004 assessment complete; P1-004a complete — 29 unit tests added (61 total); tracker updated | Commit P1-004a, then start P1-004b (expression extraction) |
| 2026-05-14 | S05 | P1-004b complete — expression subsystem extracted to `sql_to_model_expr.py`; `sql_to_model.py` reduced 895 → ~510 LOC; 61/61 tests pass | Commit P1-004b, then start P1-004c (SQL lexer extraction) |
| 2026-05-14 | S06 | P1-004c complete — SQL lexer utilities extracted to `sql_to_model_lexer.py`; `sql_to_model.py` reduced ~510 → 388 LOC; 61/61 tests pass | Commit P1-004c; Phase 1 pending tasks exhausted — assess Phase 2 |
