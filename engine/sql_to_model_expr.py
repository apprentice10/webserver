"""
engine/sql_to_model_expr.py
SQL expression tokenizer, recursive-descent parser, and SPLIT_PART rewriter.
Extracted from sql_to_model.py — zero dependencies on the rest of that module.
"""

from __future__ import annotations


# ─────────────────────────────────────────────────────────────────────────────
# Expression Tokenizer
# ─────────────────────────────────────────────────────────────────────────────

_EXPR_KEYWORDS = frozenset([
    "AND", "OR", "NOT", "NULL", "TRUE", "FALSE",
    "IS", "CASE", "WHEN", "THEN", "ELSE", "END",
    "LIKE", "IN", "BETWEEN", "DISTINCT",
])


def _tokenize_expr(text: str, str_tbl: dict) -> list[dict]:
    tokens: list[dict] = []
    i = 0
    while i < len(text):
        c = text[i]
        if c.isspace():
            i += 1
            continue
        # Masked string literal
        if c == "\x00":
            j = text.find("$", i)
            if j == -1:
                i += 1
                continue
            key = text[i:j + 1]
            raw = str_tbl.get(key, "''")
            if raw.startswith("'") and raw.endswith("'"):
                raw = raw[1:-1].replace("''", "'")
            tokens.append({"t": "STR", "v": raw})
            i = j + 1
            continue
        # Double-quoted identifier
        if c == '"':
            j = i + 1
            while j < len(text) and text[j] != '"':
                j += 1
            tokens.append({"t": "IDENT", "v": text[i + 1:j]})
            i = j + 1
            continue
        # Backtick identifier
        if c == '`':
            j = i + 1
            while j < len(text) and text[j] != '`':
                j += 1
            tokens.append({"t": "IDENT", "v": text[i + 1:j]})
            i = j + 1
            continue
        # Number
        if c.isdigit():
            j = i
            while j < len(text) and text[j].isdigit():
                j += 1
            if j < len(text) and text[j] == '.':
                j += 1
                while j < len(text) and text[j].isdigit():
                    j += 1
                tokens.append({"t": "NUM", "v": float(text[i:j])})
            else:
                tokens.append({"t": "NUM", "v": int(text[i:j])})
            i = j
            continue
        # Identifier or keyword
        if c.isalpha() or c == '_':
            j = i
            while j < len(text) and (text[j].isalnum() or text[j] == '_'):
                j += 1
            word = text[i:j]
            up = word.upper()
            tokens.append({"t": up if up in _EXPR_KEYWORDS else "IDENT", "v": word})
            i = j
            continue
        # Concat operator ||
        if text[i:i + 2] == "||":
            tokens.append({"t": "CONCAT"})
            i += 2
            continue
        # Two-char ops
        if text[i:i + 2] in ("!=", ">=", "<="):
            tokens.append({"t": "OP", "v": text[i:i + 2]})
            i += 2
            continue
        # Single-char ops
        if c in "=><+-*/":
            tokens.append({"t": "OP", "v": c})
            i += 1
            continue
        if c == "(":
            tokens.append({"t": "LP"})
            i += 1
            continue
        if c == ")":
            tokens.append({"t": "RP"})
            i += 1
            continue
        if c == ",":
            tokens.append({"t": "COMMA"})
            i += 1
            continue
        if c == ".":
            tokens.append({"t": "DOT"})
            i += 1
            continue
        i += 1  # skip unknown chars (e.g. semicolons)
    tokens.append({"t": "EOF"})
    return tokens


# ─────────────────────────────────────────────────────────────────────────────
# Expression Parser — recursive descent
# ─────────────────────────────────────────────────────────────────────────────

class _ExprParser:
    def __init__(self, tokens: list[dict]):
        self._t = tokens
        self._pos = 0

    def _peek(self) -> dict:
        return self._t[self._pos]

    def _eat(self) -> dict:
        tok = self._t[self._pos]
        self._pos += 1
        return tok

    def _is(self, *types: str) -> bool:
        return self._peek()["t"] in types

    def _eat_if(self, *types: str) -> bool:
        if self._is(*types):
            self._eat()
            return True
        return False

    def _expect(self, *types: str) -> dict:
        if not self._is(*types):
            raise ValueError(f"Expected {types}, got {self._peek()['t']!r} near token {self._peek()}")
        return self._eat()

    def parse(self) -> dict:
        if self._is("EOF"):
            return {}
        result = self._logical_or()
        if not self._is("EOF"):
            raise ValueError(f"Unexpected token after expression: {self._peek()}")
        return result

    def _logical_or(self) -> dict:
        left = self._logical_and()
        if not self._is("OR"):
            return left
        args = [left]
        while self._eat_if("OR"):
            args.append(self._logical_and())
        return {"type": "logical", "op": "or", "args": args}

    def _logical_and(self) -> dict:
        left = self._not_expr()
        if not self._is("AND"):
            return left
        args = [left]
        while self._eat_if("AND"):
            args.append(self._not_expr())
        return {"type": "logical", "op": "and", "args": args}

    def _not_expr(self) -> dict:
        if self._eat_if("NOT"):
            return {"type": "unary_op", "op": "not", "expr": self._not_expr()}
        return self._comparison()

    def _comparison(self) -> dict:
        left = self._concat()
        # IS NULL / IS NOT NULL
        if self._is("IS"):
            self._eat()
            if self._eat_if("NOT"):
                self._expect("NULL")
                return {"type": "is_not_null", "expr": left}
            self._expect("NULL")
            return {"type": "is_null", "expr": left}
        # Comparison operators
        if self._is("OP") and self._peek().get("v") in ("=", "!=", ">", "<", ">=", "<="):
            op = self._eat()["v"]
            right = self._concat()
            # Auto-fix = NULL / != NULL
            if right.get("type") == "literal" and right.get("value") is None:
                return {"type": "is_null" if op == "=" else "is_not_null", "expr": left}
            if left.get("type") == "literal" and left.get("value") is None:
                return {"type": "is_null" if op == "=" else "is_not_null", "expr": right}
            return {"type": "binary_op", "op": op, "left": left, "right": right}
        return left

    def _concat(self) -> dict:
        """Handle || chains → CONCAT_WS."""
        left = self._add()
        if not self._is("CONCAT"):
            return left
        parts = [left]
        while self._eat_if("CONCAT"):
            parts.append(self._add())
        return self._concat_to_ast(parts)

    @staticmethod
    def _concat_to_ast(parts: list) -> dict:
        if len(parts) == 1:
            return parts[0]
        # Detect alternating value/separator pattern: v sep v sep v
        # where all sep items (odd indices) are the same string literal
        if len(parts) >= 3:
            seps = [p for i, p in enumerate(parts) if i % 2 == 1]
            if (
                all(p.get("type") == "literal" and isinstance(p.get("value"), str) for p in seps)
                and len({p["value"] for p in seps}) == 1
            ):
                sep_val = seps[0]["value"]
                values = [p for i, p in enumerate(parts) if i % 2 == 0]
                return {
                    "type": "function",
                    "name": "CONCAT_WS",
                    "args": [{"type": "literal", "value": sep_val}] + values,
                }
        # Fallback: empty-separator CONCAT_WS preserving all parts
        return {
            "type": "function",
            "name": "CONCAT_WS",
            "args": [{"type": "literal", "value": ""}] + parts,
        }

    def _add(self) -> dict:
        left = self._mul()
        while self._is("OP") and self._peek().get("v") in ("+", "-"):
            op = self._eat()["v"]
            left = {"type": "binary_op", "op": op, "left": left, "right": self._mul()}
        return left

    def _mul(self) -> dict:
        left = self._unary()
        while self._is("OP") and self._peek().get("v") in ("*", "/"):
            op = self._eat()["v"]
            left = {"type": "binary_op", "op": op, "left": left, "right": self._unary()}
        return left

    def _unary(self) -> dict:
        if self._is("OP") and self._peek().get("v") == "-":
            self._eat()
            inner = self._primary()
            if inner.get("type") == "literal" and isinstance(inner.get("value"), (int, float)):
                return {"type": "literal", "value": -inner["value"]}
            return {"type": "binary_op", "op": "-",
                    "left": {"type": "literal", "value": 0}, "right": inner}
        return self._primary()

    def _primary(self) -> dict:
        tok = self._peek()

        if tok["t"] == "LP":
            self._eat()
            inner = self._logical_or()
            self._expect("RP")
            return inner

        if tok["t"] == "CASE":
            return self._case()

        if tok["t"] == "STR":
            self._eat()
            return {"type": "literal", "value": tok["v"]}

        if tok["t"] == "NUM":
            self._eat()
            return {"type": "literal", "value": tok["v"]}

        if tok["t"] == "NULL":
            self._eat()
            return {"type": "literal", "value": None}

        if tok["t"] == "TRUE":
            self._eat()
            return {"type": "literal", "value": True}

        if tok["t"] == "FALSE":
            self._eat()
            return {"type": "literal", "value": False}

        if tok["t"] == "IDENT":
            name = self._eat()["v"]
            if self._is("DOT"):
                self._eat()
                col = self._expect("IDENT")["v"]
                return {"type": "column_ref", "table_alias": name, "column_name": col}
            if self._is("LP"):
                self._eat()
                args = []
                if not self._is("RP"):
                    args.append(self._logical_or())
                    while self._eat_if("COMMA"):
                        args.append(self._logical_or())
                self._expect("RP")
                return {"type": "function", "name": name.upper(), "args": args}
            return {"type": "column_ref", "table_alias": "", "column_name": name}

        raise ValueError(f"Unexpected token in expression: {tok}")

    def _case(self) -> dict:
        self._expect("CASE")
        operand = None
        if not self._is("WHEN"):
            operand = self._logical_or()
        when_clauses = []
        while self._eat_if("WHEN"):
            when_expr = self._logical_or()
            self._expect("THEN")
            then_expr = self._logical_or()
            when_clauses.append({"when": when_expr, "then": then_expr})
        else_expr = None
        if self._eat_if("ELSE"):
            else_expr = self._logical_or()
        self._expect("END")
        return {"type": "case", "operand": operand, "when_clauses": when_clauses, "else": else_expr}


# ─────────────────────────────────────────────────────────────────────────────
# SPLIT_PART pattern rewriter
# Rewrites:
#   SPLIT_PART(s, d, n)               — Postgres native: pass through unchanged
#   SUBSTR(s, 1, INSTR(s, d) - 1)     — SQLite token-1 idiom → SPLIT_PART(s, d, 1)
# Applied recursively after parsing.
# ─────────────────────────────────────────────────────────────────────────────

def _try_rewrite_split_part(expr: dict) -> dict:
    if not isinstance(expr, dict):
        return expr
    t = expr.get("type", "")

    if t == "function":
        name = expr.get("name", "").upper()
        args = [_try_rewrite_split_part(a) for a in expr.get("args", [])]

        # Already SPLIT_PART — normalise name to uppercase and validate
        if name == "SPLIT_PART":
            return {"type": "function", "name": "SPLIT_PART", "args": args}

        # Detect: SUBSTR(s, 1, INSTR(s, d) - 1)  →  SPLIT_PART(s, d, 1)
        if name == "SUBSTR" and len(args) == 3:
            s_arg, start_arg, len_arg = args
            is_start_1 = (
                start_arg.get("type") == "literal" and start_arg.get("value") == 1
            )
            is_instr_minus_1 = (
                len_arg.get("type") == "binary_op"
                and len_arg.get("op") == "-"
                and len_arg.get("right", {}) == {"type": "literal", "value": 1}
                and len_arg.get("left", {}).get("type") == "function"
                and len_arg["left"].get("name", "").upper() == "INSTR"
                and len(len_arg["left"].get("args", [])) == 2
                and len_arg["left"]["args"][0] == s_arg
            )
            if is_start_1 and is_instr_minus_1:
                d_arg = len_arg["left"]["args"][1]
                return {
                    "type": "function", "name": "SPLIT_PART",
                    "args": [s_arg, d_arg, {"type": "literal", "value": 1}],
                }

        return {"type": "function", "name": expr["name"], "args": args}

    if t == "binary_op":
        return {
            **expr,
            "left": _try_rewrite_split_part(expr.get("left", {})),
            "right": _try_rewrite_split_part(expr.get("right", {})),
        }
    if t == "logical":
        return {**expr, "args": [_try_rewrite_split_part(a) for a in expr.get("args", [])]}
    if t in ("is_null", "is_not_null", "unary_op"):
        return {**expr, "expr": _try_rewrite_split_part(expr.get("expr", {}))}
    if t == "case":
        return {
            **expr,
            "operand": (
                _try_rewrite_split_part(expr["operand"]) if expr.get("operand") else None
            ),
            "when_clauses": [
                {
                    "when": _try_rewrite_split_part(c["when"]),
                    "then": _try_rewrite_split_part(c["then"]),
                }
                for c in expr.get("when_clauses", [])
            ],
            "else": (
                _try_rewrite_split_part(expr["else"]) if expr.get("else") else None
            ),
        }
    return expr


def _parse_expr(text: str, str_tbl: dict) -> dict:
    """Parse a SQL expression string into a valid EtlModel AST node. Raises ValueError on failure."""
    text = text.strip()
    if not text:
        return {}
    tokens = _tokenize_expr(text, str_tbl)
    result = _ExprParser(tokens).parse()
    return _try_rewrite_split_part(result)
