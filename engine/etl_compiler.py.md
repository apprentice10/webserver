# engine/etl_compiler.py

**Description:** Model-first SQL compiler. Accepts an `EtlModel` (or plain dict), validates it, builds a relation DAG, topologically sorts it, and compiles each relation into a SQL fragment. The final relation's SQL is assembled with ORDER BY and WITH clauses and returned. SQL is never parsed or inspected at any point.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 14–18 | `EtlValidationError` — raised when `validate_model` returns errors |
| 21–23 | `EtlCompilationError` — raised for structural compiler failures (cycles, missing relations) |
| 27–61 | `expr_to_sql(expr)` — dispatches on `expr["type"]`; `expr_sql` is emitted verbatim |
| 65–97 | `_kahn_sort(graph)` — Kahn's topological sort; raises `EtlCompilationError` on cycle |
| 101–114 | `_collect_ancestors(relation_id, graph)` — BFS backwards from a relation id |
| 118–142 | `_output_aliases_for(relation_id, model)` — infer output column aliases for ORDER BY validation |
| 146–264 | `validate_model(model)` — all 13 validation checks; returns list of error strings |
| 268–370 | `compile_sql(model)` — Steps 0–9; accepts dict or EtlModel |

## Decisions

- **DAG execution order via Kahn's algorithm**: List position in `model.transformations` has NO effect on execution order. The topological sort is the sole determinant.
- **Every intermediate relation is wrapped in parentheses**: Each `sql_map[rid]` is a `(SELECT … FROM …)` subquery. The outer parens are stripped only from the final relation before ORDER BY and WITH are appended.
- **`_kahn_sort` raises on cycle — never demoted to a warning**: Cycle detection failure means the model is logically invalid; proceeding produces undefined behavior.
- **FILTER mode is explicit**: Compiler places WHERE filters before aggregation and HAVING filters after. Mode is read directly from `filter.mode`; it is never inferred from graph topology.
- **`expr_sql` is opaque throughout**: `expr_to_sql` for `expr_sql` type is `return expr["sql"]` — one line, no branching on content. Validation skips scope checks for `expr_sql` nodes (intentional tradeoff for UI simplicity). Structured expressions (`ColumnRef`, `BinaryOp`, etc.) are always validated.
- **`scope_map` initialized but not populated**: Reserved for future use; scope tracking is currently done in `validate_model` via `_output_aliases_for`.
- **JOIN right_source always resolved to a source**: The spec defines `right_source` as a source id (not a transformation id). If `right_source` type is `"table"`, the SQL is built directly; otherwise `sql_map` is used.
