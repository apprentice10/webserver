# engine/etl_compiler_validate.py

**Description:** Validation layer for the ETL compiler: expression-level recursive validation and full model structural validation. Extracted from `etl_compiler.py` in P1-003.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 1–10 | Imports — `EtlModel`, `EtlCompilationError`, expression constants from `etl_compiler_expr`, graph helpers from `etl_compiler_graph` |
| 13–105 | `_validate_expr(expr, errors, context)` — recursive expression validator; covers all node types: literal, column_ref, function, binary_op, logical, unary_op, is_null/is_not_null, case |
| 108–135 | `_exprs_in_transformation(tr)` — collect all `(expr_dict, context_label)` pairs from a transformation dict |
| 138–239 | `validate_model(model)` — Checks 0–14: sources non-empty, generate_series fields, final_relation_id, duplicate ids, input references, cycle detection, column ids, JOIN integrity, filter mode, aggregate column validity, SELECT/AGGREGATE presence, ORDER BY scope, expression-level recursion |

## Decisions

- **`validate_model` is the public API; `_validate_expr` and `_exprs_in_transformation` are private helpers**: Tests and `compile_sql` import only `validate_model`. The private functions are implementation details of this module.
- **Cycle detection returns early on first cycle found**: Once a cycle is detected by `_kahn_sort`, no further checks can be meaningful (input references may form invalid loops). Returning immediately avoids cascading spurious errors.
- **Check numbering is preserved from the original `etl_compiler.py`**: Numbers (Check 0, 1, 2…) are used in tests and documentation. They were not renumbered when this module was extracted.
- **`_validate_expr` is called from both `validate_model` (Check 14) and directly for generate_series `end_expr` (Check 0)**: Expression validation is reused wherever an expression can appear in the model.
