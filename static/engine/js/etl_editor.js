/**
 * etl_editor.js — Engine
 * -----------------------
 * ETL Editor integrato nel pannello Settings del tool.
 *
 * Responsabilità:
 * - Editor SQL con syntax highlighting base
 * - Preview risultati query
 * - Apply ETL con merge intelligente
 * - Salvataggio e storico versioni query
 * - Shortcut Ctrl+Enter per preview rapida
 */

const EtlEditor = (() => {

    // --------------------------------------------------------
    // SCHEMA BROWSER
    // --------------------------------------------------------

    async function refreshSchema() {
        const container = document.getElementById("etl-schema-browser");
        if (!container) {
            console.error("etl-schema-browser container non trovato");
            return;
        }

        container.innerHTML = '<div class="etl-empty">Caricamento...</div>';
        console.log("refreshSchema: chiamata API etlLoadSchema...");

        try {
            const schema = await ApiClient.etlLoadSchema();
            console.log("refreshSchema: schema ricevuto", schema);
            _renderSchema(schema, container);
            _schemaLoaded = true;
        } catch (err) {
            console.error("refreshSchema errore:", err);
            container.innerHTML =
                `<div class="etl-empty" style="color:var(--color-danger)">
                    Errore: ${_esc(err.message)}
                </div>`;
        }
    }

    function _renderSchema(schema, container) {
        let html = "";

        // Sezione Tool del progetto
        if (schema.tool_tables && schema.tool_tables.length > 0) {
            schema.tool_tables.forEach(table => {
                html += _renderSchemaGroup(
                    table.name,
                    table.label,
                    table.icon || "📄",
                    table.columns,
                    "tool-group",
                    true  // espanso di default
                );
            });
        }

        // Separatore visivo
        html += `<div style="height:1px;background:var(--color-border);margin:6px 10px"></div>`;

        // Sezione tabelle native
        if (schema.native_tables && schema.native_tables.length > 0) {
            schema.native_tables.forEach(table => {
                html += _renderSchemaGroup(
                    table.name,
                    table.label,
                    "🗃",
                    table.columns.map(c => ({
                        name:  c.name,
                        label: c.name,
                        type:  c.type
                    })),
                    "native",
                    false  // collassato di default
                );
            });
        }

        container.innerHTML = html || '<div class="etl-empty">Nessuna tabella disponibile.</div>';

        // Attacca listener per expand/collapse
        container.querySelectorAll(".schema-group-header").forEach(header => {
            header.addEventListener("click", () => {
                const groupId  = header.dataset.groupId;
                const colsEl   = document.getElementById(`schema-cols-${groupId}`);
                const arrowEl  = header.querySelector(".schema-group-arrow");
                const isOpen   = colsEl.classList.contains("open");

                colsEl.classList.toggle("open", !isOpen);
                arrowEl.classList.toggle("open", !isOpen);
            });
        });
    }

    function _renderSchemaGroup(name, label, icon, columns, cssClass, defaultOpen) {
        const groupId   = name.replace(/[^a-z0-9]/gi, "_");
        const arrowOpen = defaultOpen ? "open" : "";
        const colsOpen  = defaultOpen ? "open" : "";

        const isToolGroup = cssClass === "tool-group";
        const toolId      = isToolGroup ? name.replace("tool_", "") : null;

        const colsHtml = columns.map(col => {
            const sysTag = col.is_system
                ? `<span class="schema-col-system">sys</span>`
                : "";

            // Genera lo snippet da inserire in base al contesto
            let snippet, snippetTitle;
            if (isToolGroup) {
                // Colonna EAV — inserisce subquery completa con riferimento esplicito al tool
                snippet = `(SELECT tc.value FROM tool_cells tc JOIN tool_columns tcol ON tcol.id = tc.column_id WHERE tc.row_id = tr.id AND tcol.tool_id = ${toolId} AND tcol.slug = '${col.name}') AS ${col.name}`;
                snippetTitle = `Inserisce subquery per ${label}.${col.name}`;
            } else {
                // Tabella nativa — inserisce table.colonna
                snippet = `${name}.${col.name}`;
                snippetTitle = `Inserisce ${snippet}`;
            }

            return `
                <div class="schema-col-item"
                     data-snippet="${_escAttr(snippet)}"
                     onclick="EtlEditor.insertColumn(this.dataset.snippet)"
                     title="${_escAttr(snippetTitle)}">
                    <span class="schema-col-name">${_esc(col.label || col.name)}</span>
                    <span class="schema-col-type">${_esc(col.type || "")}</span>
                    ${sysTag}
                </div>`;
        }).join("");

        return `
            <div class="schema-group">
                <div class="schema-group-header ${cssClass}"
                     data-group-id="${groupId}">
                    <span class="schema-group-arrow ${arrowOpen}">▶</span>
                    <span class="schema-group-icon">${icon}</span>
                    <span class="schema-group-name">${_esc(label)}</span>
                    <span class="schema-group-badge">${columns.length}</span>
                </div>
                <div class="schema-columns ${colsOpen}" id="schema-cols-${groupId}">
                    ${colsHtml}
                </div>
            </div>`;
    }

    /**
     * Inserisce un testo (nome colonna o snippet SQL) nell'editor
     * alla posizione del cursore.
     */
    function insertColumn(text) {
        const editor = document.getElementById("etl-sql-input");
        if (!editor) return;

        const start   = editor.selectionStart;
        const end     = editor.selectionEnd;
        const content = editor.value;

        editor.value =
            content.substring(0, start) +
            text +
            content.substring(end);

        const newPos = start + text.length;
        editor.setSelectionRange(newPos, newPos);
        editor.focus();
    }


    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _currentSql      = "";
    let _history         = [];
    let _previewData     = null;
    let _schemaLoaded    = false;
    let _cachedTemplates = [];


    // --------------------------------------------------------
    // INIT — carica configurazione ETL salvata
    // --------------------------------------------------------

    async function init() {
        try {
            const config = await ApiClient.etlLoadConfig();
            _currentSql = config.etl_sql  || "";
            _history    = config.etl_history || [];

            const editor = document.getElementById("etl-sql-input");
            if (editor) editor.value = _currentSql;

            _renderHistory();
        } catch (err) {
            console.warn("ETL config non disponibile:", err.message);
        }

        // Carica schema browser — solo quando il tab ETL viene aperto
        // (non durante init per evitare problemi di timing)
        _schemaLoaded = false;

        // Shortcut Ctrl+Enter per preview
        document.addEventListener("keydown", e => {
            if (e.ctrlKey && e.key === "Enter") {
                const panel = document.getElementById("etl-panel");
                if (panel && panel.style.display !== "none") {
                    preview();
                }
            }
        });
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

            // Ricarica la griglia
            await GridManager.init();

            showToast(
                `ETL completato: ${result.created} righe create, ` +
                `${result.updated} aggiornate` +
                (result.columns_created > 0 ? `, ${result.columns_created} colonne aggiunte` : "") +
                ".",
                "success"
            );
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
        if (!sql) {
            showToast("Nessuna query da salvare.", "error");
            return;
        }

        const label = prompt(
            "Nome versione (opzionale):",
            `Versione ${_history.length + 1}`
        );
        if (label === null) return;

        try {
            const result = await ApiClient.etlSave(sql, label || null);
            _history     = result.history;
            _currentSql  = sql;
            _renderHistory();
            showToast("Versione salvata.", "success");
        } catch (err) {
            showToast("Errore salvataggio: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // RENDERING PREVIEW
    // --------------------------------------------------------

    function _renderPreview(data) {
        const container = document.getElementById("etl-preview-container");
        if (!container) return;

        // Warnings
        let warningsHtml = "";
        if (data.warnings && data.warnings.length > 0) {
            warningsHtml = `
                <div class="etl-warnings">
                    ${data.warnings.map(w =>
                        `<div class="etl-warning">⚠ ${_esc(w)}</div>`
                    ).join("")}
                </div>`;
        }

        // Nessun risultato
        if (!data.rows || data.rows.length === 0) {
            container.innerHTML = warningsHtml +
                '<div class="etl-empty">Query eseguita — nessun risultato.</div>';
            return;
        }

        // Tabella risultati (max 50 righe in preview)
        const previewRows = data.rows.slice(0, 50);
        const headers     = data.columns
            .map(c => `<th>${_esc(c)}</th>`).join("");
        const rows        = previewRows
            .map(row => {
                const cells = data.columns
                    .map(c => `<td>${_esc(String(row[c] ?? ""))}</td>`)
                    .join("");
                return `<tr>${cells}</tr>`;
            }).join("");

        const truncNote = data.rows.length > 50
            ? `<div class="etl-note">
                   Mostrate 50 di ${data.rows.length} righe.
                   Apply elaborerà tutte le righe.
               </div>`
            : "";

        container.innerHTML = `
            ${warningsHtml}
            <div class="etl-preview-info">
                ${data.row_count} righe restituite dalla query
            </div>
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
                   ${result.errors.map(e =>
                       `<div class="etl-warning">⚠ ${_esc(e)}</div>`
                   ).join("")}
               </div>`
            : "";

        container.innerHTML = `
            ${errorsHtml}
            <div class="etl-apply-result">
                ${ result.columns_created > 0 ? `
                <div class="etl-result-item etl-result-updated">
                    + ${result.columns_created} colonne create automaticamente
                </div>` : "" }
                <div class="etl-result-item etl-result-created">
                    ✓ ${result.created} righe create
                </div>
                <div class="etl-result-item etl-result-updated">
                    ↺ ${result.updated} righe aggiornate
                </div>
                <div class="etl-result-item etl-result-skipped">
                    ⊘ ${result.skipped_cells} celle preservate
                    (modificate manualmente)
                </div>
            </div>`;
    }

    function _showPreviewMessage(message, type = "info") {
        const container = document.getElementById("etl-preview-container");
        if (!container) return;
        const colors = {
            info:    "var(--color-text-muted)",
            error:   "var(--color-danger)",
            warning: "var(--color-warning)",
            success: "var(--color-success)"
        };
        container.innerHTML = `
            <div style="color:${colors[type]};padding:12px 0;font-size:13px">
                ${_esc(message)}
            </div>`;
    }


    // --------------------------------------------------------
    // RENDERING STORICO
    // --------------------------------------------------------

    function _renderHistory() {
        const container = document.getElementById("etl-history-list");
        if (!container) return;

        if (_history.length === 0) {
            container.innerHTML =
                '<div class="etl-empty">Nessuna versione salvata.</div>';
            return;
        }

        container.innerHTML = _history.map((v, i) => `
            <div class="etl-history-item" onclick="EtlEditor.loadVersion(${i})">
                <div class="etl-history-label">${_esc(v.label)}</div>
                <div class="etl-history-ts">
                    ${_formatTs(v.timestamp)}
                </div>
            </div>
        `).join("");
    }

    function loadVersion(index) {
        const version = _history[index];
        if (!version) return;

        const editor = document.getElementById("etl-sql-input");
        if (editor) {
            editor.value = version.sql;
            _previewData = null;
            document.getElementById("etl-preview-container").innerHTML = "";
        }

        showToast(`Versione '${version.label}' caricata.`, "info");
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _getSql() {
        const editor = document.getElementById("etl-sql-input");
        return editor ? editor.value.trim() : "";
    }

    function _formatTs(isoString) {
        try {
            const d = new Date(isoString);
            return d.toLocaleString("it-IT", {
                day:    "2-digit",
                month:  "2-digit",
                year:   "numeric",
                hour:   "2-digit",
                minute: "2-digit"
            });
        } catch {
            return isoString;
        }
    }

    function _esc(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function _escAttr(str) {
        return String(str)
            .replace(/'/g, "\\'")
            .replace(/"/g, "&quot;");
    }


    // --------------------------------------------------------
    // SALVA COME TEMPLATE
    // --------------------------------------------------------

    async function saveAsTemplate() {
        const sql = _getSql();
        if (!sql) {
            showToast("Nessuna query da salvare come template.", "error");
            return;
        }

        const typeSlug = ToolbarManager.getToolType();
        if (!typeSlug) {
            showToast("Questo tool non ha un tipo definito — aggiorna le impostazioni.", "warning");
            return;
        }

        const name = prompt("Nome del template:", "");
        if (name === null) return;
        if (!name.trim()) {
            showToast("Il nome del template non può essere vuoto.", "error");
            return;
        }

        try {
            await ApiClient.saveTemplate({
                type_slug: typeSlug,
                name: name.trim(),
                etl_sql: sql
            });
            showToast("Template salvato.", "success");
            await refreshTemplates();
        } catch (err) {
            showToast("Errore salvataggio template: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // PANNELLO TEMPLATES
    // --------------------------------------------------------

    async function refreshTemplates() {
        const container = document.getElementById("etl-templates-list");
        if (!container) return;

        const typeSlug = ToolbarManager.getToolType();
        if (!typeSlug) {
            container.innerHTML = '<div class="etl-empty">Tipo tool non definito.</div>';
            return;
        }

        try {
            _cachedTemplates = await fetch(
                `/api/tools/templates?type_slug=${encodeURIComponent(typeSlug)}`
            ).then(r => r.json());

            _renderTemplatesList(container);
        } catch (err) {
            container.innerHTML =
                `<div class="etl-empty" style="color:var(--color-danger)">Errore: ${_esc(err.message)}</div>`;
        }
    }

    function _renderTemplatesList(container) {
        if (!_cachedTemplates || _cachedTemplates.length === 0) {
            container.innerHTML = '<div class="etl-empty">Nessun template salvato.</div>';
            return;
        }

        container.innerHTML = _cachedTemplates.map(t => `
            <div class="etl-history-item">
                <div class="etl-history-label" title="${_escAttr(t.name)}">${_esc(t.name)}</div>
                <div class="etl-history-actions">
                    <button class="etl-history-btn" onclick="EtlEditor.loadTemplate(${t.id})"
                            title="Carica nel editor">↩</button>
                    <button class="etl-history-btn etl-history-btn-danger"
                            onclick="EtlEditor.deleteTemplate(${t.id})"
                            title="Elimina template">✕</button>
                </div>
            </div>
        `).join("");
    }

    async function loadTemplate(templateId) {
        const template = _cachedTemplates.find(t => t.id === templateId);
        if (!template) return;

        const currentSql = _getSql();
        if (currentSql && currentSql.trim() !== template.etl_sql.trim()) {
            if (!confirm(`Sostituire la query corrente con il template "${template.name}"?`)) {
                return;
            }
        }

        const editor = document.getElementById("etl-sql-input");
        if (editor) {
            editor.value = template.etl_sql;
            _currentSql  = template.etl_sql;
        }

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
            showToast("Errore eliminazione: " + err.message, "error");
        }
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        preview,
        apply,
        saveVersion,
        saveAsTemplate,
        loadVersion,
        refreshSchema,
        refreshTemplates,
        loadTemplate,
        deleteTemplate,
        insertColumn,
        get _schemaLoaded() { return _schemaLoaded; }
    };

})();