# engine/etl_model.py

**Description:** Dataclass definitions for the model-first ETL IR. Every ETL definition is represented as an `EtlModel` — the single source of truth. SQL is never stored as source of truth; it is always compiled from this model.

## Index

| Lines / Symbol | Description |
|----------------|-------------|
| 11–17 | `ColumnRef` — qualified or unqualified column reference; always quoted by compiler |
| 19–22 | `Literal` — constant value (str / number / bool / None); None → NULL, bool → TRUE/FALSE |
| 24–30 | `BinaryOp` — infix operator; op restricted to `=,!=,>,<,>=,<=,+,-,*,/`; AND/OR forbidden |
| 32–36 | `Function` — named function with arg list; name uppercased by compiler |
| 38–43 | `Logical` — flat n-ary AND/OR; op must be `"and"` or `"or"`; minimum 2 args |
| 45–49 | `UnaryOp` — logical negation; v1 supports `"not"` only |
| 51–54 | `IsNull` — `expr IS NULL`; the only correct way to test for NULL |
| 56–59 | `IsNotNull` — `expr IS NOT NULL` |
| 61–67 | `Case` — searched (`operand=None`) or simple CASE; `else_expr` maps to JSON key `"else"` |
| 70–75 | `Column` — output column: stable id, alias, expression |
| 78–86 | `Source` — base relation (table, CTE, subquery) |
| 89–94 | `SelectTransformation` |
| 96–102 | `FilterTransformation` — requires explicit `mode: "where"\|"having"` |
| 104–113 | `JoinTransformation` — left_input is a relation id, right_source is a source id |
| 115–121 | `AggregateTransformation` |
| 123–128 | `ComputeColumnTransformation` |
| 131–138 | `EtlModel` — root; `final_relation_id` declares the output relation |
| 141–142 | `model_to_dict` — serialize to plain dict (JSON-safe) |
| 145–153 | `model_from_dict` — deserialize from plain dict |

## Decisions

- **`inputs: list[str]` always a list**: Even single-input transformations use a list. Enables DAG-style multi-input types (UNION, INTERSECT) in future without schema change.
- **`ExprSql` removed (was: opaque raw SQL bridge)**: Raw SQL fragments are not part of the v1 grammar. All expressions must be structured nodes. The frontend ETL editor must be updated to build structured expression trees rather than embedding raw SQL strings.
- **`FunctionCall` renamed to `Function`**: Type discriminator is `"function"` (not `"function_call"`). The shorter name matches the grammar spec and avoids confusion with Python callable terminology.
- **`Logical` is separate from `BinaryOp`**: AND/OR are flat n-ary operations, not binary trees. Using `BinaryOp` for AND/OR would force left- or right-associative nesting, producing non-canonical ASTs for the same logical expression. `Logical.args` is always flat.
- **`Case.else_expr` field vs JSON key `"else"`**: `else` is a Python keyword; the dataclass field is named `else_expr`. When building model dicts directly (the normal path), use the key `"else"`. `asdict()` will produce `else_expr` — only relevant if round-tripping through `model_to_dict`.
- **`final_relation_id` is mandatory**: Without it the compiler has no principled way to determine which relation to emit.
- **`meta.schema_version`**: Must be set to `1` by the caller. Used by future migrations to detect and upgrade old models.
- **Sources store `sql` only for `type="cte"`**: This field is passed through verbatim to the WITH clause and never parsed.
