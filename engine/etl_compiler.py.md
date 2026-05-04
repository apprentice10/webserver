# engine/etl_compiler.py

**Description:** Model-first SQL compiler. Accepts an `EtlModel` (or plain dict), validates it, builds a relation DAG, topologically sorts it, and compiles each relation into a SQL fragment. The final relation's SQL is assembled with ORDER BY and WITH clauses and returned. SQL is never parsed or inspected at any point.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 14–23 | `EtlValidationError` / `EtlCompilationError` exceptions |
| 27 | `_ALLOWED_BINARY_OPS` — frozenset of permitted `binary_op` operators |
| 44–89 | `expr_to_sql(expr)` — pure recursive dispatch; raises on unknown type |
| 93–143 | `_validate_expr(expr, errors, context)` — recursive expression validator |
| 145–178 | `_exprs_in_transformation(tr)` — collect all (expr, context) pairs from a transformation |
| 181–215 | `_kahn_sort(graph)` — topological sort; raises `EtlCompilationError` on cycle |
| 218–230 | `_collect_ancestors(relation_id, graph)` — BFS backwards from a relation id |
| 233–252 | `_output_aliases_for(relation_id, model)` — infer output column aliases for ORDER BY validation |
| 255–369 | `validate_model(model)` — 14 validation checks (13 structural + 1 expression-level) |
| 372–467 | `compile_sql(model)` — Steps 0–9; accepts dict or EtlModel |

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
