from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Expression types (discriminated via "type" field; stored as plain dicts)
# ---------------------------------------------------------------------------

@dataclass
class ColumnRef:
    type: str = "column_ref"
    column_name: str = ""
    table_alias: str = ""          # optional qualifier — empty means unqualified


@dataclass
class Literal:
    type: str = "literal"
    value: Any = None


@dataclass
class BinaryOp:
    type: str = "binary_op"
    op: str = ""                   # +, -, *, /, =, !=, <, >, <=, >=, AND, OR, …
    left: dict = field(default_factory=dict)
    right: dict = field(default_factory=dict)


@dataclass
class FunctionCall:
    type: str = "function_call"
    name: str = ""
    args: list = field(default_factory=list)


@dataclass
class ExprSql:
    # OPAQUE — NEVER parsed, NEVER inspected, NEVER used for dep inference.
    # The system MUST function correctly even if this is treated as a black box.
    type: str = "expr_sql"
    sql: str = ""


# ---------------------------------------------------------------------------
# Column — an output column produced by a transformation
# ---------------------------------------------------------------------------

@dataclass
class Column:
    id: str = ""        # stable UUID — must never change after creation
    alias: str = ""     # output column name in SQL AS clause
    expr: dict = field(default_factory=dict)   # any Expression dict


# ---------------------------------------------------------------------------
# Source — base relation (table, CTE, or subquery)
# ---------------------------------------------------------------------------

@dataclass
class Source:
    id: str = ""
    type: str = ""      # "table" | "cte" | "subquery"
    name: str = ""      # tool slug for "table", CTE name for "cte"
    alias: str = ""     # SQL alias used in expressions
    sql: str = ""       # ONLY for type="cte"; never parsed at runtime


# ---------------------------------------------------------------------------
# Transformation types
# Each has: id, type, inputs: list[str] (relation ids — always a list)
# ---------------------------------------------------------------------------

@dataclass
class SelectTransformation:
    id: str = ""
    type: str = "select"
    inputs: list = field(default_factory=list)
    columns: list = field(default_factory=list)   # list[Column dict]


@dataclass
class FilterTransformation:
    id: str = ""
    type: str = "filter"
    inputs: list = field(default_factory=list)
    condition: dict = field(default_factory=dict)  # Expression dict
    mode: str = "where"   # "where" | "having" — REQUIRED, never inferred


@dataclass
class JoinTransformation:
    id: str = ""
    type: str = "join"
    inputs: list = field(default_factory=list)
    join_type: str = "inner"      # "inner" | "left" | "right" | "full"
    left_input: str = ""          # relation id (source or transformation output)
    right_source: str = ""        # source id (future: any relation id)
    alias: str = ""               # SQL alias for the right-side source
    condition: dict = field(default_factory=dict)   # Expression dict


@dataclass
class AggregateTransformation:
    id: str = ""
    type: str = "aggregate"
    inputs: list = field(default_factory=list)
    group_by: list = field(default_factory=list)        # list[Expression dict]
    aggregations: list = field(default_factory=list)    # list[Column dict]


@dataclass
class ComputeColumnTransformation:
    id: str = ""
    type: str = "compute_column"
    inputs: list = field(default_factory=list)
    column: dict = field(default_factory=dict)   # Column dict


# ---------------------------------------------------------------------------
# Root model
# ---------------------------------------------------------------------------

@dataclass
class EtlModel:
    sources: list = field(default_factory=list)           # list[Source dict]
    transformations: list = field(default_factory=list)   # list[Transformation dict]
    final_relation_id: str = ""   # REQUIRED — relation that defines ETL output
    order_by: list = field(default_factory=list)          # list[{expr, direction}]
    meta: dict = field(default_factory=dict)              # must include schema_version: 1


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def model_to_dict(model: EtlModel) -> dict:
    return asdict(model)


def model_from_dict(d: dict) -> EtlModel:
    return EtlModel(
        sources=d.get("sources", []),
        transformations=d.get("transformations", []),
        final_relation_id=d.get("final_relation_id", ""),
        order_by=d.get("order_by", []),
        meta=d.get("meta", {}),
    )
