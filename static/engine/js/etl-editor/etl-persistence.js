const EtlPersistence = (() => {

    let _toolType        = null;
    let _cachedTemplates = [];

    // JSON of an empty model — used to decide whether to confirm before replacing
    const _EMPTY_JSON = JSON.stringify({
        sources: [], transformations: [], final_relation_id: "", order_by: [],
        meta: { schema_version: 1 }
    });

    function configure(toolType) { _toolType = toolType || null; }

    function _dispatch(model) {
        document.dispatchEvent(new CustomEvent("etl:loadModel", { detail: { model } }));
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
            const url = "/api/engines/templates" + (params.length ? "?" + params.join("&") : "");
            _cachedTemplates = await fetch(url).then(r => r.json());
            EtlModelRenderer.renderTemplatesList(_cachedTemplates, el);
        } catch (err) {
            el.innerHTML = `<div class="etl-empty" style="color:var(--color-danger)">Error: ${Utils.escHtml(err.message)}</div>`;
        }
    }

    async function saveAsTemplate(model) {
        if (!model.sources.length) { Utils.showToast("Nothing to save.", "error"); return; }
        const name = prompt("Template name:", "");
        if (!name || !name.trim()) return;
        try {
            await ApiClient.saveTemplate({
                type_slug:  _toolType || "",
                name:       name.trim(),
                etl_sql:    JSON.stringify(model),
                project_id: null
            });
            Utils.showToast("Template saved.", "success");
            await refreshTemplates();
        } catch (err) {
            Utils.showToast("Error: " + err.message, "error");
        }
    }

    async function loadTemplate(templateId, currentModelJson) {
        const t = _cachedTemplates.find(x => x.id === templateId);
        if (!t) return;
        try {
            const parsed = JSON.parse(t.etl_sql);
            if (!parsed || !parsed.sources) {
                Utils.showToast("Template is in old SQL format — not compatible.", "warning");
                return;
            }
            if (currentModelJson !== _EMPTY_JSON &&
                !confirm(`Replace current model with template "${t.name}"?`)) return;
            _dispatch(parsed);
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


    // --------------------------------------------------------
    // FILE I/O
    // --------------------------------------------------------

    function importFromFile() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
            const file = input.files[0]; if (!file) return;
            try {
                const parsed = JSON.parse(await file.text());
                if (!parsed || !parsed.sources) { Utils.showToast("Invalid model file.", "error"); return; }
                _dispatch(parsed);
                Utils.showToast(`"${file.name}" loaded.`, "success");
            } catch (err) {
                Utils.showToast("Error reading file: " + err.message, "error");
            }
        };
        input.click();
    }

    function exportToFile(model) {
        const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `etl_${typeof TOOL_ID !== "undefined" ? TOOL_ID : "model"}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importFromSql() {
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
                    _dispatch(result.model);
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


    return {
        configure,
        refreshTemplates, saveAsTemplate, loadTemplate, deleteTemplate,
        importFromFile, exportToFile, importFromSql
    };

})();
