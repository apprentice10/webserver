from engine.etl_compiler import compile_sql, validate_model, EtlValidationError
from engine.etl_model import model_from_dict
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _valid(model_dict: dict) -> None:
    """Assert validate_model returns no errors."""
    errors = validate_model(model_from_dict(model_dict))
    assert errors == [], f"Unexpected validation errors: {errors}"


# ---------------------------------------------------------------------------
# Test 1 — Simple select
# ---------------------------------------------------------------------------

def test_simple_select():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [
                {"id": "c1", "alias": "tag",     "expr": {"type": "expr_sql", "sql": "il.tag"}},
                {"id": "c2", "alias": "service", "expr": {"type": "expr_sql", "sql": "il.service"}},
                {"id": "c3", "alias": "area",    "expr": {"type": "expr_sql", "sql": "il.area"}},
            ],
        }],
        "final_relation_id": "t1",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "il.tag AS tag" in sql
    assert "il.service AS service" in sql
    assert "il.area AS area" in sql
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
                "condition": {
                    "type": "binary_op", "op": "=",
                    "left":  {"type": "column_ref", "column_name": "tag", "table_alias": "il"},
                    "right": {"type": "column_ref", "column_name": "tag", "table_alias": "cl"},
                },
            },
            {
                "id": "tf", "type": "filter", "inputs": ["tj"], "mode": "where",
                "condition": {
                    "type": "binary_op", "op": ">",
                    "left":  {"type": "column_ref", "column_name": "area", "table_alias": "il"},
                    "right": {"type": "literal", "value": 0},
                },
            },
            {
                "id": "ts", "type": "select", "inputs": ["tf"],
                "columns": [
                    {"id": "c1", "alias": "tag",      "expr": {"type": "column_ref", "column_name": "tag",      "table_alias": "il"}},
                    {"id": "c2", "alias": "cable_id", "expr": {"type": "column_ref", "column_name": "cable_id", "table_alias": "cl"}},
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
    assert "(il.tag = cl.tag)" in sql
    assert "(il.area > 0)" in sql
    assert "il.tag AS tag" in sql
    assert "cl.cable_id AS cable_id" in sql


# ---------------------------------------------------------------------------
# Test 3 — Aggregation
# ---------------------------------------------------------------------------

def test_aggregation():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "ta", "type": "aggregate", "inputs": ["s1"],
            "group_by": [{"type": "column_ref", "column_name": "tag", "table_alias": "il"}],
            "aggregations": [
                {
                    "id": "c1", "alias": "cnt",
                    "expr": {"type": "function_call", "name": "COUNT",
                             "args": [{"type": "expr_sql", "sql": "*"}]},
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
    assert "COUNT(*)" in sql
    assert "il.tag" in sql
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
                    {"id": "c1", "alias": "tag",   "expr": {"type": "column_ref", "column_name": "tag",   "table_alias": "il"}},
                    {"id": "c2", "alias": "value", "expr": {"type": "column_ref", "column_name": "value", "table_alias": "il"}},
                ],
            },
            {
                "id": "tc", "type": "compute_column", "inputs": ["ts"],
                "column": {
                    "id": "c3", "alias": "double_value",
                    "expr": {
                        "type": "binary_op", "op": "*",
                        "left":  {"type": "column_ref", "column_name": "value", "table_alias": ""},
                        "right": {"type": "literal", "value": 2},
                    },
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
    assert "(value * 2) AS double_value" in sql


# ---------------------------------------------------------------------------
# Test 5 — Complex nested expression (FunctionCall wrapping BinaryOp)
# ---------------------------------------------------------------------------

def test_nested_expression():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "instrument_list", "alias": "il"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [
                {
                    "id": "c1", "alias": "tag",
                    "expr": {"type": "column_ref", "column_name": "tag", "table_alias": "il"},
                },
                {
                    "id": "c2", "alias": "label",
                    "expr": {
                        "type": "function_call", "name": "UPPER",
                        "args": [{
                            "type": "binary_op", "op": "||",
                            "left": {"type": "column_ref", "column_name": "tag", "table_alias": "il"},
                            "right": {
                                "type": "binary_op", "op": "||",
                                "left":  {"type": "literal", "value": "-"},
                                "right": {"type": "column_ref", "column_name": "service", "table_alias": "il"},
                            },
                        }],
                    },
                },
            ],
        }],
        "final_relation_id": "t1",
        "order_by": [
            {"expr": {"type": "column_ref", "column_name": "tag", "table_alias": ""}, "direction": "asc"},
        ],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "UPPER(" in sql
    assert "il.tag" in sql
    assert "il.service" in sql
    assert "'-'" in sql
    assert "ORDER BY tag ASC" in sql


# ---------------------------------------------------------------------------
# Validation error cases
# ---------------------------------------------------------------------------

def test_missing_final_relation_id():
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t"}],
        "transformations": [{
            "id": "t1", "type": "select", "inputs": ["s1"],
            "columns": [{"id": "c1", "alias": "x", "expr": {"type": "expr_sql", "sql": "t.x"}}],
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
             "columns": [{"id": "c1", "alias": "x", "expr": {"type": "expr_sql", "sql": "x"}}]},
            {"id": "t2", "type": "select", "inputs": ["t1"],
             "columns": [{"id": "c2", "alias": "y", "expr": {"type": "expr_sql", "sql": "y"}}]},
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
             "condition": {"type": "expr_sql", "sql": "1=1"}},
            {"id": "ts", "type": "select", "inputs": ["tf"],
             "columns": [{"id": "c1", "alias": "x", "expr": {"type": "expr_sql", "sql": "x"}}]},
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
            "columns": [{"id": "c1", "alias": "x", "expr": {"type": "expr_sql", "sql": "x"}}],
        }],
        "final_relation_id": "nonexistent",
        "order_by": [],
        "meta": {},
    }
    with pytest.raises(EtlValidationError):
        compile_sql(model)
