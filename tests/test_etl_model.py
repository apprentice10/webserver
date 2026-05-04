from engine.etl_compiler import compile_sql, validate_model, EtlValidationError
from engine.etl_model import model_from_dict
from engine.sql_to_model import sql_to_model
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


# ---------------------------------------------------------------------------
# generate_series — compilation
# ---------------------------------------------------------------------------

def _gs_source(rid: str, alias: str, start: int, end_val: int) -> dict:
    return {
        "id": rid, "type": "generate_series",
        "name": "_generate_series", "alias": alias, "sql": "",
        "start": start, "end_expr": _lit(end_val),
    }


def test_generate_series_basic():
    """generate_series compiles to a WITH RECURSIVE subquery."""
    model = {
        "sources": [_gs_source("gs1", "n", 1, 5)],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["gs1"],
            "columns": [{"id": "c1", "alias": "n", "expr": _col_ref("n")}],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "WITH RECURSIVE" in sql
    assert "UNION ALL" in sql
    # column alias appears in output
    assert '"n" AS n' in sql


def test_generate_series_validation_errors():
    """Missing alias and non-integer start are caught by validate_model."""
    model_bad_start = {
        "sources": [{
            "id": "gs1", "type": "generate_series",
            "name": "_generate_series", "alias": "n", "sql": "",
            "start": "one",   # ← wrong type
            "end_expr": _lit(10),
        }],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["gs1"],
            "columns": [{"id": "c1", "alias": "n", "expr": _col_ref("n")}],
        }],
        "final_relation_id": "ts", "order_by": [], "meta": {"schema_version": 1},
    }
    errors = validate_model(model_from_dict(model_bad_start))
    assert any("start" in e for e in errors)

    model_no_alias = {
        "sources": [{
            "id": "gs1", "type": "generate_series",
            "name": "_generate_series", "alias": "", "sql": "",  # ← empty alias
            "start": 1, "end_expr": _lit(10),
        }],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["gs1"],
            "columns": [{"id": "c1", "alias": "n", "expr": _col_ref("n")}],
        }],
        "final_relation_id": "ts", "order_by": [], "meta": {"schema_version": 1},
    }
    errors2 = validate_model(model_from_dict(model_no_alias))
    assert any("alias" in e for e in errors2)


def test_generate_series_cross_join_filter():
    """Typical pattern: data CROSS JOIN generate_series, filtered by n <= token_count."""
    model = {
        "sources": [
            {"id": "s1", "type": "table", "name": "instrument_list", "alias": "il", "sql": ""},
            _gs_source("gs1", "n", 1, 10),
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
                    "left": _col_ref("n"),
                    "right": {
                        "type": "function", "name": "LENGTH",
                        "args": [_col_ref("cables", "il")],
                    },
                },
            },
            {
                "id": "ts", "type": "select", "inputs": ["tj"],
                "columns": [
                    {"id": "c1", "alias": "tag",  "expr": _col_ref("tag",  "il")},
                    {"id": "c2", "alias": "n",    "expr": _col_ref("n")},
                ],
            },
        ],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "WITH RECURSIVE" in sql
    assert "instrument_list" in sql


def test_generate_series_end_expr_column_ref():
    """generate_series with a column_ref end_expr validates and compiles."""
    model = {
        "sources": [
            {"id": "s1", "type": "table", "name": "data", "alias": "d", "sql": ""},
            {
                "id": "gs1", "type": "generate_series",
                "name": "_generate_series", "alias": "idx", "sql": "",
                "start": 1,
                "end_expr": _col_ref("max_n", "d"),
            },
        ],
        "transformations": [
            {
                "id": "tj", "type": "join", "inputs": ["s1", "gs1"],
                "join_type": "INNER", "left_input": "s1", "right_source": "gs1",
                "alias": "idx",
                "condition": {
                    "type": "binary_op", "op": "<=",
                    "left": _col_ref("idx"),
                    "right": _col_ref("max_n", "d"),
                },
            },
            {
                "id": "ts", "type": "select", "inputs": ["tj"],
                "columns": [
                    {"id": "c1", "alias": "idx", "expr": _col_ref("idx")},
                ],
            },
        ],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "WITH RECURSIVE" in sql
    assert '"d"."max_n"' in sql


# ---------------------------------------------------------------------------
# SPLIT_PART — compilation
# ---------------------------------------------------------------------------

def _split_part(s: dict, delim: str, n: int) -> dict:
    return _fn("SPLIT_PART", s, _lit(delim), _lit(n))


def test_split_part_n1_compiles():
    """SPLIT_PART(col, '|', 1) compiles to CASE WHEN INSTR(...) > 0 THEN SUBSTR(...) ELSE col END."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t", "sql": ""}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{
                "id": "c1", "alias": "part1",
                "expr": _split_part(_col_ref("cables", "t"), "|", 1),
            }],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    assert "INSTR" in sql
    assert "SUBSTR" in sql
    assert "CASE WHEN" in sql
    assert "part1" in sql


def test_split_part_n2_compiles():
    """SPLIT_PART(col, '|', 2) produces nested SUBSTR/INSTR chain."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t", "sql": ""}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{
                "id": "c1", "alias": "part2",
                "expr": _split_part(_col_ref("cables", "t"), "|", 2),
            }],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    _valid(model)
    sql = compile_sql(model)
    # Nested SUBSTR calls appear twice or more for n=2
    assert sql.count("SUBSTR") >= 2


def test_split_part_validation_wrong_arity():
    """SPLIT_PART with wrong number of args fails validation."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t", "sql": ""}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{
                "id": "c1", "alias": "x",
                "expr": _fn("SPLIT_PART", _col_ref("c"), _lit("|")),  # only 2 args
            }],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    errors = validate_model(model_from_dict(model))
    assert any("SPLIT_PART" in e and "3" in e for e in errors)


def test_split_part_validation_non_literal_index():
    """SPLIT_PART with a column_ref as index fails validation."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t", "sql": ""}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{
                "id": "c1", "alias": "x",
                "expr": _fn("SPLIT_PART", _col_ref("c"), _lit("|"), _col_ref("n")),
            }],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    errors = validate_model(model_from_dict(model))
    assert any("literal integer" in e or "SPLIT_PART" in e for e in errors)


def test_split_part_index_exceeds_limit():
    """SPLIT_PART with index > 8 fails validation."""
    model = {
        "sources": [{"id": "s1", "type": "table", "name": "t", "alias": "t", "sql": ""}],
        "transformations": [{
            "id": "ts", "type": "select", "inputs": ["s1"],
            "columns": [{
                "id": "c1", "alias": "x",
                "expr": _split_part(_col_ref("c", "t"), "|", 9),
            }],
        }],
        "final_relation_id": "ts",
        "order_by": [],
        "meta": {"schema_version": 1},
    }
    errors = validate_model(model_from_dict(model))
    assert any("limit" in e.lower() or "9" in e or "8" in e for e in errors)


# ---------------------------------------------------------------------------
# sql_to_model — generate_series detection
# ---------------------------------------------------------------------------

def test_sql_to_model_generate_series_recursive_cte():
    """Recursive number-generator CTE is converted to a generate_series source."""
    sql = """
    WITH nums(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 10
    )
    SELECT n FROM nums
    """
    m = sql_to_model(sql)
    gs_sources = [s for s in m["sources"] if s.get("type") == "generate_series"]
    assert len(gs_sources) == 1
    gs = gs_sources[0]
    assert gs["start"] == 1
    assert gs["end_expr"] == {"type": "literal", "value": 10}
    assert gs["alias"] == "nums"


def test_sql_to_model_generate_series_union_all():
    """UNION ALL of consecutive literals is converted to a generate_series source."""
    sql = """
    WITH idx(n) AS (
        SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
    )
    SELECT n FROM idx
    """
    m = sql_to_model(sql)
    gs_sources = [s for s in m["sources"] if s.get("type") == "generate_series"]
    assert len(gs_sources) == 1
    gs = gs_sources[0]
    assert gs["start"] == 1
    assert gs["end_expr"] == {"type": "literal", "value": 5}


def test_sql_to_model_generate_series_non_generator_cte_kept():
    """A CTE that doesn't match number-generator patterns stays as a CTE source."""
    sql = """
    WITH base AS (SELECT tag, area FROM instrument_list WHERE area IS NOT NULL)
    SELECT tag FROM base
    """
    m = sql_to_model(sql)
    cte_sources = [s for s in m["sources"] if s.get("type") == "cte"]
    assert len(cte_sources) == 1
    assert cte_sources[0]["name"] == "base"


# ---------------------------------------------------------------------------
# sql_to_model — SPLIT_PART rewriting
# ---------------------------------------------------------------------------

def test_sql_to_model_split_part_postgres_native():
    """Postgres SPLIT_PART(col, d, n) is parsed as a SPLIT_PART function node."""
    sql = "SELECT SPLIT_PART(cables, '|', 2) AS token FROM instrument_list"
    m = sql_to_model(sql)
    sel = next(t for t in m["transformations"] if t["type"] == "select")
    expr = sel["columns"][0]["expr"]
    assert expr["type"] == "function"
    assert expr["name"] == "SPLIT_PART"
    assert expr["args"][2] == {"type": "literal", "value": 2}


def test_sql_to_model_split_part_substr_instr_rewrite():
    """SQLite SUBSTR(s, 1, INSTR(s, d) - 1) idiom is rewritten to SPLIT_PART(s, d, 1)."""
    sql = """
    SELECT SUBSTR(cables, 1, INSTR(cables, '|') - 1) AS first_cable
    FROM instrument_list
    """
    m = sql_to_model(sql)
    sel = next(t for t in m["transformations"] if t["type"] == "select")
    expr = sel["columns"][0]["expr"]
    assert expr["type"] == "function"
    assert expr["name"] == "SPLIT_PART"
    assert expr["args"][1] == {"type": "literal", "value": "|"}
    assert expr["args"][2] == {"type": "literal", "value": 1}
