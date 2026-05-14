const EtlExpr = (() => {

    // --------------------------------------------------------
    // TOKENIZER
    // --------------------------------------------------------

    function tokenize(text) {
        const KW = new Set(["AND","OR","NOT","NULL","TRUE","FALSE","IS","CASE","WHEN","THEN","ELSE","END"]);
        const tokens = [];
        let i = 0;
        while (i < text.length) {
            if (/\s/.test(text[i])) { i++; continue; }
            if (text[i] === "'") {
                let j = i + 1, buf = "";
                while (j < text.length) {
                    if (text[j] === "'" && text[j+1] === "'") { buf += "'"; j += 2; }
                    else if (text[j] === "'") break;
                    else { buf += text[j++]; }
                }
                if (text[j] !== "'") throw new Error("Unterminated string literal");
                tokens.push({ t: "STR", v: buf });
                i = j + 1; continue;
            }
            if (/[0-9]/.test(text[i])) {
                let j = i;
                while (j < text.length && /[0-9]/.test(text[j])) j++;
                if (j < text.length && text[j] === ".") {
                    j++;
                    while (j < text.length && /[0-9]/.test(text[j])) j++;
                }
                tokens.push({ t: "NUM", v: parseFloat(text.slice(i, j)) });
                i = j; continue;
            }
            if (/[a-zA-Z_]/.test(text[i])) {
                let j = i;
                while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
                const word = text.slice(i, j);
                const upper = word.toUpperCase();
                tokens.push({ t: KW.has(upper) ? upper : "IDENT", v: word });
                i = j; continue;
            }
            const two = text.slice(i, i+2);
            if (["!=",">=","<="].includes(two)) { tokens.push({ t: "OP", v: two }); i += 2; continue; }
            if (text[i] === "(") { tokens.push({ t: "LP" }); i++; continue; }
            if (text[i] === ")") { tokens.push({ t: "RP" }); i++; continue; }
            if (text[i] === ",") { tokens.push({ t: "CM" }); i++; continue; }
            if (text[i] === ".") { tokens.push({ t: "DOT" }); i++; continue; }
            if ("=><+-*/".includes(text[i])) { tokens.push({ t: "OP", v: text[i] }); i++; continue; }
            throw new Error(`Unexpected character '${text[i]}' at position ${i}`);
        }
        tokens.push({ t: "EOF" });
        return tokens;
    }


    // --------------------------------------------------------
    // PARSER  (text → AST)
    // --------------------------------------------------------

    function parseExpr(text) {
        if (!text || !text.trim()) return null;
        const tokens = tokenize(text.trim());
        let pos = 0;
        const pk  = ()         => tokens[pos];
        const eat = ()         => tokens[pos++];
        const is  = (t, v)     => { const tok = tokens[pos]; if (tok.t !== t) return false; return v === undefined || tok.v.toUpperCase() === v.toUpperCase(); };
        const isOP = v         => tokens[pos].t === "OP" && tokens[pos].v === v;

        function parseOr() {
            const left = parseAnd();
            if (!is("OR")) return left;
            const args = [left];
            while (is("OR")) { eat(); args.push(parseAnd()); }
            return { type: "logical", op: "or", args };
        }
        function parseAnd() {
            const left = parseNot();
            if (!is("AND")) return left;
            const args = [left];
            while (is("AND")) { eat(); args.push(parseNot()); }
            return { type: "logical", op: "and", args };
        }
        function parseNot() {
            if (is("NOT")) { eat(); return { type: "unary_op", op: "not", expr: parseNot() }; }
            return parseCmp();
        }
        function parseCmp() {
            const left = parseAdd();
            if (is("IS")) {
                eat();
                if (is("NOT")) {
                    eat();
                    if (!is("NULL")) throw new Error("Expected NULL after IS NOT");
                    eat();
                    return { type: "is_not_null", expr: left };
                }
                if (!is("NULL")) throw new Error("Expected NULL after IS");
                eat();
                return { type: "is_null", expr: left };
            }
            const cmpOps = ["=","!=",">","<",">=","<="];
            if (pk().t === "OP" && cmpOps.includes(pk().v)) {
                const op = eat().v;
                return { type: "binary_op", op, left, right: parseAdd() };
            }
            return left;
        }
        function parseAdd() {
            let left = parseMul();
            while (pk().t === "OP" && (pk().v === "+" || pk().v === "-")) {
                const op = eat().v;
                left = { type: "binary_op", op, left, right: parseMul() };
            }
            return left;
        }
        function parseMul() {
            let left = parsePrimary();
            while (pk().t === "OP" && (pk().v === "*" || pk().v === "/")) {
                const op = eat().v;
                left = { type: "binary_op", op, left, right: parsePrimary() };
            }
            return left;
        }
        function parsePrimary() {
            const tok = pk();
            if (tok.t === "STR")   { eat(); return { type: "literal", value: tok.v }; }
            if (tok.t === "NUM")   { eat(); return { type: "literal", value: tok.v }; }
            if (tok.t === "NULL")  { eat(); return { type: "literal", value: null }; }
            if (tok.t === "TRUE")  { eat(); return { type: "literal", value: true }; }
            if (tok.t === "FALSE") { eat(); return { type: "literal", value: false }; }
            if (tok.t === "LP")    { eat(); const e = parseOr(); if (!is("RP")) throw new Error("Expected ')'"); eat(); return e; }
            if (tok.t === "CASE") {
                eat();
                let operand = null;
                if (!is("WHEN")) operand = parseOr();
                const when_clauses = [];
                while (is("WHEN")) {
                    eat();
                    const when = parseOr();
                    if (!is("THEN")) throw new Error("Expected THEN");
                    eat();
                    when_clauses.push({ when, then: parseOr() });
                }
                if (!when_clauses.length) throw new Error("CASE needs at least one WHEN clause");
                let else_expr = null;
                if (is("ELSE")) { eat(); else_expr = parseOr(); }
                if (!is("END")) throw new Error("Expected END");
                eat();
                return { type: "case", operand, when_clauses, "else": else_expr };
            }
            if (tok.t === "OP" && tok.v === "-") {
                eat();
                const n = pk();
                if (n.t === "NUM") { eat(); return { type: "literal", value: -n.v }; }
                throw new Error("Expected number after unary '-'");
            }
            if (tok.t === "IDENT") {
                eat();
                if (is("LP")) {
                    eat();
                    const args = [];
                    if (!is("RP")) {
                        args.push(parseOr());
                        while (is("CM")) { eat(); args.push(parseOr()); }
                    }
                    if (!is("RP")) throw new Error(`Expected ')' after ${tok.v}(...`);
                    eat();
                    return { type: "function", name: tok.v.toUpperCase(), args };
                }
                if (is("DOT")) {
                    eat();
                    if (pk().t !== "IDENT") throw new Error(`Expected column name after '${tok.v}.'`);
                    const col = eat();
                    return { type: "column_ref", column_name: col.v, table_alias: tok.v };
                }
                return { type: "column_ref", column_name: tok.v, table_alias: "" };
            }
            throw new Error(`Unexpected token: ${tok.t}${tok.v ? " '" + tok.v + "'" : ""}`);
        }

        const result = parseOr();
        if (!is("EOF")) throw new Error(`Unexpected token after expression: '${pk().v || pk().t}'`);
        return result;
    }


    // --------------------------------------------------------
    // RENDERER  (AST → text for <input> display)
    // --------------------------------------------------------

    function exprToText(expr) {
        if (!expr || !expr.type) return "";
        switch (expr.type) {
            case "literal":
                if (expr.value === null)           return "NULL";
                if (expr.value === true)            return "TRUE";
                if (expr.value === false)           return "FALSE";
                if (typeof expr.value === "string") return "'" + expr.value.replace(/'/g, "''") + "'";
                return String(expr.value);
            case "column_ref":
                return expr.table_alias ? `${expr.table_alias}.${expr.column_name}` : expr.column_name;
            case "function":
                return `${expr.name}(${(expr.args||[]).map(exprToText).join(", ")})`;
            case "binary_op":
                return `${exprToText(expr.left)} ${expr.op} ${exprToText(expr.right)}`;
            case "logical":
                return (expr.args||[]).map(exprToText).join(` ${expr.op.toUpperCase()} `);
            case "unary_op":
                return `NOT ${exprToText(expr.expr)}`;
            case "is_null":
                return `${exprToText(expr.expr)} IS NULL`;
            case "is_not_null":
                return `${exprToText(expr.expr)} IS NOT NULL`;
            case "case": {
                const parts = ["CASE"];
                if (expr.operand !== null && expr.operand !== undefined) parts.push(exprToText(expr.operand));
                for (const c of (expr.when_clauses||[])) {
                    parts.push(`WHEN ${exprToText(c.when)} THEN ${exprToText(c.then)}`);
                }
                const el = expr["else"];
                if (el !== null && el !== undefined) parts.push(`ELSE ${exprToText(el)}`);
                parts.push("END");
                return parts.join(" ");
            }
            case "expr_sql":
                return expr.sql || "";  // Legacy — displays for migration, fails on compile
            default:
                return "";
        }
    }


    return { tokenize, parseExpr, exprToText };

})();
