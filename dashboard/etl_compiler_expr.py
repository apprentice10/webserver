from __future__ import annotations


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class EtlValidationError(Exception):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


class EtlCompilationError(Exception):
    pass


# ---------------------------------------------------------------------------
# Expression grammar constants
# ---------------------------------------------------------------------------

_ALLOWED_BINARY_OPS = frozenset({"=", "!=", ">", "<", ">=", "<=", "+", "-", "*", "/"})

# Functions that require special argument-count validation (name → expected count)
_FIXED_ARITY_FUNCTIONS: dict[str, int] = {
    "SPLIT_PART": 3,
}

_SPLIT_PART_MAX_INDEX = 8   # compilation limit for literal-index SPLIT_PART


# ---------------------------------------------------------------------------
# SPLIT_PART → SQLite nested SUBSTR/INSTR compilation
# ---------------------------------------------------------------------------

def _sqlite_split_part(s: str, d: str, n: int) -> str:
    """Recursively build nested SQLite SQL to extract the nth delimiter-token from s."""
    if n == 1:
        return (
            f"CASE WHEN INSTR({s}, {d}) > 0 "
            f"THEN SUBSTR({s}, 1, INSTR({s}, {d}) - 1) "
            f"ELSE {s} END"
        )
    rest = f"SUBSTR({s}, INSTR({s}, {d}) + LENGTH({d}))"
    inner = _sqlite_split_part(rest, d, n - 1)
    return (
        f"CASE WHEN INSTR({s}, {d}) > 0 "
        f"THEN {inner} "
        f"ELSE NULL END"
    )


def _compile_split_part(args: list) -> str:
    if len(args) != 3:
        raise EtlCompilationError("SPLIT_PART requires exactly 3 arguments")
    n_arg = args[2]
    if n_arg.get("type") != "literal" or not isinstance(n_arg.get("value"), int):
        raise EtlCompilationError(
            "SPLIT_PART index (3rd arg) must be a literal integer in SQLite compilation mode"
        )
    n = n_arg["value"]
    if n < 1:
        raise EtlCompilationError("SPLIT_PART index must be >= 1")
    if n > _SPLIT_PART_MAX_INDEX:
        raise EtlCompilationError(
            f"SPLIT_PART index {n} exceeds SQLite compilation limit of {_SPLIT_PART_MAX_INDEX}"
        )
    s = expr_to_sql(args[0])
    d = expr_to_sql(args[1])
    return _sqlite_split_part(s, d, n)


# ---------------------------------------------------------------------------
# Expression → SQL
# Rules:
#   - column_ref  : always double-quoted
#   - literal     : NULL / TRUE / FALSE / 'escaped' / raw number
#   - function    : NAME(args...)  — name uppercased, no wrapping
#   - binary_op   : (left OP right)
#   - logical     : (arg AND arg AND arg)
#   - unary_op    : (NOT expr)
#   - is_null     : (expr IS NULL)
#   - is_not_null : (expr IS NOT NULL)
#   - case        : CASE [operand] WHEN … THEN … [ELSE …] END
# ---------------------------------------------------------------------------

def expr_to_sql(expr: dict) -> str:
    t = expr.get("type", "")

    if t == "literal":
        value = expr.get("value")
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, str):
            return "'" + value.replace("'", "''") + "'"
        return str(value)

    if t == "column_ref":
        col = f'"{expr["column_name"]}"'
        alias = expr.get("table_alias", "")
        return f'"{alias}".{col}' if alias else col

    if t == "function":
        name = expr["name"].upper()
        args = expr.get("args", [])
        if name == "SPLIT_PART":
            return _compile_split_part(args)
        args_sql = ", ".join(expr_to_sql(a) for a in args)
        return f"{name}({args_sql})"

    if t == "binary_op":
        left_sql  = expr_to_sql(expr["left"])
        right_sql = expr_to_sql(expr["right"])
        return f"({left_sql} {expr['op']} {right_sql})"

    if t == "logical":
        op   = expr["op"].upper()
        args = f" {op} ".join(expr_to_sql(a) for a in expr["args"])
        return f"({args})"

    if t == "unary_op":
        return f"(NOT {expr_to_sql(expr['expr'])})"

    if t == "is_null":
        return f"({expr_to_sql(expr['expr'])} IS NULL)"

    if t == "is_not_null":
        return f"({expr_to_sql(expr['expr'])} IS NOT NULL)"

    if t == "case":
        parts = ["CASE"]
        operand = expr.get("operand")
        if operand is not None:
            parts.append(expr_to_sql(operand))
        for clause in expr.get("when_clauses", []):
            parts.append(f"WHEN {expr_to_sql(clause['when'])} THEN {expr_to_sql(clause['then'])}")
        else_expr = expr.get("else")
        if else_expr is not None:
            parts.append(f"ELSE {expr_to_sql(else_expr)}")
        parts.append("END")
        return " ".join(parts)

    raise EtlCompilationError(f"Unknown expression type: {t!r}")
