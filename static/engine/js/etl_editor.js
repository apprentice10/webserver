const EtlEditor = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _model        = _emptyModel();
    let _history      = [];
    let _previewData  = null;
    let _cachedTemplates = [];
    let _toolType     = null;
    let _activeExprEl = null;
    let _savedJson    = "";
    let _compileTimer = null;

    function _emptyModel() {
        return { sources: [], transformations: [], final_relation_id: "", order_by: [], meta: { schema_version: 1 } };
    }

    function _genId() {
        return "x" + Math.random().toString(36).slice(2, 10);
    }


    // --------------------------------------------------------
    // EXPRESSION PARSER  (text → AST)
    // --------------------------------------------------------

    function _tokenize(text) {
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

    function _parseExpr(text) {
        if (!text || !text.trim()) return null;
        const tokens = _tokenize(text.trim());
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
    // EXPRESSION RENDERER  (AST → text for <input> display)
    // --------------------------------------------------------

    function _exprToText(expr) {
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
                return `${expr.name}(${(expr.args||[]).map(_exprToText).join(", ")})`;
            case "binary_op":
                return `${_exprToText(expr.left)} ${expr.op} ${_exprToText(expr.right)}`;
            case "logical":
                return (expr.args||[]).map(_exprToText).join(` ${expr.op.toUpperCase()} `);
            case "unary_op":
                return `NOT ${_exprToText(expr.expr)}`;
            case "is_null":
                return `${_exprToText(expr.expr)} IS NULL`;
            case "is_not_null":
                return `${_exprToText(expr.expr)} IS NOT NULL`;
            case "case": {
                const parts = ["CASE"];
                if (expr.operand !== null && expr.operand !== undefined) parts.push(_exprToText(expr.operand));
                for (const c of (expr.when_clauses||[])) {
                    parts.push(`WHEN ${_exprToText(c.when)} THEN ${_exprToText(c.then)}`);
                }
                const el = expr["else"];
                if (el !== null && el !== undefined) parts.push(`ELSE ${_exprToText(el)}`);
                parts.push("END");
                return parts.join(" ");
            }
            case "expr_sql":
                return expr.sql || "";  // Legacy — displays for migration, fails on compile
            default:
                return "";
        }
    }


    // --------------------------------------------------------
    // EXPRESSION PARSE HELPER  (parse + set error state)
    // --------------------------------------------------------

    function _applyExpr(text, el, setter) {
        if (!text || !text.trim()) {
            setter({});
            if (el) { el.classList.remove("etl-expr-error"); el.title = ""; }
            _scheduleCompile();
            return;
        }
        try {
            setter(_parseExpr(text));
            if (el) { el.classList.remove("etl-expr-error"); el.title = ""; }
            _scheduleCompile();
        } catch (err) {
            if (el) { el.classList.add("etl-expr-error"); el.title = err.message; }
        }
    }


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    function setToolType(type) { _toolType = type || null; }

    async function init() {
        if (!_toolType) {
            try { const t = await ApiClient.loadTool(); _toolType = t.tool_type || null; } catch (_) {}
        }
        try {
            const cfg = await ApiClient.etlLoadConfig();
            _model   = cfg.etl_model || _emptyModel();
            _history = cfg.etl_history || [];
            _renderHistory();
        } catch (err) {
            console.warn("ETL config unavailable:", err.message);
        }
        _savedJson = JSON.stringify(_model);
        _renderModel();
        await refreshSchema();
        await refreshTemplates();
        window.addEventListener("beforeunload", e => {
            if (JSON.stringify(_model) !== _savedJson) { e.preventDefault(); e.returnValue = ""; }
        });
    }


    // --------------------------------------------------------
    // MODEL RENDER
    // --------------------------------------------------------

    function _renderModel() {
        _renderSources();
        _renderTransformations();
        _renderFinalRelation();
        _renderOrderBy();
        _scheduleCompile();
    }

    function _renderSources() {
        const el = document.getElementById("etl-sources-list");
        if (!el) return;
        if (!_model.sources.length) {
            el.innerHTML = '<div class="etl-empty">No sources. Click a table in the schema browser, or use &ldquo;+ Add&rdquo;.</div>';
            return;
        }
        el.innerHTML = _model.sources.map(s => `
            <div class="etl-card">
                <span class="etl-rel-id">${_esc(s.id)}</span>
                <span class="etl-card-name">${_esc(s.name)}</span>
                <label class="etl-lbl">alias:</label>
                <input class="etl-input-xs" value="${_ea(s.alias)}"
                       onchange="EtlEditor._updateSourceAlias('${s.id}',this.value)">
                <button class="etl-btn-icon" onclick="EtlEditor._removeSource('${s.id}')" title="Remove">✕</button>
            </div>`).join("");
    }

    function _renderTransformations() {
        const el = document.getElementById("etl-transformations-list");
        if (!el) return;
        if (!_model.transformations.length) {
            el.innerHTML = '<div class="etl-empty">No transformations. Add one with the buttons above.</div>';
            return;
        }
        el.innerHTML = _model.transformations.map(t => _renderTransformation(t)).join("");
    }

    function _renderTransformation(t) {
        const header = `
            <div class="etl-card-header">
                <span class="etl-type-badge">${t.type.replace("_"," ").toUpperCase()}</span>
                <span class="etl-rel-id">${t.id}</span>
                <label class="etl-lbl">inputs:</label>
                <input class="etl-input-xs" style="min-width:80px;flex:1"
                       value="${_ea((t.inputs||[]).join(", "))}"
                       onchange="EtlEditor._updateInputs('${t.id}',this.value)"
                       title="Comma-separated relation IDs">
                <button class="etl-btn-icon" onclick="EtlEditor._removeTransformation('${t.id}')" title="Remove">✕</button>
            </div>`;
        let body = "";
        if      (t.type === "select")         body = _renderSelectBody(t);
        else if (t.type === "filter")         body = _renderFilterBody(t);
        else if (t.type === "join")           body = _renderJoinBody(t);
        else if (t.type === "aggregate")      body = _renderAggregateBody(t);
        else if (t.type === "compute_column") body = _renderComputeBody(t);
        return `<div class="etl-card etl-card-transform">${header}${body}</div>`;
    }

    function _renderSelectBody(t) {
        const rows = (t.columns||[]).map(c => `
            <div class="etl-col-row">
                <input class="etl-input-xs" style="width:90px" value="${_ea(c.alias)}" placeholder="alias"
                       onchange="EtlEditor._updateColAlias('${t.id}','${c.id}',this.value)"
                       onfocus="EtlEditor._setActiveExpr(null)">
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(c.expr||{}))}" placeholder="expression (e.g. il.tag)"
                       onchange="EtlEditor._updateColExpr('${t.id}','${c.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
                <button class="etl-btn-icon" onclick="EtlEditor._removeColumn('${t.id}','${c.id}')">✕</button>
            </div>`).join("");
        return `<div class="etl-cols">${rows}</div>
                <button class="etl-btn-add-row" onclick="EtlEditor._addColumn('${t.id}')">+ Column</button>`;
    }

    function _renderFilterBody(t) {
        return `
            <div class="etl-col-row">
                <label class="etl-lbl">condition:</label>
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(t.condition||{}))}" placeholder="e.g. il.voltage > 0"
                       onchange="EtlEditor._updateFilterCond('${t.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
                <select class="etl-select-xs" onchange="EtlEditor._updateFilterMode('${t.id}',this.value)">
                    <option value="where"  ${t.mode==='where' ?'selected':''}>WHERE</option>
                    <option value="having" ${t.mode==='having'?'selected':''}>HAVING</option>
                </select>
            </div>`;
    }

    function _renderJoinBody(t) {
        const jTypes = ["INNER","LEFT","RIGHT","FULL"];
        return `
            <div class="etl-col-row">
                <select class="etl-select-xs" onchange="EtlEditor._updateJoinType('${t.id}',this.value)">
                    ${jTypes.map(jt => `<option ${t.join_type===jt?'selected':''}>${jt}</option>`).join("")}
                </select>
                <label class="etl-lbl">JOIN &nbsp; left:</label>
                <input class="etl-input-xs" style="flex:1" value="${_ea(t.left_input||'')}" placeholder="relation id"
                       onchange="EtlEditor._updateJoinLeft('${t.id}',this.value)">
            </div>
            <div class="etl-col-row">
                <label class="etl-lbl">right source:</label>
                <input class="etl-input-xs" style="flex:1" value="${_ea(t.right_source||'')}" placeholder="source id"
                       onchange="EtlEditor._updateJoinRight('${t.id}',this.value)">
                <label class="etl-lbl">alias:</label>
                <input class="etl-input-xs" style="width:60px" value="${_ea(t.alias||'')}"
                       onchange="EtlEditor._updateJoinAlias('${t.id}',this.value)">
            </div>
            <div class="etl-col-row">
                <label class="etl-lbl">ON:</label>
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(t.condition||{}))}" placeholder="e.g. il.tag = cl.tag"
                       onchange="EtlEditor._updateJoinCond('${t.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
            </div>`;
    }

    function _renderAggregateBody(t) {
        const gbRows = (t.group_by||[]).map((g,i) => `
            <div class="etl-col-row">
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(g))}" placeholder="e.g. il.area"
                       onchange="EtlEditor._updateGroupBy('${t.id}',${i},this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
                <button class="etl-btn-icon" onclick="EtlEditor._removeGroupBy('${t.id}',${i})">✕</button>
            </div>`).join("");
        const aggRows = (t.aggregations||[]).map(c => `
            <div class="etl-col-row">
                <input class="etl-input-xs" style="width:90px" value="${_ea(c.alias)}" placeholder="alias"
                       onchange="EtlEditor._updateColAlias('${t.id}','${c.id}',this.value)"
                       onfocus="EtlEditor._setActiveExpr(null)">
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(c.expr||{}))}" placeholder="e.g. COUNT(1)"
                       onchange="EtlEditor._updateColExpr('${t.id}','${c.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
                <button class="etl-btn-icon" onclick="EtlEditor._removeAggregation('${t.id}','${c.id}')">✕</button>
            </div>`).join("");
        return `
            <div class="etl-subsection">GROUP BY</div>
            ${gbRows}
            <button class="etl-btn-add-row" onclick="EtlEditor._addGroupBy('${t.id}')">+ Group By expr</button>
            <div class="etl-subsection">AGGREGATIONS</div>
            ${aggRows}
            <button class="etl-btn-add-row" onclick="EtlEditor._addAggregation('${t.id}')">+ Aggregation</button>`;
    }

    function _renderComputeBody(t) {
        const c = t.column || { alias: "", expr: {} };
        return `
            <div class="etl-col-row">
                <label class="etl-lbl">alias:</label>
                <input class="etl-input-xs" style="width:90px" value="${_ea(c.alias)}" placeholder="column alias"
                       onchange="EtlEditor._updateComputeAlias('${t.id}',this.value)"
                       onfocus="EtlEditor._setActiveExpr(null)">
                <label class="etl-lbl">expr:</label>
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(c.expr||{}))}" placeholder="e.g. il.voltage * 1.1"
                       onchange="EtlEditor._updateComputeExpr('${t.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
            </div>`;
    }

    function _renderFinalRelation() {
        const el = document.getElementById("etl-final-relation");
        if (!el) return;
        const all = [
            ..._model.sources.map(s => ({ id: s.id, label: `source: ${s.name} (${s.alias})` })),
            ..._model.transformations.map(t => ({ id: t.id, label: `${t.type}: ${t.id}` }))
        ];
        if (!all.length) { el.innerHTML = '<div class="etl-empty" style="padding:6px 10px">Add a source first.</div>'; return; }
        if (!_model.final_relation_id || !all.find(r => r.id === _model.final_relation_id)) {
            _model.final_relation_id = all[all.length - 1].id;
        }
        const opts = all.map(r =>
            `<option value="${_ea(r.id)}" ${_model.final_relation_id === r.id ? "selected" : ""}>${_esc(r.label)}</option>`
        ).join("");
        el.innerHTML = `<div style="padding:6px 10px">
            <select class="etl-select-xs" style="width:100%" onchange="EtlEditor._setFinalRelation(this.value)">${opts}</select>
        </div>`;
    }

    function _renderOrderBy() {
        const el = document.getElementById("etl-orderby-list");
        if (!el) return;
        if (!_model.order_by.length) { el.innerHTML = '<div class="etl-empty" style="padding:6px 10px">No ordering defined.</div>'; return; }
        el.innerHTML = _model.order_by.map((o, i) => `
            <div class="etl-col-row">
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(_exprToText(o.expr||{}))}" placeholder="e.g. tag"
                       onchange="EtlEditor._updateOrderByExpr(${i},this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
                <select class="etl-select-xs" onchange="EtlEditor._updateOrderByDir(${i},this.value)">
                    <option value="asc"  ${o.direction==='asc' ?'selected':''}>ASC</option>
                    <option value="desc" ${o.direction==='desc'?'selected':''}>DESC</option>
                </select>
                <button class="etl-btn-icon" onclick="EtlEditor._removeOrderBy(${i})">✕</button>
            </div>`).join("");
    }


    // --------------------------------------------------------
    // SCHEMA BROWSER
    // --------------------------------------------------------

    async function refreshSchema() {
        const el = document.getElementById("etl-schema-browser");
        if (!el) return;
        el.innerHTML = '<div class="etl-empty">Loading...</div>';
        try {
            _renderSchema(await ApiClient.etlLoadSchema(), el);
        } catch (err) {
            el.innerHTML = `<div class="etl-empty" style="color:var(--color-danger)">Error: ${_esc(err.message)}</div>`;
        }
    }

    function _renderSchema(schema, container) {
        if (!schema.tools || !schema.tools.length) {
            container.innerHTML = '<div class="etl-empty">No tools in project.</div>';
            return;
        }
        let html = "";
        schema.tools.forEach(tool => {
            const gid    = tool.slug.replace(/[^a-z0-9]/gi, "_");
            const isOpen = tool.is_current;
            const colsHtml = tool.columns.map(col => {
                const sys = col.is_system ? `<span class="schema-col-system">sys</span>` : "";
                return `
                    <div class="schema-col-item"
                         onclick="EtlEditor.insertColumn('${tool.slug}','${col.slug}')"
                         title="${_ea(tool.slug + "." + col.slug)}">
                        <span class="schema-col-name">${_esc(col.name)}</span>
                        <span class="schema-col-type">${_esc(col.type||"")}</span>
                        ${sys}
                    </div>`;
            }).join("");
            html += `
                <div class="schema-group">
                    <div class="schema-group-header ${tool.is_current ? "tool-group-current" : ""}"
                         data-group-id="${gid}">
                        <span class="schema-group-arrow ${isOpen ? "open" : ""}">▶</span>
                        <span class="schema-group-icon">${_esc(tool.icon||"📄")}</span>
                        <span class="schema-group-name">${_esc(tool.name)}</span>
                        <span class="schema-group-badge">${tool.columns.length}</span>
                    </div>
                    <div class="schema-columns ${isOpen ? "open" : ""}" id="schema-cols-${gid}">
                        ${colsHtml}
                    </div>
                </div>`;
        });
        container.innerHTML = html;
        container.querySelectorAll(".schema-group-header").forEach(h => {
            h.addEventListener("click", () => {
                const gid   = h.dataset.groupId;
                const cols  = document.getElementById(`schema-cols-${gid}`);
                const arrow = h.querySelector(".schema-group-arrow");
                const open  = cols.classList.contains("open");
                cols.classList.toggle("open", !open);
                if (arrow) arrow.classList.toggle("open", !open);
            });
        });
    }

    // Column click: insert alias.col into active expr field
    function insertColumn(toolSlug, colSlug) {
        let src = _model.sources.find(s => s.name === toolSlug);
        if (!src) {
            src = _addSource(toolSlug, _autoAlias(toolSlug));
            Utils.showToast(`Source "${toolSlug}" added.`, "info");
        }
        const snippet = `${src.alias}.${colSlug}`;
        if (_activeExprEl) {
            const start = _activeExprEl.selectionStart !== undefined ? _activeExprEl.selectionStart : _activeExprEl.value.length;
            const end   = _activeExprEl.selectionEnd   !== undefined ? _activeExprEl.selectionEnd   : start;
            const val   = _activeExprEl.value;
            _activeExprEl.value = val.slice(0, start) + snippet + val.slice(end);
            _activeExprEl.dispatchEvent(new Event("change"));
            _activeExprEl.focus();
        } else {
            navigator.clipboard.writeText(snippet).catch(() => {});
            Utils.showToast(`Copied: ${snippet}`, "info");
        }
    }

    function _setActiveExpr(el) { _activeExprEl = el; }


    // --------------------------------------------------------
    // SOURCE MUTATIONS
    // --------------------------------------------------------

    function _addSource(slug, alias) {
        const src = { id: _genId(), type: "table", name: slug, alias: alias };
        _model.sources.push(src);
        if (!_model.final_relation_id) _model.final_relation_id = src.id;
        _renderModel();
        return src;
    }

    function addSourcePrompt() {
        const slug = prompt("Tool slug (e.g. instrument_list):");
        if (!slug || !slug.trim()) return;
        const alias = prompt("SQL alias:", _autoAlias(slug.trim()));
        if (alias === null) return;
        _addSource(slug.trim(), alias.trim() || _autoAlias(slug.trim()));
    }

    function _autoAlias(slug) {
        const parts = slug.split("_").filter(Boolean);
        return parts.length >= 2 ? parts.map(p => p[0]).join("") : slug.slice(0, 2);
    }

    function _updateSourceAlias(id, alias) {
        const s = _model.sources.find(x => x.id === id);
        if (s) { s.alias = alias; _scheduleCompile(); }
    }

    function _removeSource(id) {
        _model.sources = _model.sources.filter(s => s.id !== id);
        _renderModel();
    }


    // --------------------------------------------------------
    // TRANSFORMATION MUTATIONS
    // --------------------------------------------------------

    function addTransformation(type) {
        const id     = _genId();
        const lastId = _lastRelationId();
        const t = { id, type, inputs: lastId ? [lastId] : [] };
        if      (type === "select")         { t.columns = []; }
        else if (type === "filter")         { t.condition = {}; t.mode = "where"; }
        else if (type === "join")           { t.join_type = "INNER"; t.left_input = lastId||""; t.right_source = ""; t.alias = ""; t.condition = {}; }
        else if (type === "aggregate")      { t.group_by = []; t.aggregations = []; }
        else if (type === "compute_column") { t.column = { id: _genId(), alias: "", expr: {} }; }
        _model.transformations.push(t);
        _model.final_relation_id = id;
        _renderModel();
    }

    function _lastRelationId() {
        if (_model.transformations.length) return _model.transformations[_model.transformations.length - 1].id;
        if (_model.sources.length)         return _model.sources[_model.sources.length - 1].id;
        return null;
    }

    function _removeTransformation(id) {
        _model.transformations = _model.transformations.filter(t => t.id !== id);
        if (_model.final_relation_id === id) _model.final_relation_id = _lastRelationId() || "";
        _renderModel();
    }

    function _updateInputs(tid, val) {
        const t = _model.transformations.find(x => x.id === tid);
        if (t) { t.inputs = val.split(",").map(s => s.trim()).filter(Boolean); _scheduleCompile(); }
    }


    // --------------------------------------------------------
    // COLUMN MUTATIONS (select + aggregate share these)
    // --------------------------------------------------------

    function _findT(tid) { return _model.transformations.find(t => t.id === tid); }
    function _colList(t) { return t.type === "select" ? t.columns : t.type === "aggregate" ? t.aggregations : null; }

    function _addColumn(tid) {
        const t = _findT(tid); if (!t) return;
        const list = _colList(t);
        if (list) { list.push({ id: _genId(), alias: "", expr: {} }); }
        _renderModel();
    }

    function _removeColumn(tid, cid) {
        const t = _findT(tid); if (!t) return;
        const list = _colList(t);
        if (list) { const i = list.findIndex(c => c.id === cid); if (i !== -1) list.splice(i, 1); }
        _renderModel();
    }

    function _updateColAlias(tid, cid, alias) {
        const t = _findT(tid); if (!t) return;
        const list = _colList(t);
        if (list) { const c = list.find(x => x.id === cid); if (c) { c.alias = alias; _scheduleCompile(); } }
    }

    function _updateColExpr(tid, cid, text, el) {
        const t = _findT(tid); if (!t) return;
        const list = _colList(t);
        if (!list) return;
        const c = list.find(x => x.id === cid); if (!c) return;
        _applyExpr(text, el, ast => { c.expr = ast; });
    }


    // --------------------------------------------------------
    // FILTER / JOIN / AGGREGATE / COMPUTE MUTATIONS
    // --------------------------------------------------------

    function _updateFilterCond(tid, text, el) {
        const t = _findT(tid); if (!t) return;
        _applyExpr(text, el, ast => { t.condition = ast; });
    }
    function _updateFilterMode(tid, mode) { const t = _findT(tid); if (t) { t.mode = mode; _scheduleCompile(); } }

    function _updateJoinType(tid, jt)       { const t = _findT(tid); if (t) { t.join_type = jt; _scheduleCompile(); } }
    function _updateJoinLeft(tid, v)        { const t = _findT(tid); if (t) { t.left_input = v; _scheduleCompile(); } }
    function _updateJoinRight(tid, v)       { const t = _findT(tid); if (t) { t.right_source = v; _scheduleCompile(); } }
    function _updateJoinAlias(tid, v)       { const t = _findT(tid); if (t) { t.alias = v; _scheduleCompile(); } }
    function _updateJoinCond(tid, text, el) {
        const t = _findT(tid); if (!t) return;
        _applyExpr(text, el, ast => { t.condition = ast; });
    }

    function _addGroupBy(tid) {
        const t = _findT(tid); if (t && t.group_by) { t.group_by.push({}); _renderModel(); }
    }
    function _removeGroupBy(tid, i) {
        const t = _findT(tid); if (t && t.group_by) { t.group_by.splice(i, 1); _renderModel(); }
    }
    function _updateGroupBy(tid, i, text, el) {
        const t = _findT(tid); if (!t || !t.group_by) return;
        _applyExpr(text, el, ast => { t.group_by[i] = ast; });
    }

    function _addAggregation(tid) {
        const t = _findT(tid);
        if (t && t.aggregations) { t.aggregations.push({ id: _genId(), alias: "", expr: {} }); _renderModel(); }
    }
    function _removeAggregation(tid, cid) {
        const t = _findT(tid);
        if (t && t.aggregations) { t.aggregations = t.aggregations.filter(c => c.id !== cid); _renderModel(); }
    }

    function _updateComputeAlias(tid, alias) {
        const t = _findT(tid); if (t && t.column) { t.column.alias = alias; _scheduleCompile(); }
    }
    function _updateComputeExpr(tid, text, el) {
        const t = _findT(tid); if (!t || !t.column) return;
        _applyExpr(text, el, ast => { t.column.expr = ast; });
    }


    // --------------------------------------------------------
    // FINAL RELATION + ORDER BY
    // --------------------------------------------------------

    function _setFinalRelation(id) { _model.final_relation_id = id; _scheduleCompile(); }

    function addOrderBy() {
        _model.order_by.push({ expr: {}, direction: "asc" });
        _renderOrderBy();
    }

    function _updateOrderByExpr(i, text, el) {
        if (!_model.order_by[i]) return;
        _applyExpr(text, el, ast => { _model.order_by[i].expr = ast; });
    }
    function _updateOrderByDir(i, dir) {
        if (_model.order_by[i]) { _model.order_by[i].direction = dir; _scheduleCompile(); }
    }
    function _removeOrderBy(i) { _model.order_by.splice(i, 1); _renderOrderBy(); }


    // --------------------------------------------------------
    // COMPILE (debounced — calls /etl/compile, no DB)
    // --------------------------------------------------------

    function _scheduleCompile() {
        clearTimeout(_compileTimer);
        _compileTimer = setTimeout(_compileAndShow, 400);
    }

    async function _compileAndShow() {
        const el = document.getElementById("etl-compiled-sql");
        if (!el) return;
        if (!_model.sources.length) { el.value = "-- Add a source to compile SQL."; return; }
        try {
            const r = await ApiClient.etlCompile(_model);
            el.value = r.sql || "";
        } catch (err) {
            el.value = `-- Compile error: ${err.message}`;
        }
    }


    // --------------------------------------------------------
    // PREVIEW / APPLY / SAVE
    // --------------------------------------------------------

    async function preview() {
        if (!_model.sources.length) { _showPreviewMsg("Add at least one source.", "warning"); return; }
        _showPreviewMsg("Running preview...", "info");
        try {
            const data = await ApiClient.etlPreview(_model);
            _previewData = data;
            _renderPreview(data);
        } catch (err) {
            _showPreviewMsg(`⚠ ${err.message}`, "error");
        }
    }

    async function apply() {
        if (!_model.sources.length) { Utils.showToast("Add at least one source.", "error"); return; }
        if (!_previewData)          { Utils.showToast("Run Preview first.", "error"); return; }
        const rc = _previewData.row_count || 0;
        if (!confirm(`Apply ETL?\n\n${rc} rows will be processed.\nManually-edited cells will not be overwritten.`)) return;
        _showPreviewMsg("Applying ETL...", "info");
        try {
            const result = await ApiClient.etlApply(_model);
            _renderApplyResult(result);
            Utils.showToast(
                `ETL complete: ${result.created} rows created, ${result.updated} updated` +
                (result.columns_created > 0 ? `, ${result.columns_created} columns added` : "") + ".",
                "success"
            );
            ApiClient.etlSaveDraft(_model).then(() => { _savedJson = JSON.stringify(_model); }).catch(() => {});
        } catch (err) {
            _showPreviewMsg(`⚠ ${err.message}`, "error");
            Utils.showToast("ETL error: " + err.message, "error");
        }
    }

    async function saveVersion() {
        if (!_model.sources.length) { Utils.showToast("Nothing to save.", "error"); return; }
        const label = prompt("Version name:", `Version ${_history.length + 1}`);
        if (label === null) return;
        try {
            const result = await ApiClient.etlSave(_model, label || null);
            _history   = result.history;
            _savedJson = JSON.stringify(_model);
            _renderHistory();
            Utils.showToast("Version saved.", "success");
        } catch (err) {
            Utils.showToast("Save error: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // HISTORY
    // --------------------------------------------------------

    function _renderHistory() {
        const el = document.getElementById("etl-history-list");
        if (!el) return;
        if (!_history.length) { el.innerHTML = '<div class="etl-empty">No saved versions.</div>'; return; }
        el.innerHTML = _history.map((v, i) => `
            <div class="etl-history-item" onclick="EtlEditor.loadVersion(${i})">
                <div class="etl-history-label">${_esc(v.label)}</div>
                <div class="etl-history-ts">${_formatTs(v.timestamp)}</div>
            </div>`).join("");
    }

    function loadVersion(i) {
        const v = _history[i]; if (!v) return;
        _model       = v.model || _emptyModel();
        _previewData = null;
        const pel = document.getElementById("etl-preview-container");
        if (pel) pel.innerHTML = "";
        _renderModel();
        Utils.showToast(`Version "${v.label}" loaded.`, "info");
    }


    // --------------------------------------------------------
    // TEMPLATES
    // --------------------------------------------------------

    async function refreshTemplates() {
        const el = document.getElementById("etl-templates-list");
        if (!el) return;
        try {
            const params = [];
            if (typeof PROJECT_ID !== "undefined") params.push(`project_id=${PROJECT_ID}`);
            if (_toolType) params.push(`type_slug=${encodeURIComponent(_toolType)}`);
            const url = "/api/tools/templates" + (params.length ? "?" + params.join("&") : "");
            _cachedTemplates = await fetch(url).then(r => r.json());
            _renderTemplatesList(el);
        } catch (err) {
            el.innerHTML = `<div class="etl-empty" style="color:var(--color-danger)">Error: ${_esc(err.message)}</div>`;
        }
    }

    function _renderTemplatesList(el) {
        if (!_cachedTemplates || !_cachedTemplates.length) {
            el.innerHTML = '<div class="etl-empty">No templates.</div>';
            return;
        }
        el.innerHTML = _cachedTemplates.map(t => `
            <div class="etl-history-item">
                <div class="etl-history-label">${_esc(t.name)}</div>
                <div class="etl-history-actions">
                    <button class="etl-history-btn" onclick="EtlEditor.loadTemplate(${t.id})" title="Load">↩</button>
                    <button class="etl-history-btn etl-history-btn-danger" onclick="EtlEditor.deleteTemplate(${t.id})" title="Delete">✕</button>
                </div>
            </div>`).join("");
    }

    async function saveAsTemplate() {
        if (!_model.sources.length) { Utils.showToast("Nothing to save.", "error"); return; }
        const name = prompt("Template name:", "");
        if (!name || !name.trim()) return;
        try {
            await ApiClient.saveTemplate({
                type_slug:  _toolType || "",
                name:       name.trim(),
                etl_sql:    JSON.stringify(_model),
                project_id: typeof PROJECT_ID !== "undefined" ? PROJECT_ID : null
            });
            Utils.showToast("Template saved.", "success");
            await refreshTemplates();
        } catch (err) {
            Utils.showToast("Error: " + err.message, "error");
        }
    }

    async function loadTemplate(templateId) {
        const t = _cachedTemplates.find(x => x.id === templateId);
        if (!t) return;
        try {
            const parsed = JSON.parse(t.etl_sql);
            if (!parsed || !parsed.sources) { Utils.showToast("Template is in old SQL format — not compatible.", "warning"); return; }
            if (JSON.stringify(_model) !== JSON.stringify(_emptyModel()) &&
                !confirm(`Replace current model with template "${t.name}"?`)) return;
            _model = parsed;
            _renderModel();
            Utils.showToast(`Template "${t.name}" loaded.`, "success");
        } catch (_) {
            Utils.showToast("Template is in old SQL format — not compatible.", "warning");
        }
    }

    async function deleteTemplate(templateId) {
        const t = _cachedTemplates.find(x => x.id === templateId);
        if (!t || !confirm(`Delete template "${t.name}"?`)) return;
        try {
            await ApiClient.deleteTemplate(templateId);
            Utils.showToast("Template deleted.", "success");
            await refreshTemplates();
        } catch (err) {
            Utils.showToast("Error: " + err.message, "error");
        }
    }

    function importFromFile() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
            const file = input.files[0]; if (!file) return;
            try {
                const parsed = JSON.parse(await file.text());
                if (!parsed || !parsed.sources) { Utils.showToast("Invalid model file.", "error"); return; }
                _model = parsed;
                _renderModel();
                Utils.showToast(`"${file.name}" loaded.`, "success");
            } catch (err) {
                Utils.showToast("Error reading file: " + err.message, "error");
            }
        };
        input.click();
    }

    function exportToFile() {
        const blob = new Blob([JSON.stringify(_model, null, 2)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `etl_${typeof TOOL_ID !== "undefined" ? TOOL_ID : "model"}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importFromSql() {
        // Reuse modal overlay if present, otherwise create
        let overlay = document.getElementById("etl-sql-import-modal");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "etl-sql-import-modal";
            overlay.style.cssText = [
                "position:fixed;inset:0;background:rgba(0,0,0,.45);",
                "display:flex;align-items:center;justify-content:center;z-index:9000;"
            ].join("");
            overlay.innerHTML = `
<div style="background:var(--color-surface);border:1px solid var(--color-border);
            border-radius:6px;width:680px;max-width:95vw;display:flex;flex-direction:column;
            max-height:80vh;overflow:hidden;">
  <div style="padding:10px 14px;font-size:13px;font-weight:600;border-bottom:1px solid var(--color-border);
              display:flex;align-items:center;gap:8px;">
    SQL → Model
    <span style="font-size:11px;font-weight:400;color:var(--color-text-muted)">
      Paste old SQL — simple column refs convert automatically; complex expressions will
      appear as <code>expr_sql</code> (shown in red in the editor) and must be re-entered.
    </span>
    <button id="etl-sql-import-close" style="margin-left:auto;background:none;border:none;
            font-size:16px;cursor:pointer;color:var(--color-text-muted)">✕</button>
  </div>
  <textarea id="etl-sql-import-textarea"
            spellcheck="false"
            placeholder="SELECT i.tag, i.description\nFROM instrument_list i\nWHERE i.active = 1\nORDER BY i.tag"
            style="flex:1;min-height:260px;padding:10px 12px;font-family:'Consolas','Monaco',monospace;
                   font-size:12px;border:none;border-bottom:1px solid var(--color-border);
                   background:var(--color-bg);color:var(--color-text);resize:vertical;outline:none;">
  </textarea>
  <div id="etl-sql-import-error"
       style="display:none;padding:6px 14px;font-size:12px;color:var(--color-danger);
              background:color-mix(in srgb,var(--color-danger) 8%,var(--color-bg));
              border-bottom:1px solid var(--color-border)"></div>
  <div style="padding:8px 14px;display:flex;gap:8px;justify-content:flex-end">
    <button id="etl-sql-import-cancel" class="btn btn-ghost btn-sm">Cancel</button>
    <button id="etl-sql-import-confirm" class="btn btn-primary btn-sm">Convert & Load</button>
  </div>
</div>`;
            document.body.appendChild(overlay);

            function _close() { overlay.remove(); }
            overlay.addEventListener("click", e => { if (e.target === overlay) _close(); });
            document.getElementById("etl-sql-import-close").onclick  = _close;
            document.getElementById("etl-sql-import-cancel").onclick = _close;
            document.getElementById("etl-sql-import-confirm").onclick = async () => {
                const sql = document.getElementById("etl-sql-import-textarea").value.trim();
                const errEl = document.getElementById("etl-sql-import-error");
                errEl.style.display = "none";
                if (!sql) { errEl.textContent = "Paste a SQL query first."; errEl.style.display = "block"; return; }
                const btn = document.getElementById("etl-sql-import-confirm");
                btn.disabled = true;
                btn.textContent = "Converting…";
                try {
                    const result = await ApiClient.etlSqlToModel(sql);
                    _model = result.model;
                    _renderModel();
                    Utils.showToast("Model loaded from SQL.", "success");
                    _close();
                } catch (err) {
                    const detail = err.detail || err.message || String(err);
                    errEl.textContent = "Error: " + detail;
                    errEl.style.display = "block";
                } finally {
                    btn.disabled = false;
                    btn.textContent = "Convert & Load";
                }
            };
        }
        document.body.appendChild(overlay);
        document.getElementById("etl-sql-import-textarea").value = "";
        document.getElementById("etl-sql-import-error").style.display = "none";
        document.getElementById("etl-sql-import-textarea").focus();
    }


    // --------------------------------------------------------
    // PREVIEW RENDERING
    // --------------------------------------------------------

    function _renderPreview(data) {
        const el = document.getElementById("etl-preview-container");
        if (!el) return;
        let warn = "";
        if (data.warnings && data.warnings.length) {
            warn = `<div class="etl-warnings">${data.warnings.map(w => `<div class="etl-warning">⚠ ${_esc(w)}</div>`).join("")}</div>`;
        }
        if (!data.rows || !data.rows.length) {
            el.innerHTML = warn + '<div class="etl-empty">Query executed — no results.</div>';
            return;
        }
        const rows = data.rows.slice(0, 50);
        const heads = data.columns.map(c => `<th>${_esc(c)}</th>`).join("");
        const body  = rows.map(r =>
            `<tr>${data.columns.map(c => `<td>${_esc(String(r[c] ?? ""))}</td>`).join("")}</tr>`
        ).join("");
        const note = data.rows.length > 50
            ? `<div class="etl-note">Showing 50 of ${data.rows.length} rows.</div>` : "";
        el.innerHTML = `${warn}
            <div class="etl-preview-info">${data.row_count} rows returned</div>
            ${note}
            <div class="etl-preview-table-wrapper">
                <table class="etl-preview-table"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>
            </div>`;
    }

    function _renderApplyResult(result) {
        const el = document.getElementById("etl-preview-container");
        if (!el) return;
        const errs = result.errors && result.errors.length
            ? `<div class="etl-warnings">${result.errors.map(e => `<div class="etl-warning">⚠ ${_esc(e)}</div>`).join("")}</div>` : "";
        el.innerHTML = `${errs}
            <div class="etl-apply-result">
                ${result.columns_created > 0 ? `<div class="etl-result-item etl-result-updated">+ ${result.columns_created} columns created automatically</div>` : ""}
                <div class="etl-result-item etl-result-created">✓ ${result.created} rows created</div>
                <div class="etl-result-item etl-result-updated">↺ ${result.updated} rows updated</div>
                <div class="etl-result-item etl-result-skipped">⊘ ${result.skipped_cells} cells preserved (manually edited)</div>
            </div>`;
    }

    function _showPreviewMsg(msg, type = "info") {
        const el = document.getElementById("etl-preview-container");
        if (!el) return;
        const colors = { info: "var(--color-text-muted)", error: "var(--color-danger)", warning: "var(--color-warning)", success: "var(--color-success)" };
        el.innerHTML = `<div style="color:${colors[type]||colors.info};padding:12px 0;font-size:13px">${_esc(msg)}</div>`;
    }


    // --------------------------------------------------------
    // UTILITIES
    // --------------------------------------------------------

    const _esc      = Utils.escHtml;
    const _formatTs = Utils.formatTimestamp;

    function _ea(str) {
        return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }


    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    return {
        init, setToolType,
        preview, apply, saveVersion,
        refreshSchema, refreshTemplates,
        insertColumn,
        addSourcePrompt, addTransformation, addOrderBy,
        loadVersion, loadTemplate, deleteTemplate,
        saveAsTemplate, importFromFile, exportToFile, importFromSql,
        // Exposed for inline event handlers:
        _updateSourceAlias, _removeSource,
        _updateInputs, _removeTransformation,
        _addColumn, _removeColumn, _updateColAlias, _updateColExpr,
        _updateFilterCond, _updateFilterMode,
        _updateJoinType, _updateJoinLeft, _updateJoinRight, _updateJoinAlias, _updateJoinCond,
        _addGroupBy, _removeGroupBy, _updateGroupBy,
        _addAggregation, _removeAggregation,
        _updateComputeAlias, _updateComputeExpr,
        _setFinalRelation,
        _updateOrderByExpr, _updateOrderByDir, _removeOrderBy,
        _setActiveExpr
    };

})();
