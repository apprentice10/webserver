/**
 * grid.js
 * --------
 * Gestisce rendering, editing inline e ricerca della griglia.
 *
 * Responsabilità:
 * - Renderizza le righe dal backend
 * - Gestisce editing inline cella per cella
 * - Salva le modifiche via ApiClient al blur della cella
 * - Gestisce ricerca/filtro locale
 * - Mostra/nasconde colonna LOG
 */

const GridManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _rows = [];           // Dati correnti (array di oggetti)
    let _filteredRows = [];   // Righe filtrate dalla ricerca
    let _showLog = false;     // Colonna LOG visibile?

    // Colonne editabili con il loro field name nel DB
    const COLUMNS = [
        { field: "rev",      label: "REV"      },
        { field: "fase",     label: "FASE"     },
        { field: "pid",      label: "P&ID"     },
        { field: "tag",      label: "TAG"      },
        { field: "servizio", label: "SERVIZIO" },
        { field: "tipo",     label: "TIPO"     },
        { field: "standard", label: "STANDARD" },
        { field: "classe",   label: "CLASSE"   },
        { field: "attacco",  label: "ATTACCO"  },
        { field: "range",    label: "RANGE"    },
        { field: "note",     label: "NOTE"     },
    ];


    // --------------------------------------------------------
    // INIT — carica dati e renderizza
    // --------------------------------------------------------

    async function init() {
        try {
            _rows = await ApiClient.loadRows();
            _filteredRows = [..._rows];
            render();
        } catch (err) {
            _showError(err.message);
        }
    }


    // --------------------------------------------------------
    // RENDERING
    // --------------------------------------------------------

    function render() {
        const tbody = document.getElementById("grid-body");

        if (_filteredRows.length === 0) {
            tbody.innerHTML = `
                <tr class="grid-empty">
                    <td colspan="13">Nessuno strumento trovato. Usa "+ Riga" per aggiungerne uno.</td>
                </tr>`;
            return;
        }

        tbody.innerHTML = _filteredRows.map(row => _renderRow(row)).join("");
        _attachCellListeners();
    }

    /**
     * Renderizza una singola riga <tr> come stringa HTML.
     */
    function _renderRow(row) {
        const logDisplay = _showLog ? "" : "display:none";

        const cells = COLUMNS.map(col => {
            const value = row[col.field] ?? "";
            const isTag = col.field === "tag";
            const tagClass = isTag ? "cell-tag" : "";

            return `
                <td class="col-${col.field}">
                    <input
                        type="text"
                        class="cell-input ${tagClass}"
                        data-row-id="${row.id}"
                        data-field="${col.field}"
                        value="${_escapeAttr(value)}"
                        ${col.field === "rev" ? 'readonly tabindex="-1"' : ""}
                    >
                </td>`;
        }).join("");

        const logCell = `
            <td class="col-log" style="${logDisplay}">
                <div class="cell-log" onclick="GridManager.showRowLog(${row.id})">
                    ${_formatLogPreview(row.row_log)}
                </div>
            </td>`;

        return `
            <tr data-row-id="${row.id}">
                <td class="col-actions">
                    <div class="cell-actions">
                        <button
                            class="btn-delete-row"
                            onclick="GridManager.deleteRow(${row.id})"
                            title="Elimina riga"
                        >✕</button>
                    </div>
                </td>
                ${cells}
                ${logCell}
            </tr>`;
    }

    /**
     * Mostra solo la prima riga del log nella cella.
     */
    function _formatLogPreview(rowLog) {
        if (!rowLog) return '<span style="opacity:0.3">—</span>';
        const firstLine = rowLog.split("\n")[0];
        return _escapeHtml(firstLine);
    }


    // --------------------------------------------------------
    // EVENT LISTENERS CELLE
    // --------------------------------------------------------

    function _attachCellListeners() {
        const inputs = document.querySelectorAll(".cell-input:not([readonly])");

        inputs.forEach(input => {
            // Salva il valore originale quando la cella riceve focus
            input.addEventListener("focus", function () {
                this.dataset.originalValue = this.value;
            });

            // Al blur: salva solo se il valore è cambiato
            input.addEventListener("blur", async function () {
                const newValue = this.value.trim();
                const originalValue = this.dataset.originalValue ?? "";

                if (newValue === originalValue) return;

                const rowId = parseInt(this.dataset.rowId);
                const field = this.dataset.field;

                await _saveCell(this, rowId, field, newValue);
            });

            // Invio = blur (conferma modifica), Escape = annulla
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.blur();
                }
                if (e.key === "Escape") {
                    this.value = this.dataset.originalValue ?? "";
                    this.blur();
                }
            });
        });
    }

    /**
     * Salva una singola cella modificata via API.
     * Gestisce errori visivamente senza perdere il dato originale.
     */
    async function _saveCell(inputEl, rowId, field, newValue) {
        // Feedback visivo — salvataggio in corso
        inputEl.style.opacity = "0.5";

        try {
            const updatedRow = await ApiClient.updateRow(rowId, { [field]: newValue });

            // Aggiorna il dato locale
            const idx = _rows.findIndex(r => r.id === rowId);
            if (idx !== -1) _rows[idx] = updatedRow;

            const fidx = _filteredRows.findIndex(r => r.id === rowId);
            if (fidx !== -1) _filteredRows[fidx] = updatedRow;

            // Aggiorna la cella LOG nella stessa riga
            _updateLogCell(rowId, updatedRow.row_log);

            inputEl.style.opacity = "1";
            inputEl.dataset.originalValue = newValue;

        } catch (err) {
            // Ripristina il valore originale e mostra errore
            inputEl.value = inputEl.dataset.originalValue ?? "";
            inputEl.style.opacity = "1";
            inputEl.style.outline = "2px solid var(--color-danger)";

            setTimeout(() => {
                inputEl.style.outline = "";
            }, 2000);

            _showToast(err.message, "error");
        }
    }

    /**
     * Aggiorna visivamente la cella LOG di una riga
     * senza re-renderizzare l'intera griglia.
     */
    function _updateLogCell(rowId, rowLog) {
        const row = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (!row) return;

        const logCell = row.querySelector(".cell-log");
        if (logCell) {
            logCell.innerHTML = _formatLogPreview(rowLog);
        }
    }


    // --------------------------------------------------------
    // AGGIUNTA RIGA
    // --------------------------------------------------------

    /**
     * Aggiunge una riga vuota chiedendo il TAG all'utente.
     * Chiamata da ToolbarManager.addRow().
     */
    async function addRow(tag) {
        try {
            const newRow = await ApiClient.createRow({ tag });
            _rows.unshift(newRow);
            _filteredRows = [..._rows];
            render();

            // Focus sulla prima cella editabile della nuova riga
            const firstInput = document.querySelector(
                `tr[data-row-id="${newRow.id}"] .cell-input:not([readonly])`
            );
            if (firstInput) firstInput.focus();

        } catch (err) {
            _showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // ELIMINAZIONE RIGA
    // --------------------------------------------------------

    async function deleteRow(rowId) {
        if (!confirm("Eliminare questo strumento? L'operazione è irreversibile.")) return;

        try {
            await ApiClient.deleteRow(rowId);
            _rows = _rows.filter(r => r.id !== rowId);
            _filteredRows = _filteredRows.filter(r => r.id !== rowId);
            render();
        } catch (err) {
            _showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // RICERCA
    // --------------------------------------------------------

    /**
     * Filtra le righe in base al testo cercato.
     * Cerca in tutti i campi testuali.
     */
    function search(query) {
        const q = query.toLowerCase().trim();

        if (!q) {
            _filteredRows = [..._rows];
        } else {
            _filteredRows = _rows.filter(row =>
                COLUMNS.some(col => {
                    const val = (row[col.field] ?? "").toLowerCase();
                    return val.includes(q);
                })
            );
        }

        render();
    }


    // --------------------------------------------------------
    // LOG
    // --------------------------------------------------------

    function toggleLog() {
        _showLog = !_showLog;

        // Mostra/nasconde header colonna LOG
        document.getElementById("col-log-header").style.display =
            _showLog ? "" : "none";

        // Mostra/nasconde celle LOG
        document.querySelectorAll(".col-log").forEach(el => {
            el.style.display = _showLog ? "" : "none";
        });
    }

    /**
     * Apre il modal con il log completo di una riga.
     */
    function showRowLog(rowId) {
        const row = _rows.find(r => r.id === rowId);
        if (!row) return;

        document.getElementById("modal-log-tag").textContent = row.tag;

        const content = document.getElementById("modal-log-content");

        if (!row.row_log) {
            content.innerHTML = '<div class="log-empty">Nessuna modifica registrata per questo strumento.</div>';
        } else {
            const entries = row.row_log.split("\n").filter(Boolean);
            content.innerHTML = entries
                .map(e => `<div class="log-entry">${_escapeHtml(e)}</div>`)
                .join("");
        }

        openModal("modal-row-log");
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function _escapeAttr(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function _showError(message) {
        const tbody = document.getElementById("grid-body");
        tbody.innerHTML = `
            <tr class="grid-empty">
                <td colspan="13" style="color:var(--color-danger)">
                    Errore: ${_escapeHtml(message)}
                </td>
            </tr>`;
    }

    function _showToast(message, type = "info") {
        // Toast minimale — verrà sostituito con un sistema toast dedicato
        const colors = {
            error: "var(--color-danger)",
            success: "var(--color-success)",
            info: "var(--color-text-muted)"
        };

        const toast = document.createElement("div");
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: var(--color-surface);
            border: 1px solid ${colors[type]};
            color: ${colors[type]};
            padding: 10px 18px;
            border-radius: var(--radius);
            font-size: 13px;
            z-index: 999;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            animation: modal-in 0.18s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3500);
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        render,
        addRow,
        deleteRow,
        search,
        toggleLog,
        showRowLog
    };

})();