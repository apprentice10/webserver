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
            setter(EtlExpr.parseExpr(text));
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
            EtlModelRenderer.renderHistory(_history);
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
        // Normalize final_relation_id before rendering — renderer is pure
        const allIds = [
            ..._model.sources.map(s => s.id),
            ..._model.transformations.map(t => t.id)
        ];
        if (allIds.length && (!_model.final_relation_id || !allIds.includes(_model.final_relation_id))) {
            _model.final_relation_id = allIds[allIds.length - 1];
        }
        EtlModelRenderer.renderSources(_model);
        EtlModelRenderer.renderTransformations(_model);
        EtlModelRenderer.renderFinalRelation(_model);
        EtlModelRenderer.renderOrderBy(_model);
        _scheduleCompile();
    }


    // --------------------------------------------------------
    // SCHEMA BROWSER
    // --------------------------------------------------------

    async function refreshSchema() {
        const el = document.getElementById("etl-schema-browser");
        if (!el) return;
        el.innerHTML = '<div class="etl-empty">Loading...</div>';
        try {
            EtlModelRenderer.renderSchema(await ApiClient.etlLoadSchema(), el);
        } catch (err) {
            el.innerHTML = `<div class="etl-empty" style="color:var(--color-danger)">Error: ${_esc(err.message)}</div>`;
        }
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
        EtlModelRenderer.renderOrderBy(_model);
    }

    function _updateOrderByExpr(i, text, el) {
        if (!_model.order_by[i]) return;
        _applyExpr(text, el, ast => { _model.order_by[i].expr = ast; });
    }
    function _updateOrderByDir(i, dir) {
        if (_model.order_by[i]) { _model.order_by[i].direction = dir; _scheduleCompile(); }
    }
    function _removeOrderBy(i) { _model.order_by.splice(i, 1); EtlModelRenderer.renderOrderBy(_model); }


    // --------------------------------------------------------
    // COMPILE (debounced — calls /etl/compile, no DB)
    // --------------------------------------------------------

    function _scheduleCompile() {
        clearTimeout(_compileTimer);
        _compileTimer = setTimeout(_compileAndShow, 400);
    }

    async function _compileAndShow() {
        const el    = document.getElementById("etl-compiled-sql");
        const errEl = document.getElementById("etl-compile-error");
        if (!el) return;

        function _clearError() {
            el.classList.remove("etl-compiled-sql--error");
            if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }
        }
        function _showError(msg) {
            el.value = "";
            el.classList.add("etl-compiled-sql--error");
            if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
        }

        if (!_model.sources.length) {
            _clearError();
            el.value = "-- Add a source to compile SQL.";
            return;
        }
        try {
            const r = await ApiClient.etlCompile(_model);
            _clearError();
            el.value = r.sql || "";
        } catch (err) {
            _showError(err.message);
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
            EtlModelRenderer.renderHistory(_history);
            Utils.showToast("Version saved.", "success");
        } catch (err) {
            Utils.showToast("Save error: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // HISTORY
    // --------------------------------------------------------

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
            if (typeof DB_PATH !== "undefined") params.push(`db=${encodeURIComponent(DB_PATH)}`);
            if (_toolType) params.push(`type_slug=${encodeURIComponent(_toolType)}`);
            const url = "/api/tools/templates" + (params.length ? "?" + params.join("&") : "");
            _cachedTemplates = await fetch(url).then(r => r.json());
            EtlModelRenderer.renderTemplatesList(_cachedTemplates, el);
        } catch (err) {
            el.innerHTML = `<div class="etl-empty" style="color:var(--color-danger)">Error: ${_esc(err.message)}</div>`;
        }
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
                project_id: null
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

    const _esc = Utils.escHtml;


    // --------------------------------------------------------
    // Canvas bridge — read/write the live model
    // --------------------------------------------------------

    function getModel() {
        return JSON.parse(JSON.stringify(_model));
    }

    function loadModel(m) {
        _model = m;
        _renderModel();
    }


    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    return {
        init, setToolType,
        getModel, loadModel,
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
