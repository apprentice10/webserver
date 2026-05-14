const EtlModelRenderer = (() => {

    const _esc      = Utils.escHtml;
    const _formatTs = Utils.formatTimestamp;

    function _ea(str) {
        return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }


    // --------------------------------------------------------
    // SOURCES
    // --------------------------------------------------------

    function renderSources(model) {
        const el = document.getElementById("etl-sources-list");
        if (!el) return;
        if (!model.sources.length) {
            el.innerHTML = '<div class="etl-empty">No sources. Click a table in the schema browser, or use &ldquo;+ Add&rdquo;.</div>';
            return;
        }
        el.innerHTML = model.sources.map(s => `
            <div class="etl-card">
                <span class="etl-rel-id">${_esc(s.id)}</span>
                <span class="etl-card-name">${_esc(s.name)}</span>
                <label class="etl-lbl">alias:</label>
                <input class="etl-input-xs" value="${_ea(s.alias)}"
                       onchange="EtlEditor._updateSourceAlias('${s.id}',this.value)">
                <button class="etl-btn-icon" onclick="EtlEditor._removeSource('${s.id}')" title="Remove">✕</button>
            </div>`).join("");
    }


    // --------------------------------------------------------
    // TRANSFORMATIONS
    // --------------------------------------------------------

    function renderTransformations(model) {
        const el = document.getElementById("etl-transformations-list");
        if (!el) return;
        if (!model.transformations.length) {
            el.innerHTML = '<div class="etl-empty">No transformations. Add one with the buttons above.</div>';
            return;
        }
        el.innerHTML = model.transformations.map(t => _renderTransformation(t)).join("");
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
                       value="${_ea(EtlExpr.exprToText(c.expr||{}))}" placeholder="expression (e.g. il.tag)"
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
                       value="${_ea(EtlExpr.exprToText(t.condition||{}))}" placeholder="e.g. il.voltage > 0"
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
                       value="${_ea(EtlExpr.exprToText(t.condition||{}))}" placeholder="e.g. il.tag = cl.tag"
                       onchange="EtlEditor._updateJoinCond('${t.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
            </div>`;
    }

    function _renderAggregateBody(t) {
        const gbRows = (t.group_by||[]).map((g,i) => `
            <div class="etl-col-row">
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(EtlExpr.exprToText(g))}" placeholder="e.g. il.area"
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
                       value="${_ea(EtlExpr.exprToText(c.expr||{}))}" placeholder="e.g. COUNT(1)"
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
                       value="${_ea(EtlExpr.exprToText(c.expr||{}))}" placeholder="e.g. il.voltage * 1.1"
                       onchange="EtlEditor._updateComputeExpr('${t.id}',this.value,this)"
                       onfocus="EtlEditor._setActiveExpr(this)">
            </div>`;
    }


    // --------------------------------------------------------
    // FINAL RELATION + ORDER BY
    // --------------------------------------------------------

    function renderFinalRelation(model) {
        const el = document.getElementById("etl-final-relation");
        if (!el) return;
        const all = [
            ...model.sources.map(s => ({ id: s.id, label: `source: ${s.name} (${s.alias})` })),
            ...model.transformations.map(t => ({ id: t.id, label: `${t.type}: ${t.id}` }))
        ];
        if (!all.length) {
            el.innerHTML = '<div class="etl-empty" style="padding:6px 10px">Add a source first.</div>';
            return;
        }
        const opts = all.map(r =>
            `<option value="${_ea(r.id)}" ${model.final_relation_id === r.id ? "selected" : ""}>${_esc(r.label)}</option>`
        ).join("");
        el.innerHTML = `<div style="padding:6px 10px">
            <select class="etl-select-xs" style="width:100%" onchange="EtlEditor._setFinalRelation(this.value)">${opts}</select>
        </div>`;
    }

    function renderOrderBy(model) {
        const el = document.getElementById("etl-orderby-list");
        if (!el) return;
        if (!model.order_by.length) {
            el.innerHTML = '<div class="etl-empty" style="padding:6px 10px">No ordering defined.</div>';
            return;
        }
        el.innerHTML = model.order_by.map((o, i) => `
            <div class="etl-col-row">
                <input class="etl-expr-input etl-input-xs" style="flex:1"
                       value="${_ea(EtlExpr.exprToText(o.expr||{}))}" placeholder="e.g. tag"
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
    // HISTORY + TEMPLATES
    // --------------------------------------------------------

    function renderHistory(history) {
        const el = document.getElementById("etl-history-list");
        if (!el) return;
        if (!history.length) { el.innerHTML = '<div class="etl-empty">No saved versions.</div>'; return; }
        el.innerHTML = history.map((v, i) => `
            <div class="etl-history-item" onclick="EtlEditor.loadVersion(${i})">
                <div class="etl-history-label">${_esc(v.label)}</div>
                <div class="etl-history-ts">${_formatTs(v.timestamp)}</div>
            </div>`).join("");
    }

    function renderTemplatesList(templates, el) {
        if (!templates || !templates.length) {
            el.innerHTML = '<div class="etl-empty">No templates.</div>';
            return;
        }
        el.innerHTML = templates.map(t => `
            <div class="etl-history-item">
                <div class="etl-history-label">${_esc(t.name)}</div>
                <div class="etl-history-actions">
                    <button class="etl-history-btn" onclick="EtlEditor.loadTemplate(${t.id})" title="Load">↩</button>
                    <button class="etl-history-btn etl-history-btn-danger" onclick="EtlEditor.deleteTemplate(${t.id})" title="Delete">✕</button>
                </div>
            </div>`).join("");
    }


    // --------------------------------------------------------
    // SCHEMA BROWSER
    // --------------------------------------------------------

    function renderSchema(schema, container) {
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


    return {
        renderSources, renderTransformations, renderFinalRelation, renderOrderBy,
        renderHistory, renderTemplatesList, renderSchema
    };

})();
