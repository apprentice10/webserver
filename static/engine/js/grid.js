/**
 * grid.js — Engine
 * -----------------
 * Rendering e interazione della griglia universale.
 *
 * Responsabilità:
 * - Carica e renderizza righe + colonne
 * - Ghost row (riga vuota finale per inserimento rapido)
 * - Editing inline con salvataggio al blur
 * - Navigazione tastiera tipo spreadsheet
 * - Soft delete / restore visivo
 * - Ricerca/filtro locale
 * - Toggle colonna LOG
 * - Toggle righe eliminate
 */

const GridManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _rows         = [];     // Tutte le righe (incluse deleted)
    let _filteredRows = [];     // Righe dopo filtro ricerca
    let _showDeleted  = false;  // Mostra righe eliminate?
    let _showLog      = false;  // Mostra colonna LOG?
    let _searchQuery  = "";     // Query ricerca corrente


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    async function init() {
        try {
            await ColumnsManager.loadColumns();
            ColumnsManager.renderHeader();

            _rows = await ApiClient.loadRows(true); // Carica tutto inclusi deleted
            _applyFilters();
            render();

            PasteManager.init();
        } catch (err) {
            _showError(err.message);
        }
    }


    // --------------------------------------------------------
    // RENDERING
    // --------------------------------------------------------

    function render() {
        const tbody   = document.getElementById("grid-body");
        const columns = ColumnsManager.getColumns();

        let html = "";

        if (_filteredRows.length === 0 && _rows.filter(r => !r.is_deleted).length === 0) {
            html = `<tr class="grid-empty">
                        <td colspan="${columns.length + 1}">
                            Nessuna riga. Inizia a digitare nella riga vuota qui sotto.
                        </td>
                    </tr>`;
        } else {
            html = _filteredRows.map(row => _renderRow(row, columns)).join("");
        }

        // Ghost row sempre in fondo
        html += _renderGhostRow(columns);

        tbody.innerHTML = html;
        _attachListeners();
    }

    /**
     * Renderizza una riga dati.
     */
    function _renderRow(row, columns) {
        const isDeleted = row.is_deleted;
        const rowClass  = isDeleted ? "row-deleted" : "";

        const actionBtn = isDeleted
            ? `<button class="btn-row-action btn-row-restore"
                   onclick="GridManager.restoreRow(${row.id})"
                   title="Ripristina">↩</button>
               <button class="btn-row-action btn-row-hard-delete"
                   onclick="GridManager.hardDeleteRow(${row.id})"
                   title="Elimina definitivamente">🗑</button>`
            : `<button class="btn-row-action btn-row-delete"
                   onclick="GridManager.softDeleteRow(${row.id})"
                   title="Elimina">✕</button>`;

        const cells = columns.map(col => _renderCell(row, col, isDeleted)).join("");

        return `
            <tr data-row-id="${row.id}" class="${rowClass}">
                <td class="col-actions">
                    <div class="cell-actions">${actionBtn}</div>
                </td>
                ${cells}
            </tr>`;
    }

    /**
     * Renderizza una singola cella.
     */
    function _renderCell(row, col, isDeleted) {
        const value   = row[col.slug] ?? "";
        const isLog   = col.slug === "log";
        const isRev   = col.slug === "rev";
        const isTag   = col.slug === "tag";
        const logDisplay = (_showLog || isLog) ? "" : "display:none";

        if (isLog) {
            return `
                <td style="width:${col.width}px;${logDisplay}">
                    <div class="cell-log-preview"
                         onclick="GridManager.showRowLog(${row.id})">
                        ${_formatLogPreview(row.row_log)}
                    </div>
                </td>`;
        }

        const readonly  = isRev || isDeleted ? "readonly tabindex='-1'" : "";
        const cellClass = isTag ? "cell-input cell-tag" : "cell-input";

        return `
            <td style="width:${col.width}px">
                <input
                    type="text"
                    class="${cellClass}"
                    data-row-id="${row.id}"
                    data-field="${col.slug}"
                    value="${_escAttr(value)}"
                    ${readonly}
                >
            </td>`;
    }

    /**
     * Renderizza la ghost row — riga vuota in fondo per
     * inserimento rapido senza pulsanti.
     */
    function _renderGhostRow(columns) {
        const cells = columns.map(col => {
            if (col.slug === "log" || col.slug === "rev") {
                return `<td style="width:${col.width}px"></td>`;
            }
            const isTag = col.slug === "tag";
            return `
                <td style="width:${col.width}px">
                    <input
                        type="text"
                        class="${isTag ? "cell-input cell-tag" : "cell-input"}"
                        data-ghost="true"
                        data-field="${col.slug}"
                        placeholder="${isTag ? "Nuovo TAG..." : ""}"
                    >
                </td>`;
        }).join("");

        return `
            <tr class="row-ghost" id="ghost-row">
                <td class="col-actions"></td>
                ${cells}
            </tr>`;
    }

    function _formatLogPreview(rowLog) {
        if (!rowLog) return '<span style="opacity:0.3">—</span>';
        const first = rowLog.split("\n")[0];
        return _escHtml(first);
    }


    // --------------------------------------------------------
    // EVENT LISTENERS
    // --------------------------------------------------------

    function _attachListeners() {
        // Celle normali
        document.querySelectorAll(".cell-input:not([readonly]):not([data-ghost])").forEach(input => {
            input.addEventListener("focus",   _onCellFocus);
            input.addEventListener("blur",    _onCellBlur);
            input.addEventListener("keydown", _onCellKeydown);
        });

        // Ghost row — TAG obbligatorio per creare riga
        const ghostTag = document.querySelector("[data-ghost][data-field='tag']");
        if (ghostTag) {
            ghostTag.addEventListener("keydown", _onGhostKeydown);
            ghostTag.addEventListener("blur",    _onGhostBlur);
        }

        // Altre celle ghost — navigazione
        document.querySelectorAll("[data-ghost]:not([data-field='tag'])").forEach(input => {
            input.addEventListener("keydown", _onCellKeydown);
        });
    }

    function _onCellFocus() {
        this.dataset.originalValue = this.value;
        this.closest("tr")?.classList.add("selected");
    }

    async function _onCellBlur() {
        this.closest("tr")?.classList.remove("selected");
        const newVal  = this.value.trim();
        const origVal = this.dataset.originalValue ?? "";
        if (newVal === origVal) return;

        const rowId = parseInt(this.dataset.rowId);
        const field = this.dataset.field;
        await _saveCell(this, rowId, field, newVal);
    }

    function _onCellKeydown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            _moveFocus(this, 0, 1);  // Vai alla riga sotto
        }
        if (e.key === "Escape") {
            this.value = this.dataset.originalValue ?? "";
            this.blur();
        }
        if (e.key === "Tab") {
            e.preventDefault();
            _moveFocus(this, e.shiftKey ? -1 : 1, 0);  // Vai alla cella destra/sinistra
        }
        if (e.key === "ArrowUp")    { e.preventDefault(); _moveFocus(this, 0, -1); }
        if (e.key === "ArrowDown")  { e.preventDefault(); _moveFocus(this, 0,  1); }
        if (e.key === "ArrowLeft" && this.selectionStart === 0) {
            e.preventDefault(); _moveFocus(this, -1, 0);
        }
        if (e.key === "ArrowRight" && this.selectionStart === this.value.length) {
            e.preventDefault(); _moveFocus(this, 1, 0);
        }
    }

    async function _onGhostKeydown(e) {
        if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const tag = this.value.trim().toUpperCase();
            if (!tag) return;
            await _createFromGhost(tag);
        }
        if (e.key === "Escape") {
            this.value = "";
        }
    }

    async function _onGhostBlur() {
        const tag = this.value.trim().toUpperCase();
        if (!tag) return;
        await _createFromGhost(tag);
    }


    // --------------------------------------------------------
    // NAVIGAZIONE TASTIERA
    // --------------------------------------------------------

    /**
     * Sposta il focus a una cella adiacente.
     * dCol: -1 = sinistra, +1 = destra
     * dRow: -1 = su, +1 = giù
     */
    function _moveFocus(currentInput, dCol, dRow) {
        const allInputs = Array.from(
            document.querySelectorAll(".cell-input:not([readonly])")
        );
        const idx = allInputs.indexOf(currentInput);
        if (idx === -1) return;

        // Calcola posizione nella griglia
        const columns = ColumnsManager.getColumns()
            .filter(c => c.slug !== "log" && c.slug !== "rev");
        const colCount = columns.length;

        const newIdx = idx + dCol + dRow * colCount;
        if (newIdx >= 0 && newIdx < allInputs.length) {
            allInputs[newIdx].focus();
            allInputs[newIdx].select();
        }
    }


    // --------------------------------------------------------
    // GHOST ROW — creazione riga rapida
    // --------------------------------------------------------

    async function _createFromGhost(tag) {
        try {
            const newRow = await ApiClient.createRow({ tag });

            // Appende in fondo — non in cima
            _rows.push(newRow);
            _applyFilters();
            render();

            // Focus sulla nuova riga — seconda cella editabile
            setTimeout(() => {
                const newRowEl = document.querySelector(
                    `tr[data-row-id="${newRow.id}"]`
                );
                if (newRowEl) {
                    const inputs = newRowEl.querySelectorAll(
                        ".cell-input:not([readonly])"
                    );
                    if (inputs[1]) {
                        inputs[1].focus();
                    } else if (inputs[0]) {
                        inputs[0].focus();
                    }
                }
            }, 50);

        } catch (err) {
            showToast(err.message, "error");
            const ghostTag = document.querySelector(
                "[data-ghost][data-field='tag']"
            );
            if (ghostTag) ghostTag.value = "";
        }
    }

    // --------------------------------------------------------
    // SALVATAGGIO CELLA
    // --------------------------------------------------------

    async function _saveCell(inputEl, rowId, field, newValue) {
        inputEl.style.opacity = "0.5";

        try {
            const updatedRow = await ApiClient.updateCell(rowId, field, newValue);

            // Aggiorna dati locali
            const idx = _rows.findIndex(r => r.id === rowId);
            if (idx !== -1) _rows[idx] = updatedRow;

            const fidx = _filteredRows.findIndex(r => r.id === rowId);
            if (fidx !== -1) _filteredRows[fidx] = updatedRow;

            // Aggiorna solo la cella LOG senza re-render
            _updateLogCell(rowId, updatedRow.row_log);

            inputEl.style.opacity = "1";
            inputEl.dataset.originalValue = newValue;

        } catch (err) {
            inputEl.value = inputEl.dataset.originalValue ?? "";
            inputEl.style.opacity = "1";
            inputEl.style.outline = "2px solid var(--color-danger)";
            setTimeout(() => inputEl.style.outline = "", 2000);
            showToast(err.message, "error");
        }
    }

    function _updateLogCell(rowId, rowLog) {
        const rowEl = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (!rowEl) return;
        const logCell = rowEl.querySelector(".cell-log-preview");
        if (logCell) logCell.innerHTML = _formatLogPreview(rowLog);
    }


    // --------------------------------------------------------
    // SOFT DELETE / RESTORE
    // --------------------------------------------------------

    async function softDeleteRow(rowId) {
        if (!confirm("Eliminare questa riga? Potrà essere ripristinata.")) return;

        try {
            const updated = await ApiClient.softDeleteRow(rowId);
            const idx = _rows.findIndex(r => r.id === rowId);
            if (idx !== -1) _rows[idx] = updated;
            _applyFilters();
            render();
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    async function restoreRow(rowId) {
        try {
            const updated = await ApiClient.restoreRow(rowId);
            const idx = _rows.findIndex(r => r.id === rowId);
            if (idx !== -1) _rows[idx] = updated;
            _applyFilters();
            render();
            showToast("Riga ripristinata.", "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }


    // --------------------------------------------------------
    // TOGGLE ELIMINATI
    // --------------------------------------------------------

    function toggleDeleted() {
        _showDeleted = !_showDeleted;
        const btn = document.getElementById("btn-show-deleted");
        if (btn) {
            btn.textContent = _showDeleted ? "Nascondi eliminati" : "Mostra eliminati";
            btn.classList.toggle("active", _showDeleted);
        }
        _applyFilters();
        render();
    }


    // --------------------------------------------------------
    // TOGGLE LOG
    // --------------------------------------------------------

    function toggleLog() {
        _showLog = !_showLog;
        render();
    }


    // --------------------------------------------------------
    // RICERCA
    // --------------------------------------------------------

    function search(query) {
        _searchQuery = query.toLowerCase().trim();
        _applyFilters();
        render();
    }


    // --------------------------------------------------------
    // FILTRI
    // --------------------------------------------------------

    function _applyFilters() {
        let rows = [..._rows];

        // Filtro eliminati
        if (!_showDeleted) {
            rows = rows.filter(r => !r.is_deleted);
        }

        // Filtro ricerca
        if (_searchQuery) {
            const columns = ColumnsManager.getColumns();
            rows = rows.filter(row =>
                columns.some(col => {
                    const val = String(row[col.slug] ?? "").toLowerCase();
                    return val.includes(_searchQuery);
                })
            );
        }

        _filteredRows = rows;
    }


    // --------------------------------------------------------
    // APPEND ROWS — usato da PasteManager
    // --------------------------------------------------------

    function appendRows(newRows) {
        _rows = [...newRows, ..._rows];
        _applyFilters();
        render();
    }


    // --------------------------------------------------------
    // SHOW ROW LOG
    // --------------------------------------------------------

    function showRowLog(rowId) {
        const row = _rows.find(r => r.id === rowId);
        if (!row) return;

        document.getElementById("modal-log-tag").textContent =
            row.tag || `Riga #${rowId}`;

        const content = document.getElementById("modal-log-content");

        if (!row.row_log) {
            content.innerHTML = '<div class="log-empty">Nessuna modifica registrata.</div>';
        } else {
            const entries = row.row_log.split("\n").filter(Boolean);
            content.innerHTML = entries.map(e => {
                const isRemoved  = e.includes("REMOVED");
                const isRestored = e.includes("RESTORED");
                const cls = isRemoved  ? "log-entry log-removed"
                          : isRestored ? "log-entry log-restored"
                          : "log-entry";
                return `<div class="${cls}">${_escHtml(e)}</div>`;
            }).join("");
        }

        openModal("modal-row-log");
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _showError(message) {
        const tbody   = document.getElementById("grid-body");
        const columns = ColumnsManager.getColumns();
        tbody.innerHTML = `
            <tr class="grid-empty">
                <td colspan="${columns.length + 1}"
                    style="color:var(--color-danger)">
                    Errore: ${_escHtml(message)}
                </td>
            </tr>`;
    }

    function _escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function _escAttr(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /**
     * Aggiorna i dati di una riga nel array locale
     * senza re-renderizzare tutta la griglia.
     * Chiamata da PasteManager dopo ogni updateCell.
     */
    function updateRowData(rowId, updatedRow) {
        const idx = _rows.findIndex(r => r.id === rowId);
        if (idx !== -1) _rows[idx] = updatedRow;

        const fidx = _filteredRows.findIndex(r => r.id === rowId);
        if (fidx !== -1) _filteredRows[fidx] = updatedRow;
    }

    /**
     * Restituisce una riga per id dall'array locale.
     * Chiamata da PasteManager per costruire _getVisibleRows.
     */
    function getRowById(rowId) {
        return _rows.find(r => r.id === rowId) || null;
    }

    async function hardDeleteRow(rowId) {
        if (!confirm(
            "Eliminare DEFINITIVAMENTE questa riga?\n" +
            "Questa operazione è irreversibile e non può essere annullata."
        )) return;

        try {
            await ApiClient.hardDeleteRow(rowId);
            _rows = _rows.filter(r => r.id !== rowId);
            _filteredRows = _filteredRows.filter(r => r.id !== rowId);
            render();
            showToast("Riga eliminata definitivamente.", "success");
        } catch (err) {
            showToast(err.message, "error");
        }
    }

    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        render,
        appendRows,
        updateRowData,
        getRowById,
        softDeleteRow,
        restoreRow,
        hardDeleteRow,
        toggleDeleted,
        toggleLog,
        search,
        showRowLog
    };

})();


// ============================================================
// TOAST — funzione globale usata da tutti i moduli
// ============================================================

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}