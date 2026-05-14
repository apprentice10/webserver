# engine/etl_compiler_expr.py

**Description:** Expression-to-SQL compiler for the ETL model. Contains the exception classes, expression grammar constants, SPLIT_PART SQLite compilation helpers, and `expr_to_sql` — the pure recursive function that converts an expression AST node into a SQL string fragment. No dependencies on `EtlModel` or any orchestration layer.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 7–15 | `EtlValidationError` — raised by `validate_model` when the model is structurally invalid |
| 18–19 | `EtlCompilationError` — raised by `compile_sql` and expression helpers on unrecoverable errors |
| 23 | `_ALLOWED_BINARY_OPS` — frozenset of permitted `binary_op` operators |
| 26–28 | `_FIXED_ARITY_FUNCTIONS` — dict of function names with fixed arg counts |
| 30 | `_SPLIT_PART_MAX_INDEX` — SQLite compilation limit (8) for SPLIT_PART literal index |
| 34–55 | `_sqlite_split_part(s, d, n)` — recursively builds nested CASE/SUBSTR/INSTR SQL |
| 58–73 | `_compile_split_part(args)` — validates SPLIT_PART args and calls `_sqlite_split_part` |
| 77–124 | `expr_to_sql(expr)` — pure recursive dispatch; all expression types → SQL string |

**Dependents:** `engine/etl_compiler.py` (imports everything), `engine/etl.py` (re-imported via etl_compiler)

## Decisions

- **Extracted from `etl_compiler.py` (P1-001, 2026-05-14):** This cluster has no dependency on `EtlModel` and is consumed by both `validate_model` and `compile_sql`. Isolating it makes the expression grammar testable independently and reduces `etl_compiler.py` size.
- **Exceptions live here, not in a separate `_errors.py`:** They are used directly by `expr_to_sql` and `_compile_split_part`. A separate errors file would add an import hop with no cohesion benefit at this scale.
- **All callers still import from `etl_compiler`:** The names are re-exported from `etl_compiler.py` via its import block. No external caller needs to know about this file. This preserves backward compatibility across all import sites.
- See `engine/etl_compiler.py.md` for the full expression grammar rationale (double-quoting, bool encoding, n-ary logical, NULL trap, etc.).
