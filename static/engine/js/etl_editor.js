/**
 * etl_editor.js — ETL Editor standalone
 * ---------------------------------------
 * Usato dalla pagina /tool/{project_id}/{tool_id}/etl
 *
 * Con la nuova architettura flat-tables, le query ETL sono SQL nativo:
 *   SELECT il.tag, il.servizio FROM instrument_list il
 * Il click su una colonna nello schema browser inserisce: tool_slug.col_slug
 */

const EtlEditor = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _currentSql      = "";
    let _history         = [];
    let _previewData     = null;
    let _cachedTemplates = [];
    let _toolType        = null;
    let _cmEditor        = null;   // CodeMirror instance (null if CM not loaded)


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    function setToolType(type) {
        _toolType = type || null;
    }

    async function init() {
        // Carica tool_type se non già impostato dall'esterno
        if (!_toolType) {
            try {
                const tool = await ApiClient.loadTool();
                _toolType = tool.tool_type || null;
            } catch (_) {}
        }

        try {
            const config = await ApiClient.etlLoadConfig();
            _currentSql = config.etl_sql  || "";
            _history    = config.etl_history || [];

            _renderHistory();
        } catch (err) {
            console.warn("ETL config non disponibile:", err.message);
        }

        // Initialize CodeMirror if available, otherwise fall back to plain textarea
        const textarea = document.getElementById("etl-sql-input");
        if (textarea) {
            if (typeof CodeMirror !== "undefined") {
                _cmEditor = CodeMirror.fromTextArea(textarea, {
                    mode: "text/x-sql",
                    lineNumbers: true,
                    tabSize: 2,
                    indentWithTabs: false,
                    matchBrackets: true,
                    autoCloseBrackets: true,
                    lineWrapping: false,
                    extraKeys: {
                        "Ctrl-Enter": () => preview(),
                        "Tab":        cm => cm.execCommand("indentMore"),
                        "Shift-Tab":  cm => cm.execCommand("indentLess")
                    }
                });
                _cmEditor.setValue(_currentSql);
                _cmEditor.refresh();
            } else {
                textarea.value = _currentSql;
                // Fallback Ctrl+Enter on plain textarea
                document.addEventListener("keydown", e => {
                    if (e.ctrlKey && e.key === "Enter" && document.activeElement === textarea) {
                        preview();
                    }
                });
            }
        }

        // Carica schema e template subito (siamo su pagina dedicata)
        await refreshSchema();
        await refreshTemplates();

        // Avvisa se si esce con modifiche non salvate
        window.addEventListener("beforeunload", e => {
            if (_getSql() !== _currentSql.trim()) {
                e.preventDefault();
                e.returnValue = "";
            }
        });
    }


    // --------------------------------------------------------
    // SCHEMA BROWSER
    // --------------------------------------------------------

    async function refreshSchema() {
        const container = document.getElementById("etl-schema-browser");
        if (!container) return;
        container.innerHTML = '<div class="etl-empty">Caricamento...</div>';

        try {
            const schema = await ApiClient.etlLoadSchema();
            _renderSchema(schema, container);
        } catch (err) {
            container.innerHTML =
                `<div class="etl-empty" style="color:var(--color-danger)">
                    Errore: ${_esc(err.message)}
                </div>`;
        }
    }

    function _renderSchema(schema, container) {
        if (!schema.tools || schema.tools.length === 0) {
            container.innerHTML = '<div class="etl-empty">Nessun tool nel progetto.</div>';
            return;
        }

        let html = "";
        schema.tools.forEach(tool => {
            const groupId  = tool.slug.replace(/[^a-z0-9]/gi, "_");
            const isOpen   = tool.is_current;
            const cssClass = tool.is_current ? "tool-group tool-group-current" : "tool-group";

            const colsHtml = tool.columns.map(col => {
                const snippet = `${tool.slug}.${col.slug}`;
                const sysTag  = col.is_system
                    ? `<span class="schema-col-system">sys</span>` : "";
                return `
                    <div class="schema-col-item"
                         data-snippet="${_escAttr(snippet)}"
                         onclick="EtlEditor.insertColumn(this.dataset.snippet)"
                         title="${_escAttr(snippet)}">
                        <span class="schema-col-name">${_esc(col.name)}</span>
                        <span class="schema-col-type">${_esc(col.type || "")}</span>
                        ${sysTag}
                    </div>`;
            }).join("");

            html += `
                <div class="schema-group">
                    <div class="schema-group-header ${cssClass}"
                         data-group-id="${groupId}">
                        <span class="schema-group-arrow ${isOpen ? "open" : ""}">▶</span>
                        <span class="schema-group-icon">${_esc(tool.icon || "📄")}</span>
                        <span class="schema-group-name">${_esc(tool.name)}</span>
                        <span class="schema-group-badge">${tool.columns.length}</span>
                    </div>
                    <div class="schema-columns ${isOpen ? "open" : ""}"
                         id="schema-cols-${groupId}">
                        ${colsHtml}
                    </div>
                </div>`;
        });

        container.innerHTML = html;

        container.querySelectorAll(".schema-group-header").forEach(header => {
            header.addEventListener("click", () => {
                const groupId = header.dataset.groupId;
                const colsEl  = document.getElementById(`schema-cols-${groupId}`);
                const arrowEl = header.querySelector(".schema-group-arrow");
                const isOpen  = colsEl.classList.contains("open");
                colsEl.classList.toggle("open", !isOpen);
                arrowEl.classList.toggle("open", !isOpen);
            });
        });
    }

    function insertColumn(text) {
        if (_cmEditor) {
            const doc    = _cmEditor.getDoc();
            const cursor = doc.getCursor();
            doc.replaceRange(text, cursor);
            _cmEditor.focus();
            return;
        }
        const editor = document.getElementById("etl-sql-input");
        if (!editor) return;
        const start = editor.selectionStart;
        const end   = editor.selectionEnd;
        editor.value =
            editor.value.substring(0, start) +
            text +
            editor.value.substring(end);
        const newPos = start + text.length;
        editor.setSelectionRange(newPos, newPos);
        editor.focus();
    }


    // --------------------------------------------------------
    // PREVIEW
    // --------------------------------------------------------

    async function preview() {
        const sql = _getSql();
        if (!sql) {
            _showPreviewMessage("Inserisci una query SQL.", "warning");
            return;
        }
        _showPreviewMessage("Esecuzione query...", "info");
        try {
            const data = await ApiClient.etlPreview(sql);
            _previewData = data;
            _renderPreview(data);
        } catch (err) {
            _showPreviewMessage(`⚠ ${err.message}`, "error");
        }
    }


    // --------------------------------------------------------
    // APPLY
    // --------------------------------------------------------

    async function apply() {
        const sql = _getSql();
        if (!sql) {
            showToast("Inserisci una query SQL prima di applicare.", "error");
            return;
        }
        if (!_previewData) {
            showToast("Esegui prima la Preview per verificare i risultati.", "error");
            return;
        }

        const rowCount = _previewData.row_count || 0;
        if (!confirm(
            `Applicare l'ETL?\n\n` +
            `Verranno elaborate ${rowCount} righe.\n` +
            `Le celle modificate manualmente non verranno toccate.`
        )) return;

        _showPreviewMessage("Applicazione ETL in corso...", "info");

        try {
            const result = await ApiClient.etlApply(sql);
            _renderApplyResult(result);
            showToast(
                `ETL completato: ${result.created} righe create, ` +
                `${result.updated} aggiornate` +
                (result.columns_created > 0
                    ? `, ${result.columns_created} colonne aggiunte` : "") + ".",
                "success"
            );
            // Salva la query silenziosamente dopo un apply riuscito
            ApiClient.etlSaveDraft(sql).then(() => { _currentSql = sql; }).catch(() => {});
        } catch (err) {
            _showPreviewMessage(`⚠ ${err.message}`, "error");
            showToast("Errore ETL: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // SALVATAGGIO VERSIONE
    // --------------------------------------------------------

    async function saveVersion() {
        const sql = _getSql();
        if (!sql) { showToast("Nessuna query da salvare.", "error"); return; }

        const label = prompt("Nome versione:", `Versione ${_history.length + 1}`);
        if (label === null) return;

        try {
            const result = await ApiClient.etlSave(sql, label || null);
            _history    = result.history;
            _currentSql = sql;
            _renderHistory();
            showToast("Versione salvata.", "success");
        } catch (err) {
            showToast("Errore salvataggio: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // TEMPLATE
    // --------------------------------------------------------

    async function refreshTemplates() {
        const container = document.getElementById("etl-templates-list");
        if (!container) return;

        try {
            const params = [];
            if (typeof PROJECT_ID !== "undefined") params.push(`project_id=${PROJECT_ID}`);
            if (_toolType) params.push(`type_slug=${encodeURIComponent(_toolType)}`);
            const url = "/api/tools/templates" + (params.length ? "?" + params.join("&") : "");
            _cachedTemplates = await fetch(url).then(r => r.json());
            _renderTemplatesList(container);
        } catch (err) {
            container.innerHTML =
                `<div class="etl-empty" style="color:var(--color-danger)">
                    Errore: ${_esc(err.message)}</div>`;
        }
    }

    function _renderTemplatesList(container) {
        if (!_cachedTemplates || _cachedTemplates.length === 0) {
            container.innerHTML = '<div class="etl-empty">Nessun template salvato.</div>';
            return;
        }
        container.innerHTML = _cachedTemplates.map(t => {
            const tooltip = t.description
                ? _escAttr(`${t.name}\n${t.description}`)
                : _escAttr(t.name);
            return `
            <div class="etl-history-item">
                <div class="etl-history-label" title="${tooltip}">${_esc(t.name)}</div>
                <div class="etl-history-actions">
                    <button class="etl-history-btn"
                            onclick="EtlEditor.loadTemplate(${t.id})"
                            title="Carica">↩</button>
                    <button class="etl-history-btn etl-history-btn-danger"
                            onclick="EtlEditor.deleteTemplate(${t.id})"
                            title="Elimina">✕</button>
                </div>
            </div>`;
        }).join("");
    }

    async function saveAsTemplate() {
        const sql = _getSql();
        if (!sql) { showToast("Nessuna query da salvare.", "error"); return; }

        const name = prompt("Nome del template:", "");
        if (name === null) return;
        if (!name.trim()) { showToast("Nome vuoto.", "error"); return; }

        const typeSlug = _toolType
            || (typeof ToolbarManager !== "undefined" ? ToolbarManager.getToolType() : null)
            || "";

        try {
            await ApiClient.saveTemplate({
                type_slug:  typeSlug,
                name:       name.trim(),
                etl_sql:    sql,
                project_id: (typeof PROJECT_ID !== "undefined") ? PROJECT_ID : null
            });
            showToast("Template salvato.", "success");
            await refreshTemplates();
        } catch (err) {
            showToast("Errore: " + err.message, "error");
        }
    }

    async function importFromFile() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".sql,.json,.txt";
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                let sql = text;
                if (file.name.endsWith(".json")) {
                    const parsed = JSON.parse(text);
                    sql = parsed.etl_sql || parsed.sql || text;
                }
                _setSql(sql);
                _currentSql = sql;
                showToast(`File "${file.name}" caricato.`, "success");
            } catch (err) {
                showToast("Errore lettura file: " + err.message, "error");
            }
        };
        input.click();
    }

    function exportToFile() {
        const sql = _getSql();
        if (!sql) { showToast("Nessuna query da esportare.", "error"); return; }
        const blob = new Blob([sql], { type: "text/plain" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `etl_${typeof TOOL_ID !== "undefined" ? TOOL_ID : "query"}.sql`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function loadTemplate(templateId) {
        const template = _cachedTemplates.find(t => t.id === templateId);
        if (!template) return;

        const currentSql = _getSql();
        if (currentSql && currentSql.trim() !== template.etl_sql.trim()) {
            if (!confirm(`Sostituire la query corrente con il template "${template.name}"?`)) return;
        }

        _setSql(template.etl_sql);
        _currentSql = template.etl_sql;
        showToast(`Template "${template.name}" caricato.`, "success");
    }

    async function deleteTemplate(templateId) {
        const template = _cachedTemplates.find(t => t.id === templateId);
        if (!template) return;
        if (!confirm(`Eliminare il template "${template.name}"?`)) return;

        try {
            await ApiClient.deleteTemplate(templateId);
            showToast("Template eliminato.", "success");
            await refreshTemplates();
        } catch (err) {
            showToast("Errore: " + err.message, "error");
        }
    }

    function loadVersion(index) {
        const version = _history[index];
        if (!version) return;
        _setSql(version.sql);
        _previewData = null;
        const previewEl = document.getElementById("etl-preview-container");
        if (previewEl) previewEl.innerHTML = "";
        showToast(`Versione '${version.label}' caricata.`, "info");
    }


    // --------------------------------------------------------
    // RENDERING PREVIEW
    // --------------------------------------------------------

    function _renderPreview(data) {
        const container = document.getElementById("etl-preview-container");
        if (!container) return;

        let warningsHtml = "";
        if (data.warnings && data.warnings.length > 0) {
            warningsHtml = `<div class="etl-warnings">
                ${data.warnings.map(w => `<div class="etl-warning">⚠ ${_esc(w)}</div>`).join("")}
            </div>`;
        }

        if (!data.rows || data.rows.length === 0) {
            container.innerHTML = warningsHtml +
                '<div class="etl-empty">Query eseguita — nessun risultato.</div>';
            return;
        }

        const previewRows = data.rows.slice(0, 50);
        const headers = data.columns.map(c => `<th>${_esc(c)}</th>`).join("");
        const rows = previewRows.map(row => {
            const cells = data.columns.map(c =>
                `<td>${_esc(String(row[c] ?? ""))}</td>`
            ).join("");
            return `<tr>${cells}</tr>`;
        }).join("");

        const truncNote = data.rows.length > 50
            ? `<div class="etl-note">Mostrate 50 di ${data.rows.length} righe.</div>` : "";

        container.innerHTML = `
            ${warningsHtml}
            <div class="etl-preview-info">${data.row_count} righe restituite</div>
            ${truncNote}
            <div class="etl-preview-table-wrapper">
                <table class="etl-preview-table">
                    <thead><tr>${headers}</tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    function _renderApplyResult(result) {
        const container = document.getElementById("etl-preview-container");
        if (!container) return;

        const errorsHtml = result.errors && result.errors.length > 0
            ? `<div class="etl-warnings">
                ${result.errors.map(e => `<div class="etl-warning">⚠ ${_esc(e)}</div>`).join("")}
               </div>` : "";

        container.innerHTML = `
            ${errorsHtml}
            <div class="etl-apply-result">
                ${result.columns_created > 0 ? `
                <div class="etl-result-item etl-result-updated">
                    + ${result.columns_created} colonne create automaticamente
                </div>` : ""}
                <div class="etl-result-item etl-result-created">
                    ✓ ${result.created} righe create
                </div>
                <div class="etl-result-item etl-result-updated">
                    ↺ ${result.updated} righe aggiornate
                </div>
                <div class="etl-result-item etl-result-skipped">
                    ⊘ ${result.skipped_cells} celle preservate (modificate manualmente)
                </div>
            </div>`;
    }

    function _renderHistory() {
        const container = document.getElementById("etl-history-list");
        if (!container) return;
        if (_history.length === 0) {
            container.innerHTML = '<div class="etl-empty">Nessuna versione salvata.</div>';
            return;
        }
        container.innerHTML = _history.map((v, i) => `
            <div class="etl-history-item" onclick="EtlEditor.loadVersion(${i})">
                <div class="etl-history-label">${_esc(v.label)}</div>
                <div class="etl-history-ts">${_formatTs(v.timestamp)}</div>
            </div>
        `).join("");
    }

    function _showPreviewMessage(message, type = "info") {
        const container = document.getElementById("etl-preview-container");
        if (!container) return;
        const colors = {
            info: "var(--color-text-muted)", error: "var(--color-danger)",
            warning: "var(--color-warning)", success: "var(--color-success)"
        };
        container.innerHTML = `
            <div style="color:${colors[type]};padding:12px 0;font-size:13px">
                ${_esc(message)}
            </div>`;
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _getSql() {
        if (_cmEditor) return _cmEditor.getValue().trim();
        const editor = document.getElementById("etl-sql-input");
        return editor ? editor.value.trim() : "";
    }

    function _setSql(sql) {
        if (_cmEditor) {
            _cmEditor.setValue(sql || "");
            return;
        }
        const editor = document.getElementById("etl-sql-input");
        if (editor) editor.value = sql || "";
    }

    function formatSql() {
        if (typeof sqlFormatter === "undefined") {
            Utils.showToast("sql-formatter non disponibile.", "error");
            return;
        }
        const sql = _getSql();
        if (!sql) return;
        try {
            const formatted = sqlFormatter.format(sql, {
                language:    "sql",
                tabWidth:    2,
                keywordCase: "upper",
                linesBetweenQueries: 1
            });
            _setSql(formatted);
            Utils.showToast("SQL formattato.", "success");
        } catch (e) {
            Utils.showToast("Errore formattazione: " + e.message, "error");
        }
    }

    const _formatTs = Utils.formatTimestamp;
    const _esc = Utils.escHtml;

    function _escAttr(str) {
        return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        setToolType,
        preview,
        apply,
        saveVersion,
        saveAsTemplate,
        importFromFile,
        exportToFile,
        formatSql,
        loadVersion,
        loadTemplate,
        deleteTemplate,
        refreshSchema,
        refreshTemplates,
        insertColumn
    };

})();
