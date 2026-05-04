# ETL Template — Authoring Guide

*Precision reference for producing valid, error-free ETL model JSON.*
*Read this completely before writing any template.*

---

## 1. What a Template Is

A template is a JSON object saved as a string in the `etl_sql` column of the `tool_templates` table.
When loaded, it is parsed and set as the current `EtlModel`.
The model is compiled server-side to SQL via `POST /etl/compile`.

**The model is the source of truth. SQL is always derived — never stored directly.**

---

## 2. Top-Level Structure

```json
{
  "sources":            [ <Source>, ... ],
  "transformations":    [ <Transformation>, ... ],
  "final_relation_id":  "<relation_id>",
  "order_by":           [ <OrderByEntry>, ... ],
  "meta":               { "schema_version": 1 }
}
```

### Rules

| Field | Required | Constraint |
|-------|----------|------------|
| `sources` | yes | Non-empty array |
| `transformations` | yes | May be empty, but `final_relation_id` must reference a source if so |
| `final_relation_id` | yes | Must reference an `id` that exists in `sources` or `transformations` |
| `order_by` | yes | May be `[]` |
| `meta.schema_version` | yes | Must be `1` |

---

## 3. Relation IDs

Every source and transformation has an `id`. These are the node identifiers in the DAG.

- IDs must be unique across all sources and transformations
- IDs are referenced by `inputs`, `left_input`, `right_source`, and `final_relation_id`
- Convention: short alphanumeric strings like `"s1"`, `"t1"`, `"join1"` — no spaces

---

## 4. Sources

```json
{
  "id":    "s1",
  "type":  "table",
  "name":  "instrument_list",
  "alias": "il",
  "sql":   ""
}
```

| Field | Required | Values |
|-------|----------|--------|
| `id` | yes | Unique string |
| `type` | yes | `"table"` (common) \| `"cte"` \| `"subquery"` |
| `name` | yes | Tool slug (for `"table"`) or CTE name (for `"cte"`) |
| `alias` | yes | SQL alias used in column expressions (e.g. `"il"`) |
| `sql` | only for `"cte"` | Raw SQL for the CTE body — never parsed |

### Common aliases

Use initials of the slug: `instrument_list` → `il`, `cable_list` → `cl`, `io_list` → `iol`.

---

## 5. Transformations

Each transformation has:

```json
{
  "id":     "<unique_id>",
  "type":   "<type>",
  "inputs": ["<relation_id>", ...]
}
```

Plus type-specific fields described below.

### Execution order

The compiler ignores list order. It performs a **topological sort** of the DAG defined by `inputs`.
Order-independent; list transformations in any order.

---

### 5.1 SELECT

Projects columns. Always required somewhere on the path to `final_relation_id`.

```json
{
  "id":      "t1",
  "type":    "select",
  "inputs":  ["s1"],
  "columns": [
    { "id": "c1", "alias": "tag",     "expr": <Expression> },
    { "id": "c2", "alias": "service", "expr": <Expression> }
  ]
}
```

| Field | Constraint |
|-------|------------|
| `inputs` | Exactly 1 relation id |
| `columns` | Non-empty array; each column needs a unique `id`, a non-empty `alias`, and a valid `expr` |
| `alias` | Output column name in SQL `AS` clause — must be a valid SQL identifier |
| column `id` | Stable across saves; must be unique across ALL columns in ALL transformations |

---

### 5.2 FILTER

Applies a WHERE or HAVING clause.

```json
{
  "id":        "tf",
  "type":      "filter",
  "inputs":    ["t1"],
  "mode":      "where",
  "condition": <Expression>
}
```

| Field | Constraint |
|-------|------------|
| `inputs` | Exactly 1 relation id |
| `mode` | `"where"` or `"having"` — **required, never omitted or inferred** |
| `condition` | A valid boolean expression |

Use `"where"` for row-level filtering before aggregation.
Use `"having"` for post-aggregation filtering (must be placed after an AGGREGATE in the DAG).

---

### 5.3 JOIN

```json
{
  "id":           "tj",
  "type":         "join",
  "inputs":       ["s1", "s2"],
  "join_type":    "LEFT",
  "left_input":   "s1",
  "right_source": "s2",
  "alias":        "cl",
  "condition":    <Expression>
}
```

| Field | Constraint |
|-------|------------|
| `inputs` | Array containing both `left_input` and `right_source` |
| `join_type` | `"INNER"` \| `"LEFT"` \| `"RIGHT"` \| `"FULL"` (uppercase) |
| `left_input` | Relation id — must appear in `inputs` |
| `right_source` | **Must be a source id** (not a transformation id) |
| `alias` | SQL alias for the right-side table in the join |
| `condition` | Typically an equality `binary_op` on the join key |

---

### 5.4 AGGREGATE

```json
{
  "id":           "ta",
  "type":         "aggregate",
  "inputs":       ["t1"],
  "group_by":     [ <Expression>, ... ],
  "aggregations": [
    { "id": "c1", "alias": "cnt", "expr": <Expression> }
  ]
}
```

| Field | Constraint |
|-------|------------|
| `inputs` | Exactly 1 relation id |
| `group_by` | Array of expressions (typically `column_ref` nodes); may be empty for full-table aggregation |
| `aggregations` | Each entry must have unique `id`, non-empty `alias`, and a valid `expr` |
| bare `column_ref` in aggregations | Only allowed if the same column appears in `group_by` |
| aggregation `expr` | Must use an aggregate function: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, etc. |

---

### 5.5 COMPUTE\_COLUMN

Adds one computed column to the input relation (passes all existing columns through via `SELECT *`).

```json
{
  "id":     "tc",
  "type":   "compute_column",
  "inputs": ["t1"],
  "column": { "id": "c3", "alias": "voltage_kv", "expr": <Expression> }
}
```

| Field | Constraint |
|-------|------------|
| `inputs` | Exactly 1 relation id |
| `column` | Single column object with `id`, `alias`, and `expr` |

---

## 6. Expression Grammar (v1)

**All expressions are plain JSON objects with a `"type"` discriminator.**
**Every expression field must be a valid expression object — never a raw string, never `null` (except where explicitly stated below).**

---

### 6.1 `column_ref`

```json
{ "type": "column_ref", "column_name": "service", "table_alias": "il" }
```

- `column_name`: non-empty string; the column slug as defined in the schema
- `table_alias`: the alias assigned to the source in the sources array; use `""` only if unambiguous
- **Never use `column_name: "NULL"` to represent null — use `literal` with `value: null`**
- Compiles to: `"il"."service"` (always double-quoted)

---

### 6.2 `literal`

```json
{ "type": "literal", "value": <null | string | number | boolean> }
```

| JSON value | Compiles to |
|------------|-------------|
| `null` | `NULL` |
| `true` | `TRUE` |
| `false` | `FALSE` |
| `"O'Brien"` | `'O''Brien'` (single quotes escaped automatically) |
| `42` | `42` |
| `3.14` | `3.14` |

- `value` must be one of: `null`, `string`, `number`, `boolean` — no objects, no arrays

---

### 6.3 `function`

```json
{ "type": "function", "name": "COALESCE", "args": [ <expr>, <expr> ] }
```

- `name`: any SQL function name; compiled uppercased
- `args`: array of expressions; may be empty for zero-arg functions (e.g. `NOW()`)
- No `*` arguments — use `COUNT(1)` not `COUNT(*)`
- For string concatenation: use `CONCAT_WS` instead of `||`

```json
{ "type": "function", "name": "CONCAT_WS", "args": [
    { "type": "literal", "value": "-" },
    { "type": "column_ref", "column_name": "tag",     "table_alias": "il" },
    { "type": "column_ref", "column_name": "service", "table_alias": "il" }
]}
```

---

### 6.4 `binary_op`

```json
{ "type": "binary_op", "op": "=", "left": <expr>, "right": <expr> }
```

Allowed operators (exhaustive list):

```
=   !=   >   <   >=   <=   +   -   *   /
```

**Forbidden:**
- `AND`, `OR` — use `logical` instead
- `||` — use `CONCAT_WS` instead
- Any other operator not in the list above

**NULL comparison is forbidden:**
- `{ "op": "=", "right": { "type": "literal", "value": null } }` → **validation error**
- Use `is_null` / `is_not_null` for NULL checks

---

### 6.5 `logical`

```json
{ "type": "logical", "op": "and", "args": [ <expr>, <expr>, <expr> ] }
```

- `op`: `"and"` or `"or"` — **lowercase required**
- `args`: flat array, **minimum 2 elements**
- Never represent AND/OR as `binary_op`
- Nesting `logical` inside `logical` of the same op is allowed but prefer flat:

```json
{ "type": "logical", "op": "and", "args": [
    { "type": "binary_op", "op": ">",  "left": ..., "right": ... },
    { "type": "binary_op", "op": "!=", "left": ..., "right": ... },
    { "type": "binary_op", "op": "=",  "left": ..., "right": ... }
]}
```

---

### 6.6 `unary_op`

```json
{ "type": "unary_op", "op": "not", "expr": <expr> }
```

- `op`: must be `"not"` (only value supported in v1)
- `expr`: any valid expression

---

### 6.7 `is_null`

```json
{ "type": "is_null", "expr": <expr> }
```

- Use whenever checking if a value is NULL
- Compiles to: `(expr IS NULL)`

---

### 6.8 `is_not_null`

```json
{ "type": "is_not_null", "expr": <expr> }
```

- Compiles to: `(expr IS NOT NULL)`

---

### 6.9 `case`

```json
{
  "type": "case",
  "operand": null,
  "when_clauses": [
    { "when": <expr>, "then": <expr> },
    { "when": <expr>, "then": <expr> }
  ],
  "else": <expr_or_null>
}
```

| Field | Value |
|-------|-------|
| `operand` | `null` for searched CASE (condition in WHEN); expression for simple CASE (value in WHEN) |
| `when_clauses` | Non-empty array; each entry has `when` and `then` expressions |
| `"else"` | Expression for the ELSE branch, or `null` to omit ELSE entirely |

**Note:** the JSON key is `"else"` (not `"else_expr"`).

Simple CASE (operand present):
```json
{
  "type": "case",
  "operand": { "type": "column_ref", "column_name": "status", "table_alias": "il" },
  "when_clauses": [
    { "when": { "type": "literal", "value": "active" },   "then": { "type": "literal", "value": 1 } },
    { "when": { "type": "literal", "value": "inactive" }, "then": { "type": "literal", "value": 0 } }
  ],
  "else": { "type": "literal", "value": null }
}
```

---

## 7. Order By

```json
"order_by": [
  { "expr": <Expression>, "direction": "asc" },
  { "expr": <Expression>, "direction": "desc" }
]
```

- `direction`: `"asc"` or `"desc"`
- `expr`: typically a `column_ref` referencing a column in the final relation's output
- `column_ref` names in `order_by` are validated against the final relation's output aliases

---

## 8. Validation Rules (complete)

All of these are checked before compilation. Any violation returns a 422 error.

### Model-level

1. `final_relation_id` must not be empty
2. `final_relation_id` must reference an existing `id` in sources or transformations
3. Cycle in the transformation DAG → hard error, no recovery
4. No duplicate relation `id` values across sources and transformations
5. All column `id` values must be non-empty and unique across the entire model
6. All `inputs` references must resolve to existing relation ids
7. JOIN: `left_input` must appear in `inputs`
8. JOIN: `right_source` must be a **source id** (not a transformation id)
9. FILTER: `mode` must be `"where"` or `"having"`
10. At least one SELECT or AGGREGATE must exist on the dependency path to `final_relation_id`
11. AGGREGATE: a bare `column_ref` in `aggregations` (not wrapped in a function) must appear in `group_by`
12. ORDER BY `column_ref` names must exist in the final relation's output aliases

### Expression-level (recursive, all expressions)

13. Every expression must have a `"type"` field
14. `"type"` must be one of: `column_ref`, `literal`, `function`, `binary_op`, `logical`, `unary_op`, `is_null`, `is_not_null`, `case`
15. `binary_op.op` must be in `{ =, !=, >, <, >=, <=, +, -, *, / }`
16. `binary_op.op` must NOT be `AND` or `OR` (use `logical`)
17. `binary_op` with `op: "="` and `right` (or `left`) being `literal(null)` → forbidden (`= NULL` trap)
18. `logical.op` must be `"and"` or `"or"` (lowercase)
19. `logical.args` must have at least 2 elements
20. `unary_op.op` must be `"not"`
21. `case.when_clauses` must not be empty
22. `column_ref.column_name` must not be empty

---

## 9. DAG Topology Rules

- Sources have no inputs — they are leaf nodes
- Transformations consume one or more source/transformation outputs
- The DAG must be acyclic (Kahn's algorithm enforces this)
- Only the subgraph reachable from `final_relation_id` is compiled
- Unreachable transformations are silently ignored (they are compiled but their SQL is not used)

**Typical linear chain:**
```
s1 (source) → t1 (select) → tf (filter) → final_relation_id = "tf"
```

**Fan-in (JOIN):**
```
s1 ──┐
     ├→ tj (join) → ts (select) → final_relation_id = "ts"
s2 ──┘
```

---

## 10. Complete Examples

### Example A — Simple projection with filter

Select `tag` and `service` from `instrument_list` where `area` is not null.

```json
{
  "sources": [
    { "id": "s1", "type": "table", "name": "instrument_list", "alias": "il", "sql": "" }
  ],
  "transformations": [
    {
      "id": "ts", "type": "select", "inputs": ["s1"],
      "columns": [
        { "id": "c1", "alias": "tag",     "expr": { "type": "column_ref", "column_name": "tag",     "table_alias": "il" } },
        { "id": "c2", "alias": "service", "expr": { "type": "column_ref", "column_name": "service", "table_alias": "il" } },
        { "id": "c3", "alias": "area",    "expr": { "type": "column_ref", "column_name": "area",    "table_alias": "il" } }
      ]
    },
    {
      "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
      "condition": { "type": "is_not_null", "expr": { "type": "column_ref", "column_name": "area", "table_alias": "il" } }
    }
  ],
  "final_relation_id": "tf",
  "order_by": [
    { "expr": { "type": "column_ref", "column_name": "tag", "table_alias": "" }, "direction": "asc" }
  ],
  "meta": { "schema_version": 1 }
}
```

---

### Example B — Left join between two tools

Merge `instrument_list` with `cable_list` on `tag`.

```json
{
  "sources": [
    { "id": "s1", "type": "table", "name": "instrument_list", "alias": "il", "sql": "" },
    { "id": "s2", "type": "table", "name": "cable_list",      "alias": "cl", "sql": "" }
  ],
  "transformations": [
    {
      "id": "tj", "type": "join", "inputs": ["s1", "s2"],
      "join_type": "LEFT",
      "left_input": "s1",
      "right_source": "s2",
      "alias": "cl",
      "condition": {
        "type": "binary_op", "op": "=",
        "left":  { "type": "column_ref", "column_name": "tag", "table_alias": "il" },
        "right": { "type": "column_ref", "column_name": "tag", "table_alias": "cl" }
      }
    },
    {
      "id": "ts", "type": "select", "inputs": ["tj"],
      "columns": [
        { "id": "c1", "alias": "tag",      "expr": { "type": "column_ref", "column_name": "tag",      "table_alias": "il" } },
        { "id": "c2", "alias": "service",  "expr": { "type": "column_ref", "column_name": "service",  "table_alias": "il" } },
        { "id": "c3", "alias": "cable_id", "expr": { "type": "column_ref", "column_name": "cable_id", "table_alias": "cl" } }
      ]
    }
  ],
  "final_relation_id": "ts",
  "order_by": [],
  "meta": { "schema_version": 1 }
}
```

---

### Example C — Aggregation (count per area)

```json
{
  "sources": [
    { "id": "s1", "type": "table", "name": "instrument_list", "alias": "il", "sql": "" }
  ],
  "transformations": [
    {
      "id": "ta", "type": "aggregate", "inputs": ["s1"],
      "group_by": [
        { "type": "column_ref", "column_name": "area", "table_alias": "il" }
      ],
      "aggregations": [
        {
          "id": "c1", "alias": "area",
          "expr": { "type": "column_ref", "column_name": "area", "table_alias": "il" }
        },
        {
          "id": "c2", "alias": "instrument_count",
          "expr": { "type": "function", "name": "COUNT", "args": [ { "type": "literal", "value": 1 } ] }
        }
      ]
    }
  ],
  "final_relation_id": "ta",
  "order_by": [
    { "expr": { "type": "column_ref", "column_name": "area", "table_alias": "" }, "direction": "asc" }
  ],
  "meta": { "schema_version": 1 }
}
```

---

### Example D — Computed column with CASE

Add a `voltage_class` column based on `voltage` value.

```json
{
  "sources": [
    { "id": "s1", "type": "table", "name": "instrument_list", "alias": "il", "sql": "" }
  ],
  "transformations": [
    {
      "id": "ts", "type": "select", "inputs": ["s1"],
      "columns": [
        { "id": "c1", "alias": "tag",     "expr": { "type": "column_ref", "column_name": "tag",     "table_alias": "il" } },
        { "id": "c2", "alias": "voltage", "expr": { "type": "column_ref", "column_name": "voltage", "table_alias": "il" } }
      ]
    },
    {
      "id": "tc", "type": "compute_column", "inputs": ["ts"],
      "column": {
        "id": "c3", "alias": "voltage_class",
        "expr": {
          "type": "case",
          "operand": null,
          "when_clauses": [
            {
              "when": { "type": "binary_op", "op": ">=", "left": { "type": "column_ref", "column_name": "voltage", "table_alias": "" }, "right": { "type": "literal", "value": 1000 } },
              "then": { "type": "literal", "value": "HV" }
            },
            {
              "when": { "type": "binary_op", "op": ">=", "left": { "type": "column_ref", "column_name": "voltage", "table_alias": "" }, "right": { "type": "literal", "value": 100 } },
              "then": { "type": "literal", "value": "MV" }
            }
          ],
          "else": { "type": "literal", "value": "LV" }
        }
      }
    }
  ],
  "final_relation_id": "tc",
  "order_by": [],
  "meta": { "schema_version": 1 }
}
```

---

### Example E — Multi-condition filter (logical AND + OR)

```json
{
  "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
  "condition": {
    "type": "logical", "op": "and",
    "args": [
      {
        "type": "is_not_null",
        "expr": { "type": "column_ref", "column_name": "service", "table_alias": "il" }
      },
      {
        "type": "binary_op", "op": ">",
        "left":  { "type": "column_ref", "column_name": "voltage", "table_alias": "il" },
        "right": { "type": "literal", "value": 0 }
      },
      {
        "type": "logical", "op": "or",
        "args": [
          { "type": "binary_op", "op": "=", "left": { "type": "column_ref", "column_name": "area", "table_alias": "il" }, "right": { "type": "literal", "value": "A" } },
          { "type": "binary_op", "op": "=", "left": { "type": "column_ref", "column_name": "area", "table_alias": "il" }, "right": { "type": "literal", "value": "B" } }
        ]
      }
    ]
  }
}
```

---

## 11. Forbidden Patterns (will fail validation)

```jsonc
// ❌ AND as binary_op
{ "type": "binary_op", "op": "AND", ... }

// ❌ = NULL
{ "type": "binary_op", "op": "=", "right": { "type": "literal", "value": null } }

// ❌ || concatenation
{ "type": "binary_op", "op": "||", ... }

// ❌ Unknown type
{ "type": "expr_sql", "sql": "il.tag" }
{ "type": "raw", ... }

// ❌ logical with only 1 arg
{ "type": "logical", "op": "and", "args": [ <one_expr> ] }

// ❌ unary_op with op other than "not"
{ "type": "unary_op", "op": "minus", ... }

// ❌ case with empty when_clauses
{ "type": "case", "when_clauses": [], ... }

// ❌ logical.op uppercase
{ "type": "logical", "op": "AND", ... }

// ❌ COUNT(*)
{ "type": "function", "name": "COUNT", "args": [] }  // use COUNT(1)

// ❌ right_source pointing to a transformation
{ "right_source": "tj" }   // must be a source id

// ❌ final_relation_id pointing to nothing
{ "final_relation_id": "" }
```

---

## 12. Column IDs

Column IDs (`"id"` inside each column object) must:

- Be non-empty strings
- Be unique across ALL columns in ALL transformations (not just within one transformation)
- Remain stable across edits (do not regenerate them)

Convention: use short strings like `"c1"`, `"c2"`, or UUIDs. Do not reuse IDs from deleted columns.

---

## 13. System Columns

The tool table always contains system columns (`tag`, `rev`, `log`) and internal columns (`__id`, `__position`, `__log`, `__created_at`).

- `tag` is the merge key for ETL apply — the output SELECT **must include a `tag` column** (alias `"tag"`)
- If `tag` is missing, the ETL apply will produce a warning and may fail to merge rows
- Internal columns (`__id` etc.) must never appear in a SELECT column list

---

## 15. generate\_series Source

Produces a virtual single-column table of consecutive integers. It has no inputs — it is a source, not a transformation.

### Schema

```json
{
  "id":       "gs1",
  "type":     "generate_series",
  "name":     "_generate_series",
  "alias":    "n",
  "sql":      "",
  "start":    1,
  "end_expr": <Expression>
}
```

| Field | Required | Constraint |
|-------|----------|------------|
| `id` | yes | Unique relation id |
| `type` | yes | Must be `"generate_series"` |
| `name` | yes | Use `"_generate_series"` (internal sentinel) |
| `alias` | yes | Output column name — used in column_ref expressions (e.g. `"n"`) |
| `sql` | yes | Always `""` |
| `start` | yes | Integer ≥ 1 |
| `end_expr` | yes | Any valid numeric Expression |

### Compilation

Compiles to an inline `WITH RECURSIVE` subquery (requires SQLite ≥ 3.35):

```sql
(WITH RECURSIVE _gs_<id>(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM _gs_<id> WHERE n < <end_expr>
) SELECT n FROM _gs_<id>)
```

### Example — generate 1..5

```json
{
  "id": "gs1", "type": "generate_series",
  "name": "_generate_series", "alias": "n", "sql": "",
  "start": 1, "end_expr": { "type": "literal", "value": 5 }
}
```

### Recommended join pattern

Use `generate_series` as the right side of a JOIN, then filter `n <= <bound>`:

```json
{
  "sources": [
    { "id": "s1", "type": "table", "name": "instrument_list", "alias": "il", "sql": "" },
    {
      "id": "gs1", "type": "generate_series",
      "name": "_generate_series", "alias": "n", "sql": "",
      "start": 1, "end_expr": { "type": "literal", "value": 10 }
    }
  ],
  "transformations": [
    {
      "id": "tj", "type": "join", "inputs": ["s1", "gs1"],
      "join_type": "INNER",
      "left_input": "s1",
      "right_source": "gs1",
      "alias": "n",
      "condition": {
        "type": "binary_op", "op": "<=",
        "left": { "type": "column_ref", "column_name": "n", "table_alias": "" },
        "right": {
          "type": "function", "name": "LENGTH",
          "args": [{ "type": "column_ref", "column_name": "cables", "table_alias": "il" }]
        }
      }
    },
    {
      "id": "ts", "type": "select", "inputs": ["tj"],
      "columns": [
        { "id": "c1", "alias": "tag",  "expr": { "type": "column_ref", "column_name": "tag",  "table_alias": "il" } },
        { "id": "c2", "alias": "n",    "expr": { "type": "column_ref", "column_name": "n",    "table_alias": "" } }
      ]
    }
  ],
  "final_relation_id": "ts",
  "order_by": [],
  "meta": { "schema_version": 1 }
}
```

### Notes

- `end_expr` may be a column_ref — but it is evaluated in the CTE definition scope, not per-row. For per-row bounds, set a safe literal upper limit and filter with `n <= <column_expr>` in the JOIN condition.
- `generate_series` sources are valid as `right_source` in a JOIN.
- The CTE name is auto-generated as `_gs_<id prefix>` — no collision risk with user-defined CTE sources.

---

## 16. SPLIT\_PART Expression

Extracts the nth token from a delimiter-separated string. Stored as a `function` node with name `"SPLIT_PART"`.

### Syntax

```json
{
  "type": "function",
  "name": "SPLIT_PART",
  "args": [
    <string_expr>,
    { "type": "literal", "value": "<delimiter>" },
    { "type": "literal", "value": <n> }
  ]
}
```

| Arg | Position | Constraint |
|-----|----------|------------|
| string expression | 1 | Any valid expression producing a string |
| delimiter | 2 | String literal (any single or multi-character delimiter) |
| index | 3 | **Literal integer, 1-based, 1–8** |

### Behavior

Extracts the nth delimiter-separated token, 1-indexed. If fewer than n tokens exist, returns the last available token (tail behavior — not an error).

```
SPLIT_PART("A|B|C", "|", 1) → "A"
SPLIT_PART("A|B|C", "|", 2) → "B"
SPLIT_PART("A|B|C", "|", 3) → "C"
```

### Compilation (SQLite)

Compiles to nested `CASE / INSTR / SUBSTR` expressions. For `n=1`:

```sql
CASE WHEN INSTR("t"."cables", '|') > 0
     THEN SUBSTR("t"."cables", 1, INSTR("t"."cables", '|') - 1)
     ELSE "t"."cables" END
```

For `n=2`, a second `SUBSTR` is wrapped around the inner expression. SQL grows with each level but remains correct for all n ≤ 8.

### Examples

**First token of a pipe-separated column:**

```json
{
  "type": "function", "name": "SPLIT_PART",
  "args": [
    { "type": "column_ref", "column_name": "cables", "table_alias": "il" },
    { "type": "literal", "value": "|" },
    { "type": "literal", "value": 1 }
  ]
}
```

**Second token:**

```json
{
  "type": "function", "name": "SPLIT_PART",
  "args": [
    { "type": "column_ref", "column_name": "cables", "table_alias": "il" },
    { "type": "literal", "value": "|" },
    { "type": "literal", "value": 2 }
  ]
}
```

### Validation rules

- Must have exactly 3 arguments — validation error otherwise
- 3rd argument must be a literal integer — non-literal index is a validation error
- Index must be ≥ 1 and ≤ 8 — exceeded limit is a validation error

### SQL → IR conversion (sql\_to\_model)

The converter rewrites two patterns automatically:

| SQL pattern | Converted to |
|-------------|--------------|
| `SPLIT_PART(s, d, n)` (Postgres native) | `function("SPLIT_PART", [s, d, n])` |
| `SUBSTR(s, 1, INSTR(s, d) - 1)` | `function("SPLIT_PART", [s, d, 1])` |

More complex SUBSTR chains are not auto-detected and must be rewritten manually.

---

## 17. Migration Guide — Deprecated SQL Patterns

### Why SUBSTR-based parsing is deprecated in IR

Nested `SUBSTR/INSTR` chains are:
- Opaque — intent is hidden inside string manipulation logic
- Fragile — delimiter escaping is not handled
- Not portable — differ between SQLite and Postgres
- Not validatable — the compiler has no way to check correctness

The IR replaces them with `SPLIT_PART`, which is:
- Declarative — index and delimiter are explicit
- Validated — arity, type, and range checked before compilation
- Compiler-translated — the SQLite SQL is generated correctly and consistently

### How to rewrite old models

**Before (deprecated):**

```json
{
  "type": "function", "name": "SUBSTR",
  "args": [
    { "type": "column_ref", "column_name": "cables", "table_alias": "il" },
    { "type": "literal", "value": 1 },
    {
      "type": "binary_op", "op": "-",
      "left": {
        "type": "function", "name": "INSTR",
        "args": [
          { "type": "column_ref", "column_name": "cables", "table_alias": "il" },
          { "type": "literal", "value": "|" }
        ]
      },
      "right": { "type": "literal", "value": 1 }
    }
  ]
}
```

**After (canonical):**

```json
{
  "type": "function", "name": "SPLIT_PART",
  "args": [
    { "type": "column_ref", "column_name": "cables", "table_alias": "il" },
    { "type": "literal", "value": "|" },
    { "type": "literal", "value": 1 }
  ]
}
```

### Recommended pattern for multi-value column expansion

Use `generate_series` + `SPLIT_PART` together:

```
s1 (table: instrument_list)
gs1 (generate_series: 1..10)
tj (join s1 × gs1, condition: n <= token_count(cables))
tc (compute_column: SPLIT_PART(cables, "|", n))
ts (select: tag, n, cable_token)
```

This replaces old SQL like:

```sql
WITH nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n < 10)
SELECT
  il.tag,
  nums.n,
  SUBSTR(il.cables, ..., INSTR(...) - 1) AS cable_token
FROM instrument_list il
CROSS JOIN nums
WHERE nums.n <= LENGTH(il.cables) - LENGTH(REPLACE(il.cables,'|','')) + 1
```

The `sql_to_model` converter detects the recursive CTE and UNION ALL patterns automatically and produces the equivalent `generate_series` source. The `SUBSTR(s, 1, INSTR(s, d) - 1)` idiom is also auto-detected and rewritten to `SPLIT_PART(s, d, 1)`.

---

## 14. Checklist Before Saving

- [ ] `meta.schema_version` is `1`
- [ ] `final_relation_id` references an existing relation id
- [ ] All relation ids are unique
- [ ] All column ids are unique across the entire model
- [ ] Every `inputs` array references valid relation ids
- [ ] At least one SELECT or AGGREGATE on path to `final_relation_id`
- [ ] Output SELECT includes a `tag` column
- [ ] No `expr_sql` nodes
- [ ] No `binary_op` with `op: "AND"` or `op: "OR"` or `op: "||"`
- [ ] No `= NULL` comparisons — use `is_null`
- [ ] All `logical` nodes have at least 2 args and `op` in lowercase
- [ ] JOIN `right_source` is a source id, not a transformation id
- [ ] FILTER has explicit `mode: "where"` or `mode: "having"`
