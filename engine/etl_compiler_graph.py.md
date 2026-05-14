# engine/etl_compiler_graph.py

**Description:** Graph utilities for the ETL compiler: topological sort (Kahn's algorithm), ancestor traversal, and output-alias inference. Extracted from `etl_compiler.py` in P1-002.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 1–5 | Imports — `deque`, `EtlCompilationError` from `etl_compiler_expr`, `EtlModel` from `etl_model` |
| 14–46 | `_kahn_sort(graph)` — topological sort over the relation DAG; raises `EtlCompilationError` on cycle |
| 52–63 | `_collect_ancestors(relation_id, graph)` — iterative DFS backwards from a relation id; returns all ancestor ids including itself |
| 69–87 | `_output_aliases_for(relation_id, model)` — infer output column aliases for ORDER BY scope validation; recurses through filter/join/compute_column to the nearest select/aggregate |

## Decisions

- **`_output_aliases_for` lives here, not in `etl_compiler_validate.py`**: It traverses the model as a graph (following `inputs` pointers) rather than doing semantic checks on field values. Co-location with the other graph traversal functions (`_kahn_sort`, `_collect_ancestors`) reflects this structural role.
- **`_kahn_sort` raises on cycle — never returns partial results**: A cycle means the model is logically invalid; a partial order would silently produce wrong SQL. Hard raise is the only correct behavior.
- **`_collect_ancestors` uses iterative DFS, not recursion**: Avoids Python stack overflow for deeply nested DAGs.
