# engine/etl_model.py

**Description:** Dataclass definitions for the model-first ETL IR. Every ETL definition is represented as an `EtlModel` — the single source of truth. SQL is never stored as source of truth; it is always compiled from this model.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 10–20 | `ColumnRef` — qualified or unqualified column reference |
| 22–26 | `Literal` — constant value (string, number, null, bool) |
| 28–34 | `BinaryOp` — infix operator with left/right sub-expressions |
| 36–41 | `FunctionCall` — named function with arg list |
| 43–49 | `ExprSql` — opaque raw SQL fragment (UI bridge only, never parsed) |
| 52–57 | `Column` — output column: stable id, alias, expression |
| 60–68 | `Source` — base relation (table, CTE, subquery) |
| 71–76 | `SelectTransformation` |
| 78–84 | `FilterTransformation` — requires explicit `mode: "where"\|"having"` |
| 86–95 | `JoinTransformation` — left_input is a relation id, right_source is a source id |
| 97–103 | `AggregateTransformation` |
| 105–110 | `ComputeColumnTransformation` |
| 113–120 | `EtlModel` — root; `final_relation_id` declares the output relation |
| 123–124 | `model_to_dict` — serialize to plain dict (JSON-safe) |
| 127–135 | `model_from_dict` — deserialize from plain dict |

## Decisions

- **`inputs: list[str]` always a list**: Even single-input transformations use a list. Enables DAG-style multi-input types (UNION, INTERSECT) in future without schema change.
- **`ExprSql` is a UI bridge, not a core type**: All structured expression types are implemented from day one. `ExprSql` is additive and isolated — removing it must not require changes to any other expression type or compiler logic. It is NEVER parsed, inspected, or used for dependency inference anywhere in the system.
- **`final_relation_id` is mandatory**: Without it the compiler has no principled way to determine which relation to emit. Intermediate relations that are not on the path to `final_relation_id` are excluded from compilation.
- **`meta.schema_version`**: Must be set to `1` by the caller. Used by future migrations to detect and upgrade old models.
- **Sources store `sql` only for `type="cte"`**: This field is passed through verbatim to the WITH clause and never parsed.
