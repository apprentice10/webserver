const EtlDsl = (() => {

    // ── Tokenizer ─────────────────────────────────────────────────────────────

    function _tokenize(src) {
        const tokens = [];
        let i = 0;
        while (i < src.length) {
            if (/\s/.test(src[i])) { i++; continue; }
            if (src[i] === "'") {
                let j = i + 1, s = '';
                while (j < src.length && src[j] !== "'") {
                    s += src[j] === '\\' ? src[++j] : src[j]; j++;
                }
                tokens.push({ t: 'STR', v: s }); i = j + 1; continue;
            }
            const m2 = src.slice(i).match(/^(<=|>=|!=|\|\||&&)/);
            if (m2) { tokens.push({ t: 'OP', v: m2[1] }); i += m2[1].length; continue; }
            if ('=<>+-*/!'.includes(src[i])) { tokens.push({ t: 'OP', v: src[i] }); i++; continue; }
            if (src[i] === '(') { tokens.push({ t: 'LP' }); i++; continue; }
            if (src[i] === ')') { tokens.push({ t: 'RP' }); i++; continue; }
            if (src[i] === ',') { tokens.push({ t: 'CM' }); i++; continue; }
            if (src[i] === '.') { tokens.push({ t: 'DT' }); i++; continue; }
            const mN = src.slice(i).match(/^\d+(\.\d*)?/);
            if (mN) { tokens.push({ t: 'NUM', v: Number(mN[0]) }); i += mN[0].length; continue; }
            const mI = src.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
            if (mI) { tokens.push({ t: 'ID', v: mI[0] }); i += mI[0].length; continue; }
            throw new Error(`Unexpected character at position ${i}: '${src[i]}'`);
        }
        tokens.push({ t: 'EOF' });
        return tokens;
    }


    // ── Recursive-descent parser ──────────────────────────────────────────────

    let _tok, _p;
    const _peek = ()     => _tok[_p];
    const _eat  = ()     => _tok[_p++];
    const _is   = (t, v) => _tok[_p].t === t && (v === undefined || _tok[_p].v === v);

    function _expr()  { return _or(); }

    function _or() {
        let n = _and();
        while (_is('OP', '||')) { _eat(); n = { type: 'logical', op: 'or',  args: [n, _and()] }; }
        return n;
    }

    function _and() {
        let n = _cmp();
        while (_is('OP', '&&')) { _eat(); n = { type: 'logical', op: 'and', args: [n, _cmp()] }; }
        return n;
    }

    function _cmp() {
        let n = _add();
        if (_is('OP') && ['=', '!=', '<', '>', '<=', '>='].includes(_peek().v)) {
            const op = _eat().v;
            return { type: 'binary_op', op, left: n, right: _add() };
        }
        return n;
    }

    function _add() {
        let n = _mul();
        while (_is('OP', '+') || _is('OP', '-')) { const op = _eat().v; n = { type: 'binary_op', op, left: n, right: _mul() }; }
        return n;
    }

    function _mul() {
        let n = _unary();
        while (_is('OP', '*') || _is('OP', '/')) { const op = _eat().v; n = { type: 'binary_op', op, left: n, right: _unary() }; }
        return n;
    }

    function _unary() {
        if (_is('OP', '-')) { _eat(); return { type: 'binary_op', op: '-', left: { type: 'literal', value: 0 }, right: _primary() }; }
        if (_is('OP', '!')) { _eat(); return { type: 'logical', op: 'not', args: [_primary()] }; }
        return _primary();
    }

    function _primary() {
        const tok = _peek();
        if (tok.t === 'NUM') { _eat(); return { type: 'literal', value: tok.v }; }
        if (tok.t === 'STR') { _eat(); return { type: 'literal', value: tok.v }; }
        if (tok.t === 'LP')  { _eat(); const n = _expr(); if (!_is('RP')) throw new Error('Expected )'); _eat(); return n; }
        if (tok.t === 'ID') {
            const name = tok.v; _eat();
            if (name === 'null')  return { type: 'literal', value: null };
            if (name === 'true')  return { type: 'literal', value: true };
            if (name === 'false') return { type: 'literal', value: false };
            if (_is('LP')) {
                _eat();
                const args = [];
                if (!_is('RP')) { args.push(_expr()); while (_is('CM')) { _eat(); args.push(_expr()); } }
                if (!_is('RP')) throw new Error('Expected )');
                _eat();
                return _buildFn(name, args);
            }
            if (_is('DT')) { _eat(); const col = _eat(); return { type: 'column_ref', table_alias: name, column_name: col.v }; }
            return { type: 'column_ref', column_name: name, table_alias: '' };
        }
        throw new Error(`Unexpected token: ${tok.t} '${tok.v ?? ''}'`);
    }

    function _buildFn(name, args) {
        const n = name.toLowerCase();
        if (n === 'case') {
            const wc = [];
            for (let i = 0; i + 1 < args.length; i += 2) wc.push({ when: args[i], then: args[i + 1] });
            return { type: 'case', operand: null, when_clauses: wc, else: args.length % 2 === 1 ? args[args.length - 1] : null };
        }
        if (n === 'not_null') return { type: 'is_not_null', expr: args[0] };
        if (n === 'is_null')  return { type: 'is_null',     expr: args[0] };
        if (n === 'and') return { type: 'logical', op: 'and', args };
        if (n === 'or')  return { type: 'logical', op: 'or',  args };
        return { type: 'function', name: name.toUpperCase(), args };
    }


    // ── Serializer ────────────────────────────────────────────────────────────

    function serialize(ast) {
        if (!ast) return 'null';
        switch (ast.type) {
            case 'literal':
                if (ast.value === null || ast.value === undefined) return 'null';
                if (typeof ast.value === 'string') return "'" + ast.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
                return String(ast.value);
            case 'column_ref':
                return ast.table_alias ? `${ast.table_alias}.${ast.column_name}` : ast.column_name;
            case 'function':
                return `${ast.name.toLowerCase()}(${(ast.args || []).map(serialize).join(', ')})`;
            case 'binary_op':
                return `${serialize(ast.left)} ${ast.op} ${serialize(ast.right)}`;
            case 'logical':
                if (ast.op === 'not') return `!(${serialize(ast.args[0])})`;
                return `${ast.op}(${(ast.args || []).map(serialize).join(', ')})`;
            case 'is_not_null': return `not_null(${serialize(ast.expr)})`;
            case 'is_null':     return `is_null(${serialize(ast.expr)})`;
            case 'case': {
                const parts = (ast.when_clauses || []).flatMap(c => [serialize(c.when), serialize(c.then)]);
                if (ast.else !== null && ast.else !== undefined) parts.push(serialize(ast.else));
                return `case(${parts.join(', ')})`;
            }
            default: return JSON.stringify(ast);
        }
    }


    // ── Public API ────────────────────────────────────────────────────────────

    function parse(src) {
        if (!src || !src.trim()) throw new Error('Empty expression');
        _tok = _tokenize(src.trim());
        _p   = 0;
        const ast = _expr();
        if (!_is('EOF')) throw new Error(`Unexpected token after expression: '${_peek().v ?? ''}'`);
        return ast;
    }

    function tryParse(src) {
        try   { return { ast: parse(src), error: null }; }
        catch (e) { return { ast: null, error: e.message }; }
    }

    return { parse, tryParse, serialize };

})();
