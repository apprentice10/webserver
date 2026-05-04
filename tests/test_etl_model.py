from engine.etl_compiler import compile_sql, validate_model, EtlValidationError
from engine.etl_model import model_from_dict
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _valid(model_dict: dict) -> None:
    errors = validate_model(model_from_dict(model_dict))
    assert errors == [], f"Unexpected validation errors: {errors}"


def _col_ref(name: str, alias: str = "") -> dict:
    return {"type": "column_ref", "column_name": name, "table_alias": alias}


def _lit(value) -> dict:
    return {"type": "literal", "value": value}


def _fn(name: str, *args) -> dict:
    return {"type": "function", "name": name, "args": list(args)}


def _binop(op: str, left: dict, right: dict) -> dict:
    return {"type": "binary_op", "op": op, "left": left, "right": right}


# ---------------------------------------------------------------------------
# Test 1 — Simple select
# ---------------------------------------------------------------------------

def test_simple_select():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [
                {"id": "c1", "alias": "tag",     "expr": _col_ref("tag",     "il")},
                {"id": "c2", "alias": "service", "expr": _col_ref("service", "il")},
                {"id": "c3", "alias": "area",    "expr": _col_ref("area",    "il")},
            ],
        }],
        "final_relation_id": "t1",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert '"il"."tag" AS tag' in sql
    assert '"il"."service" AS service' in sql
    assert '"il"."area" AS area' in sql
    assert "instrument_list il" in sql
    assert sql.upper().startswith("SELECT")


# ---------------------------------------------------------------------------
# Test 2 — Join + filter
# ---------------------------------------------------------------------------

def test_join_and_filter():
    model = {
        "sources": [
            {"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"},
            {"id": "s2", "type": "table", "name": "cable_list",       "alias": "cl"},
        ],
        "transformations": [
            {
                "id": "tj", "type": "join", "inputs": ["s1", "s2"],
                "join_type": "left", "left_input": "s1", "right_source": "s2", "alias": "cl",
                "condition": _binop("=", _col_ref("tag", "il"), _col_ref("tag", "cl")),
            },
            {
                "id": "tf", "type": "filter", "inputs": ["tj"], "mode": "where",
                "condition": _binop(">", _col_ref("area", "il"), _lit(0)),
            },
            {
                "id": "ts", "type": "select", "inputs": ["tf"],
                "columns": [
                    {"id": "c1", "alias": "tag",      "expr": _col_ref("tag",      "il")},
                    {"id": "c2", "alias": "cable_id", "expr": _col_ref("cable_id", "cl")},
                ],
            },
        ],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "LEFT JOIN" in sql
    assert "WHERE" in sql
    assert '("il"."tag" = "cl"."tag")' in sql
    assert '("il"."area" > 0)' in sql
    assert '"il"."tag" AS tag' in sql
    assert '"cl"."cable_id" AS cable_id' in sql


# ---------------------------------------------------------------------------
# Test 3 — Aggregation  (COUNT(1) — COUNT(*) is not a valid expression node)
# ---------------------------------------------------------------------------

def test_aggregation():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "ta", "type": "aggregate", "inputs": ["s1"],
            "group_by": [_col_ref("tag", "il")],
            "aggregations": [
                {
                    "id": "c1", "alias": "cnt",
                    "expr": _fn("COUNT", _lit(1)),
                },
            ],
        }],
        "final_relation_id": "ta",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "GROUP BY" in sql
    assert "COUNT(1)" in sql
    assert '"il"."tag"' in sql
    assert "cnt" in sql


# ---------------------------------------------------------------------------
# Test 4 — Computed column (BinaryOp expression)
# ---------------------------------------------------------------------------

def test_compute_column():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [
            {
                "id": "ts", "type": "select", "inputs": ["s1"],
                "columns": [
                    {"id": "c1", "alias": "tag",   "expr": _col_ref("tag",   "il")},
                    {"id": "c2", "alias": "value", "expr": _col_ref("value", "il")},
                ],
            },
            {
                "id": "tc", "type": "compute_column", "inputs": ["ts"],
                "column": {
                    "id": "c3", "alias": "double_value",
                    "expr": _binop("*", _col_ref("value"), _lit(2)),
                },
            },
        ],
        "final_relation_id": "tc",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "SELECT *" in sql
    assert '("value" * 2) AS double_value' in sql


# ---------------------------------------------------------------------------
# Test 5 — Nested expression: UPPER(CONCAT_WS('-', tag, service))
# ---------------------------------------------------------------------------

def test_nested_expression():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [
                {
                    "id": "c1", "alias": "tag",
                    "expr": _col_ref("tag", "il"),
                },
                {
                    "id": "c2", "alias": "label",
                    "expr": _fn("UPPER", _fn("CONCAT_WS",
                        _lit("-"),
                        _col_ref("tag",     "il"),
                        _col_ref("service", "il"),
                    )),
                },
            ],
        }],
        "final_relation_id": "t1",
        "order_by": [
            {"expr": _col_ref("tag"), "direction": "asc"},
        ],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "UPPER(" in sql
    assert "CONCAT_WS(" in sql
    assert '"il"."tag"' in sql
    assert '"il"."service"' in sql
    assert "'-'" in sql
    assert 'ORDER BY "tag" ASC' in sql


# ---------------------------------------------------------------------------
# Test 6 — Logical AND / OR (flat, not nested binary)
# ---------------------------------------------------------------------------

def test_logical_and_or():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [
            {
                "id": "ts", "type": "select", "inputs": ["s1"],
                "columns": [{"id": "c1", "alias": "tag", "expr": _col_ref("tag", "il")}],
            },
            {
                "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
                "condition": {
                    "type": "logical", "op": "and",
                    "args": [
                        _binop(">",  _col_ref("voltage", "il"), _lit(0)),
                        _binop("!=", _col_ref("status",  "il"), _lit("inactive")),
                        {
                            "type": "logical", "op": "or",
                            "args": [
                                _binop("=", _col_ref("area", "il"), _lit("A")),
                                _binop("=", _col_ref("area", "il"), _lit("B")),
                            ],
                        },
                    ],
                },
            },
        ],
        "final_relation_id": "tf",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert " AND " in sql
    assert " OR " in sql
    assert '("il"."voltage" > 0)' in sql
    assert '("il"."status" != \'inactive\')' in sql


# ---------------------------------------------------------------------------
# Test 7 — UnaryOp NOT
# ---------------------------------------------------------------------------

def test_unary_op_not():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [
            {
                "id": "ts", "type": "select", "inputs": ["s1"],
                "columns": [{"id": "c1", "alias": "tag", "expr": _col_ref("tag", "il")}],
            },
            {
                "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
                "condition": {
                    "type": "unary_op", "op": "not",
                    "expr": _binop("=", _col_ref("status", "il"), _lit("inactive")),
                },
            },
        ],
        "final_relation_id": "tf",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "(NOT " in sql
    assert '("il"."status" = \'inactive\')' in sql


# ---------------------------------------------------------------------------
# Test 8 — IS NULL / IS NOT NULL
# ---------------------------------------------------------------------------

def test_is_null_is_not_null():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [
                {"id": "c1", "alias": "tag", "expr": _col_ref("tag", "il")},
                {
                    "id": "c2", "alias": "has_cable",
                    "expr": {
                        "type": "case",
                        "operand": None,
                        "when_clauses": [
                            {
                                "when": {"type": "is_not_null", "expr": _col_ref("cable_id", "il")},
                                "then": _lit("yes"),
                            },
                        ],
                        "else": _lit("no"),
                    },
                },
            ],
        }],
        "final_relation_id": "t1",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "IS NOT NULL" in sql
    assert "CASE WHEN" in sql
    assert "'yes'" in sql
    assert "'no'" in sql


# ---------------------------------------------------------------------------
# Test 9 — CASE searched form
# ---------------------------------------------------------------------------

def test_case_searched():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [
                {"id": "c1", "alias": "tag", "expr": _col_ref("tag", "il")},
                {
                    "id": "c2", "alias": "category",
                    "expr": {
                        "type": "case",
                        "operand": None,
                        "when_clauses": [
                            {"when": _binop(">=", _col_ref("voltage", "il"), _lit(400)), "then": _lit("HV")},
                            {"when": _binop(">=", _col_ref("voltage", "il"), _lit(100)), "then": _lit("MV")},
                        ],
                        "else": _lit("LV"),
                    },
                },
            ],
        }],
        "final_relation_id": "t1",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "CASE WHEN" in sql
    assert "ELSE 'LV' END" in sql
    assert "'HV'" in sql
    assert "'MV'" in sql


# ---------------------------------------------------------------------------
# Validation error cases — structural
# ---------------------------------------------------------------------------

def test_missing_final_relation_id():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x", "t")}],
        }],
        "final_relation_id": "",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("final_relation_id" in e for e in errors)


def test_cycle_detection():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [
            {"id": "t1", "type": "select", "inputs": ["t2"],
             "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x")}]},
            {"id": "t2", "type": "select", "inputs": ["t1"],
             "columns": [{"id": "c2", "alias": "y", "expr": _col_ref("y")}]},
        ],
        "final_relation_id": "t2",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("cycle" in e.lower() for e in errors)


def test_filter_invalid_mode():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [
            {"id": "tf", "type": "filter", "inputs": ["s1"], "mode": "invalid",
             "condition": _binop("=", _col_ref("x"), _lit(1))},
            {"id": "ts", "type": "select", "inputs": ["tf"],
             "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x")}]},
        ],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("mode" in e for e in errors)


def test_compile_raises_on_invalid_model():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x")}],
        }],
        "final_relation_id": "nonexistent",
        "order_by": [],
        "meta": {},
    }
    with pytest.raises(EtlValidationError):
        compile_sql(model)


# ---------------------------------------------------------------------------
# Validation error cases — expression grammar
# ---------------------------------------------------------------------------

def test_binary_op_and_forbidden():
    """AND must not appear as binary_op — use logical instead."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [
            {
                "id": "ts", "type": "select", "inputs": ["s1"],
                "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x")}],
            },
            {
                "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
                "condition": {
                    "type": "binary_op", "op": "AND",
                    "left":  _binop("=", _col_ref("a"), _lit(1)),
                    "right": _binop("=", _col_ref("b"), _lit(2)),
                },
            },
        ],
        "final_relation_id": "tf",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("AND" in e or "logical" in e for e in errors)


def test_binary_op_eq_null_forbidden():
    """= NULL must be rejected — use is_null instead."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [
            {
                "id": "ts", "type": "select", "inputs": ["s1"],
                "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x")}],
            },
            {
                "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
                "condition": _binop("=", _col_ref("status"), _lit(None)),
            },
        ],
        "final_relation_id": "tf",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("NULL" in e or "is_null" in e for e in errors)


def test_binary_op_pipe_concat_forbidden():
    """|| is not an allowed binary_op operator."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{
                "id": "c1", "alias": "label",
                "expr": {
                    "type": "binary_op", "op": "||",
                    "left":  _col_ref("a"),
                    "right": _col_ref("b"),
                },
            }],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("||" in e or "not allowed" in e for e in errors)


def test_logical_requires_two_args():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [
            {
                "id": "ts", "type": "select", "inputs": ["s1"],
                "columns": [{"id": "c1", "alias": "x", "expr": _col_ref("x")}],
            },
            {
                "id": "tf", "type": "filter", "inputs": ["ts"], "mode": "where",
                "condition": {"type": "logical", "op": "and", "args": [_binop("=", _col_ref("x"), _lit(1))]},
            },
        ],
        "final_relation_id": "tf",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("2" in e or "least" in e for e in errors)


def test_unknown_expression_type_rejected():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{"id": "c1", "alias": "x", "expr": {"type": "raw_sql", "sql": "1"}}],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {},
    }
    errors = validate_model(model_from_dict(model))
    assert any("raw_sql" in e or "unknown" in e.lower() for e in errors)
