# engine/etl_compiler.py

**Description:** Model-first SQL compiler. Accepts an `EtlModel` (or plain dict), validates it, builds a relation DAG, topologically sorts it, and compiles each relation into a SQL fragment. The final relation's SQL is assembled with ORDER BY and WITH clauses and returned. SQL is never parsed or inspected at any point.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 14–23 | `EtlValidationError` / `EtlCompilationError` exceptions |
| 27 | `_ALLOWED_BINARY_OPS` — frozenset of permitted `binary_op` operators |
| 29 | `_FIXED_ARITY_FUNCTIONS` — dict of function names with fixed arg counts (e.g. SPLIT_PART → 3) |
| 30 | `_SPLIT_PART_MAX_INDEX` — compilation limit (8) for SPLIT_PART literal index |
| 35–65 | `_sqlite_split_part(s, d, n)` / `_compile_split_part(args)` — translate SPLIT_PART to nested SQLite SUBSTR/INSTR |
| 70–115 | `expr_to_sql(expr)` — pure recursive dispatch; raises on unknown type; SPLIT_PART dispatches to `_compile_split_part` |
| 120–175 | `_validate_expr(expr, errors, context)` — recursive expression validator; includes SPLIT_PART arity and index checks |
| 178–215 | `_exprs_in_transformation(tr)` — collect all (expr, context) pairs from a transformation |
| 218–252 | `_kahn_sort(graph)` — topological sort; raises `EtlCompilationError` on cycle |
| 255–268 | `_collect_ancestors(relation_id, graph)` — BFS backwards from a relation id |
| 270–295 | `_output_aliases_for(relation_id, model)` — infer output column aliases for ORDER BY validation |
| 298–490 | `validate_model(model)` — Check 0: generate_series fields; Checks 1–14: existing structural and expression validation |
| 495–615 | `compile_sql(model)` — Steps 0–8; generate_series source compiles to inline WITH RECURSIVE subquery |

## Decisions

- **`expr_to_sql` raises on unknown type — never falls back silently**: An unrecognized `type` means a programming error or a stale model. Silent fallback (returning `""` or `NULL`) would produce wrong SQL with no error signal. Hard raise is the only correct behavior.
- **`column_ref` always double-quoted**: `"table"."column"` prevents reserved-word collisions and preserves case in all SQLite configurations. Unquoted identifiers are case-folded and can silently shadow keywords.
- **`literal` bool → `TRUE`/`FALSE`, not `1`/`0`**: Both work in SQLite, but `TRUE`/`FALSE` are explicit and self-documenting. Numeric encoding would be ambiguous alongside integer literals.
- **`logical` is flat n-ary, not binary**: `(A AND B AND C)` has one canonical form. Binary trees require a choice of associativity and produce non-canonical ASTs for identical semantics.
- **`binary_op` rejects AND/OR and `= NULL`**: AND/OR belong in `logical`. `= NULL` is a silent SQL trap — it always evaluates to NULL (unknown), never TRUE. Both are caught in `_validate_expr` before compilation.
- **`_ALLOWED_BINARY_OPS` is explicit**: Adding a new operator is a deliberate spec change, not an accident. Unknown ops (e.g., `||`) are rejected with a clear error.
- **`_validate_expr` is called from `validate_model` (Check 14)**: Expression validation is separate from structural validation. This means `validate_model` catches both model-level errors and expression-level errors in a single pass, returning all errors at once.
- **DAG execution order via Kahn's algorithm**: List position in `model.transformations` has NO effect on execution order. The topological sort is the sole determinant.
- **Every intermediate relation is wrapped in parentheses**: Each `sql_map[rid]` is a `(SELECT … FROM …)` subquery. The outer parens are stripped only from the final relation before ORDER BY and WITH are appended.
- **`_kahn_sort` raises on cycle — never demoted to a warning**: Cycle detection failure means the model is logically invalid.
- **FILTER mode is explicit**: Compiler places WHERE filters before aggregation and HAVING filters after. Mode is read directly from `filter.mode`; it is never inferred from graph topology.
- **JOIN right_source always resolved to a source**: The spec defines `right_source` as a source id (not a transformation id). If `right_source` type is `"table"`, the SQL is built directly; otherwise `sql_map` is used.
- **JOIN left_input table sources are inlined directly, not as subqueries**: When `left_input` is a `table` source, the compiler emits `table_name alias` directly in the FROM clause instead of using the prebuilt `(SELECT * FROM table alias)` subquery. This is necessary because the alias inside the subquery is invisible to the outer JOIN, making `"alias"."col"` column_refs in the ON condition fail with "no such column". Non-table left inputs (transformations) still use the subquery from `sql_map`.
- **`generate_series` compiles to inline WITH RECURSIVE**: Avoids polluting the top-level CTE namespace. Requires SQLite ≥ 3.35 (supports WITH inside subqueries). The CTE name is `_gs_<id[:8]>` — no collision with user-defined CTE sources.
- **SPLIT_PART index 1 produces simple CASE/INSTR/SUBSTR**: Higher indices nest the inner expression one more level. Expression size is O(3^n) characters with respect to the input string expression. Kept manageable by capping at index 8.
- **`_compile_split_part` is called from both `expr_to_sql` and raises `EtlCompilationError`**: Validation in `_validate_expr` catches bad args before compilation reaches `expr_to_sql`, so compile-time errors are a second safety net.
