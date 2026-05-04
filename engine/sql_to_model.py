"""
engine/sql_to_model.py
SQL → EtlModel best-effort converter for migrating old SQL-based ETL to model-first IR.

Supported patterns:
- WITH ... AS (...) CTEs → CTE sources
- FROM table [alias] → table source
- [LEFT|RIGHT|INNER|FULL] JOIN table [alias] ON condition → join transformation
- SELECT col_list → select transformation
- WHERE condition → filter transformation (mode=where)
- GROUP BY exprs → aggregate transformation (columns re-used as aggregations)
- HAVING condition → filter transformation (mode=having)
- ORDER BY → order_by entries

Full expression grammar (no expr_sql fallback):
- column_ref, literal, function, binary_op, logical (and/or), unary_op (not)
- is_null, is_not_null, case
- || chains → CONCAT_WS (with separator detection)
- = NULL / != NULL → is_null / is_not_null (auto-fixed)
"""

from __future__ import annotations
import re
import uuid


def _gen_id() -> str:
    return "x" + uuid.uuid4().hex[:8]


# ─────────────────────────────────────────────────────────────────────────────
# String literal masking
# ─────────────────────────────────────────────────────────────────────────────

def _mask_strings(sql: str) -> tuple[str, dict]:
    """Replace SQL string literals with \x00Sn$ placeholders."""
    tbl: dict = {}
    idx, out, i = 0, [], 0
    while i < len(sql):
        if sql[i] == "'":
            j, buf = i + 1, [sql[i]]
            while j < len(sql):
                if sql[j] == "'" and j + 1 < len(sql) and sql[j + 1] == "'":
                    buf += ["'", "'"]
                    j += 2
                elif sql[j] == "'":
                    buf.append("'")
                    j += 1
                    break
                else:
                    buf.append(sql[j])
                    j += 1
            key = f"\x00S{idx}$"
            tbl[key] = "".join(buf)
            out.append(key)
            idx += 1
            i = j
        else:
            out.append(sql[i])
            i += 1
    return "".join(out), tbl


def _unmask(s: str, tbl: dict) -> str:
    for k, v in tbl.items():
        s = s.replace(k, v)
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Depth-0 comma split
# ─────────────────────────────────────────────────────────────────────────────

def _comma_split(text: str) -> list[str]:
    parts, depth, buf = [], 0, []
    for c in text:
        if c == "(":
            depth += 1
            buf.append(c)
        elif c == ")":
            depth -= 1
            buf.append(c)
        elif c == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
    if buf:
        parts.append("".join(buf).strip())
    return [p for p in parts if p]


# ─────────────────────────────────────────────────────────────────────────────
# Clause extraction — ordered list of (keyword_tag, keyword_text, content)
# ─────────────────────────────────────────────────────────────────────────────

_CLAUSE_PATTERNS: list[tuple[str, str]] = [
    (r"SELECT\s+DISTINCT\b", "SELECT"),
    (r"SELECT\b", "SELECT"),
    (r"FROM\b", "FROM"),
    (r"(?:LEFT|RIGHT|INNER|FULL)\s+(?:OUTER\s+)?JOIN\b", "TYPED_JOIN"),
    (r"CROSS\s+JOIN\b", "TYPED_JOIN"),
    (r"JOIN\b", "JOIN"),
    (r"ON\b", "ON"),
    (r"WHERE\b", "WHERE"),
    (r"GROUP\s+BY\b", "GROUP_BY"),
    (r"HAVING\b", "HAVING"),
    (r"ORDER\s+BY\b", "ORDER_BY"),
    (r"LIMIT\b", "LIMIT"),
]
_COMPILED_CLAUSES = [(re.compile(pat, re.IGNORECASE), tag) for pat, tag in _CLAUSE_PATTERNS]


def _find_clauses(sql: str) -> list[tuple[str, str, str]]:
    positions: list[tuple[int, int, str, str]] = []
    depth = 0
    i = 0
    while i < len(sql):
        c = sql[i]
        if c == "(":
            depth += 1; i += 1; continue
        if c == ")":
            depth -= 1; i += 1; continue
        if depth == 0:
            matched = False
            for pat, tag in _COMPILED_CLAUSES:
                m = pat.match(sql, i)
                if m:
                    positions.append((i, m.end(), tag, m.group(0)))
                    i = m.end()
                    matched = True
                    break
            if not matched:
                i += 1
        else:
            i += 1

    result: list[tuple[str, str, str]] = []
    for idx, (start, kw_end, tag, kw_text) in enumerate(positions):
        next_start = positions[idx + 1][0] if idx + 1 < len(positions) else len(sql)
        content = sql[kw_end:next_start].strip()
        result.append((tag, kw_text, content))
    return result


# ─────────────────────────────────────────────────────────────────────────────
# generate_series CTE detection
# ─────────────────────────────────────────────────────────────────────────────

# Matches: SELECT <int> UNION ALL SELECT <alias> + 1 FROM <anything> WHERE <alias> < <end>
_GEN_SERIES_RECURSIVE_RE = re.compile(
    r"^\s*SELECT\s+(\d+)\s+UNION\s+ALL\s+SELECT\s+(\w+)\s*\+\s*1\s+FROM\s+\w+"
    r"\s+WHERE\s+\2\s*<\s*(.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
# Matches: SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 ...
_GEN_SERIES_UNION_RE = re.compile(
    r"^\s*SELECT\s+\d+(?:\s+UNION\s+ALL\s+SELECT\s+\d+)+\s*$",
    re.IGNORECASE,
)


def _detect_generate_series_cte(
    cte_name: str, cte_sql: str, str_tbl: dict
) -> "dict | None":
    """
    Detect number-generator CTE patterns and return a generate_series source dict.
    Returns None if the CTE is not a recognized generator pattern.
    """
    sql = cte_sql.strip()

    # Pattern A — recursive generator: SELECT 1 UNION ALL SELECT n+1 FROM cte WHERE n < X
    m = _GEN_SERIES_RECURSIVE_RE.match(sql)
    if m:
        start = int(m.group(1))
        end_text = m.group(3).strip()
        try:
            end_expr = _parse_expr(end_text, str_tbl)
        except (ValueError, Exception):
            return None
        if not end_expr:
            return None
        return {
            "id": _gen_id(),
            "type": "generate_series",
            "name": "_generate_series",
            "alias": cte_name,
            "sql": "",
            "start": start,
            "end_expr": end_expr,
        }

    # Pattern B — UNION ALL of consecutive integer literals: SELECT 1 UNION ALL SELECT 2 ...
    m2 = _GEN_SERIES_UNION_RE.match(sql)
    if m2:
        nums = list(map(int, re.findall(r"\d+", sql)))
        if len(nums) >= 2 and all(nums[i] + 1 == nums[i + 1] for i in range(len(nums) - 1)):
            return {
                "id": _gen_id(),
                "type": "generate_series",
                "name": "_generate_series",
                "alias": cte_name,
                "sql": "",
                "start": nums[0],
                "end_expr": {"type": "literal", "value": nums[-1]},
            }

    return None


# ─────────────────────────────────────────────────────────────────────────────
# CTE extraction
# ─────────────────────────────────────────────────────────────────────────────

def _extract_ctes(sql: str, str_tbl: dict | None = None) -> tuple[list[dict], str]:
    if str_tbl is None:
        str_tbl = {}
    sql = sql.strip()
    if not re.match(r"\bWITH\b", sql, re.IGNORECASE):
        return [], sql
    m = re.match(r"\bWITH\b\s*(?:RECURSIVE\s+)?", sql, re.IGNORECASE)
    pos = m.end()
    ctes: list[dict] = []
    while pos < len(sql):
        nm = re.match(
            r"([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\)\s*)?AS\s*\(",
            sql[pos:], re.IGNORECASE,
        )
        if not nm:
            break
        cte_name = nm.group(1)
        paren_start = pos + nm.end() - 1
        depth = 0
        j = paren_start
        while j < len(sql):
            if sql[j] == "(": depth += 1
            elif sql[j] == ")":
                depth -= 1
                if depth == 0: break
            j += 1
        cte_sql = sql[paren_start + 1:j].strip()
        gs = _detect_generate_series_cte(cte_name, cte_sql, str_tbl)
        if gs:
            ctes.append(gs)
        else:
            ctes.append({
                "id": _gen_id(), "type": "cte",
                "name": cte_name, "alias": cte_name, "sql": cte_sql,
            })
        pos = j + 1
        sep = re.match(r"\s*,\s*", sql[pos:])
        if sep:
            pos += sep.end()
        else:
            break
    return ctes, sql[pos:].strip()


# ─────────────────────────────────────────────────────────────────────────────
# Identifier helpers
# ─────────────────────────────────────────────────────────────────────────────

def _unquote(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] in ('"', '`') and s[-1] == s[0]:
        return s[1:-1]
    return s


def _table_ref(text: str) -> tuple[str, str]:
    text = text.strip()
    m = re.match(r'^(\S+)\s+AS\s+(\S+)\s*$', text, re.IGNORECASE)
    if m:
        return _unquote(m.group(1)), _unquote(m.group(2))
    m2 = re.match(r'^([A-Za-z_"][A-Za-z0-9_"]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$', text, re.IGNORECASE)
    if m2:
        return _unquote(m2.group(1)), m2.group(2)
    m3 = re.match(r'^([A-Za-z_"][A-Za-z0-9_"]*)\s*$', text, re.IGNORECASE)
    if m3:
        name = _unquote(m3.group(1))
        return name, name
    parts = text.split()
    return _unquote(parts[0]), parts[-1]


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


# ─────────────────────────────────────────────────────────────────────────────
# SELECT column item parser
# ─────────────────────────────────────────────────────────────────────────────

_AS_ALIAS_RE = re.compile(r'\s+AS\s+([A-Za-z_"][A-Za-z0-9_"]*)\s*$', re.IGNORECASE)


def _parse_col_item(item: str, str_tbl: dict) -> dict:
    """Parse one SELECT list item into a Column dict {id, alias, expr}."""
    item = item.strip()
    alias = None
    expr_text = item

    m = _AS_ALIAS_RE.search(item)
    if m:
        alias = _unquote(m.group(1))
        expr_text = item[:m.start()].strip()
    else:
        parts = item.rsplit(None, 1)
        if len(parts) == 2 and re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', parts[1]):
            if "." in parts[0] or "(" in parts[0]:
                alias = parts[1]
                expr_text = parts[0].strip()

    expr = _parse_expr(expr_text, str_tbl)

    if alias is None:
        if expr.get("type") == "column_ref":
            alias = expr["column_name"]
        else:
            alias = re.sub(r'\W+', '_', _unmask(expr_text, str_tbl))[:24].strip("_") or "col"

    return {"id": _gen_id(), "alias": alias, "expr": expr}


# ─────────────────────────────────────────────────────────────────────────────
# Join type helper
# ─────────────────────────────────────────────────────────────────────────────

def _join_type(kw_text: str) -> str:
    up = kw_text.upper()
    if "LEFT" in up:   return "LEFT"
    if "RIGHT" in up:  return "RIGHT"
    if "FULL" in up:   return "FULL"
    if "CROSS" in up:  return "CROSS"
    return "INNER"


# ─────────────────────────────────────────────────────────────────────────────
# Main converter
# ─────────────────────────────────────────────────────────────────────────────

def sql_to_model(sql: str) -> dict:
    """
    Convert a SQL SELECT statement to an EtlModel dict.
    Raises ValueError on structural parse failure or unparseable expressions.
    All output conforms to the EtlModel v1 grammar (no expr_sql nodes).
    """
    sql = sql.strip().rstrip(";")
    if not sql:
        raise ValueError("Empty SQL")

    masked, str_tbl = _mask_strings(sql)
    cte_sources, main_sql = _extract_ctes(masked, str_tbl)
    clauses = _find_clauses(main_sql)

    tags = [tag for tag, _, _ in clauses]
    if "SELECT" not in tags:
        raise ValueError("No SELECT clause found")
    if "FROM" not in tags:
        raise ValueError("No FROM clause found")

    clause_dict: dict = {}
    join_queue: list[tuple[str, str]] = []
    on_queue: list[str] = []

    for tag, kw_text, content in clauses:
        if tag in ("JOIN", "TYPED_JOIN"):
            join_queue.append((_join_type(kw_text), content))
        elif tag == "ON":
            on_queue.append(content)
        elif tag == "LIMIT":
            pass
        else:
            clause_dict[tag] = content

    # ── Sources ──────────────────────────────────────────────────────────────
    sources: list[dict] = list(cte_sources)
    cte_by_name = {c["name"]: c["id"] for c in cte_sources}

    from_name, from_alias = _table_ref(clause_dict["FROM"])
    if from_name in cte_by_name:
        from_id = cte_by_name[from_name]
        for s in sources:
            if s["id"] == from_id:
                s["alias"] = from_alias
    else:
        from_id = _gen_id()
        sources.append({"id": from_id, "type": "table", "name": from_name, "alias": from_alias, "sql": ""})

    # ── Transformations ───────────────────────────────────────────────────────
    transformations: list[dict] = []
    current_rel = from_id

    # JOINs
    for ji, (jtype, jtable_text) in enumerate(join_queue):
        right_name, right_alias = _table_ref(jtable_text)
        if right_name in cte_by_name:
            right_id = cte_by_name[right_name]
        else:
            right_id = _gen_id()
            sources.append({"id": right_id, "type": "table", "name": right_name, "alias": right_alias, "sql": ""})
        on_text = on_queue[ji] if ji < len(on_queue) else ""
        join_id = _gen_id()
        transformations.append({
            "id": join_id,
            "type": "join",
            "inputs": [current_rel, right_id],
            "join_type": jtype,
            "left_input": current_rel,
            "right_source": right_id,
            "alias": right_alias,
            "condition": _parse_expr(on_text, str_tbl),
        })
        current_rel = join_id

    # WHERE → filter before SELECT/AGGREGATE
    where_text = clause_dict.get("WHERE", "").strip()
    if where_text:
        filter_id = _gen_id()
        transformations.append({
            "id": filter_id,
            "type": "filter",
            "inputs": [current_rel],
            "condition": _parse_expr(where_text, str_tbl),
            "mode": "where",
        })
        current_rel = filter_id

    # SELECT column list
    sel_text = clause_dict.get("SELECT", "").strip()
    if re.match(r"DISTINCT\b", sel_text, re.IGNORECASE):
        sel_text = sel_text[8:].strip()
    columns = [_parse_col_item(item, str_tbl) for item in _comma_split(sel_text)]

    # GROUP BY → aggregate
    group_text = clause_dict.get("GROUP_BY", "").strip()
    having_text = clause_dict.get("HAVING", "").strip()
    final_rel: str

    if group_text:
        group_exprs = [_parse_expr(g, str_tbl) for g in _comma_split(group_text)]
        agg_id = _gen_id()
        transformations.append({
            "id": agg_id,
            "type": "aggregate",
            "inputs": [current_rel],
            "group_by": group_exprs,
            "aggregations": columns,
        })
        current_rel = agg_id
        final_rel = agg_id
        if having_text:
            hav_id = _gen_id()
            transformations.append({
                "id": hav_id,
                "type": "filter",
                "inputs": [current_rel],
                "condition": _parse_expr(having_text, str_tbl),
                "mode": "having",
            })
            current_rel = hav_id
            final_rel = hav_id
    else:
        sel_id = _gen_id()
        transformations.append({
            "id": sel_id,
            "type": "select",
            "inputs": [current_rel],
            "columns": columns,
        })
        final_rel = sel_id

    # ORDER BY
    order_by: list[dict] = []
    order_text = clause_dict.get("ORDER_BY", "").strip()
    if order_text:
        for item in _comma_split(order_text):
            item = item.strip()
            direction = "asc"
            if re.search(r"\bDESC\b", item, re.IGNORECASE):
                direction = "desc"
                item = re.sub(r"\s*\bDESC\b\s*$", "", item, flags=re.IGNORECASE).strip()
            else:
                item = re.sub(r"\s*\bASC\b\s*$", "", item, flags=re.IGNORECASE).strip()
            order_by.append({"expr": _parse_expr(item, str_tbl), "direction": direction})

    return {
        "sources": sources,
        "transformations": transformations,
        "final_relation_id": final_rel,
        "order_by": order_by,
        "meta": {"schema_version": 1},
    }
