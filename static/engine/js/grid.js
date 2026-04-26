/**
 * grid.js — Engine
 * -----------------
 * Rendering e interazione della griglia universale.
 *
 * SECTION MAP (for targeted reading):
 *   ~L17  : stato interno (_rows, _filteredRows, _ctxRowId …)
 *   ~L34  : init()
 *   ~L52  : rendering  (render, _renderRow, _renderCell, _renderGhostRow)
 *   ~L182 : event listeners  (_attachListeners, onCellFocus/Blur/Keydown)
 *   ~L261 : keyboard nav + ghost row  (_moveFocus, _createFromGhost)
 *   ~L331 : cell save  (_saveCell, _updateLogCell)
 *   ~L373 : soft-delete / restore / hard-delete
 *   ~L403 : toggleDeleted / toggleLog (CSS .log-hidden, no re-render) / context menu
 *   ~L480 : search / filters / appendRows / showRowLog
 *   ~L580 : public API
 */

const GridManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _rows         = [];     // Tutte le righe (incluse deleted)
    let _filteredRows = [];     // Righe dopo filtro ricerca
    let _showDeleted  = false;  // Mostra righe eliminate?
    let _searchQuery  = "";     // Query ricerca corrente
    let _ctxRowId     = null;   // Row ID del context menu aperto
    let _ctxColSlug   = null;   // Col slug della cella su cui è stato aperto il context menu
    let _editingInput = null;   // Input correntemente in edit mode (non readonly)


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
            _initContextMenu();
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
            html = _filteredRows.map((row, i) => _renderRow(row, columns, i)).join("");
        }

        // Ghost row sempre in fondo
        html += _renderGhostRow(columns);

        tbody.innerHTML = html;
        _attachListeners();
    }

    /**
     * Renderizza una riga dati.
     */
    function _renderRow(row, columns, rowIndex) {
        const isDeleted = row.is_deleted;
        const rowClass  = isDeleted ? "row-deleted" : "";
        const cells     = columns.map(col => _renderCell(row, col, isDeleted)).join("");

        return `
            <tr data-row-id="${row.id}"
                class="${rowClass}"
                oncontextmenu="GridManager.openContextMenu(event, ${row.id})">
                <td class="row-num">${rowIndex + 1}</td>
                ${cells}
            </tr>`;
    }

    /**
     * Renderizza una singola cella.
     */
    function _renderCell(row, col, isDeleted) {
        const value  = row[col.slug] ?? "";
        const isLog  = col.slug === "log";
        const isRev  = col.slug === "rev";
        const isTag  = col.slug === "tag";

        if (isLog) {
            return `
                <td data-slug="log" style="width:${col.width}px">
                    <div class="cell-log-preview"
                         onclick="GridManager.showRowLog(${row.id})">
                        ${_formatLogPreview(row.row_log)}
                    </div>
                </td>`;
        }

        const readonly  = (isRev || isDeleted)
            ? "readonly tabindex='-1'"
            : "readonly data-editable='true'";
        const cellClass = isTag ? "cell-input cell-tag" : "cell-input";
        const isOverridden = row.overridden_cols != null && col.slug in row.overridden_cols;
        const etlValue = isOverridden ? row.overridden_cols[col.slug] : null;
        const overriddenAttr = isOverridden
            ? ` data-overridden="true" title="Valore ETL: ${Utils.escAttr(etlValue ?? "")}"`
            : "";

        return `
            <td style="width:${col.width}px"${overriddenAttr}>
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
                return `<td data-slug="${col.slug}" style="width:${col.width}px"></td>`;
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
                <td class="row-num"></td>
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
        // Celle editabili (select mode di default, edit mode su dblclick)
        document.querySelectorAll(".cell-input[data-editable]").forEach(input => {
            input.addEventListener("focus",   _onCellFocus);
            input.addEventListener("blur",    _onCellBlur);
            input.addEventListener("keydown", _onCellKeydown);
            input.addEventListener("dblclick", _onCellDblClick);
            input.addEventListener("paste",   _onCellPaste);
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

        // Torna in select mode (readonly) dopo ogni blur
        if (this.hasAttribute("data-editable")) {
            this.setAttribute("readonly", "");
            if (_editingInput === this) _editingInput = null;
        }

        if (newVal === origVal) return;
        const rowId = parseInt(this.dataset.rowId);
        const field = this.dataset.field;
        await _saveCell(this, rowId, field, newVal);
    }

    function _onCellDblClick() {
        _enterEditMode(this);
    }

    function _enterEditMode(input) {
        if (_editingInput === input) return;
        if (_editingInput) _editingInput.blur();
        _editingInput = input;
        input.removeAttribute("readonly");
        input.focus();
        input.select();
    }

    // Paste su cella in select mode: entra in edit mode e applica il valore
    function _onCellPaste(e) {
        if (!this.hasAttribute("readonly")) return;
        const text = (e.clipboardData?.getData("text/plain") ?? "").trim();
        const isMultiCell = text.includes("\n") || text.includes("\t");
        if (isMultiCell) return; // paste.js gestisce multi-cella
        e.preventDefault();
        _enterEditMode(this);
        this.value = text;
    }

    function _onCellKeydown(e) {
        const isEditing = !this.hasAttribute("readonly");

        if (e.key === "Enter") {
            e.preventDefault();
            if (!isEditing && this.hasAttribute("data-editable")) {
                _enterEditMode(this);
                return;
            }
            _moveFocus(this, 0, 1);
            return;
        }
        if (e.key === "Escape") {
            if (isEditing) {
                this.value = this.dataset.originalValue ?? "";
                this.blur();
            }
            return;
        }
        if (e.key === "Tab") {
            e.preventDefault();
            _moveFocus(this, e.shiftKey ? -1 : 1, 0);
            return;
        }
        if (e.key === "ArrowUp")   { e.preventDefault(); _moveFocus(this, 0, -1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); _moveFocus(this, 0,  1); return; }
        if (e.key === "ArrowLeft") {
            if (!isEditing || this.selectionStart === 0) { e.preventDefault(); _moveFocus(this, -1, 0); }
            return;
        }
        if (e.key === "ArrowRight") {
            if (!isEditing || this.selectionStart === this.value.length) { e.preventDefault(); _moveFocus(this, 1, 0); }
            return;
        }
        // Carattere stampabile su cella selezionata → entra in edit mode e sostituisce
        if (!isEditing && this.hasAttribute("data-editable") && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            _enterEditMode(this);
            this.value = "";
            // Non preventDefault — il carattere digitato verrà inserito
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
            document.querySelectorAll(".cell-input[data-editable]")
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

    async function removeOverride(rowId, colSlug) {
        if (!colSlug) return;
        try {
            const updated = await ApiClient.removeOverride(rowId, colSlug);
            const idx = _rows.findIndex(r => r.id === rowId);
            if (idx !== -1) _rows[idx] = updated;
            _applyFilters();
            render();
            showToast("Modifica manuale rimossa.", "success");
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
        if (btn) btn.classList.toggle("active", _showDeleted);
        _applyFilters();
        render();
    }


    // --------------------------------------------------------
    // TOGGLE LOG
    // --------------------------------------------------------

    function toggleLog() {
        const table  = document.getElementById("data-grid");
        const hidden = table.classList.toggle("log-hidden");
        const btn    = document.getElementById("btn-toggle-log");
        if (btn) btn.classList.toggle("active", hidden);
    }

    function toggleRev() {
        const table  = document.getElementById("data-grid");
        const hidden = table.classList.toggle("rev-hidden");
        const btn    = document.getElementById("btn-toggle-rev");
        if (btn) btn.classList.toggle("active", hidden);
    }


    // --------------------------------------------------------
    // CONTEXT MENU
    // --------------------------------------------------------

    function _initContextMenu() {
        const menu = document.getElementById("row-context-menu");
        if (!menu) return;

        menu.addEventListener("click", async e => {
            const item = e.target.closest("[data-action]");
            if (!item || _ctxRowId === null) return;
            const action  = item.dataset.action;
            const rowId   = _ctxRowId;
            const colSlug = _ctxColSlug;
            _closeContextMenu();

            if (action === "delete")          await softDeleteRow(rowId);
            if (action === "restore")         await restoreRow(rowId);
            if (action === "hard-delete")     await hardDeleteRow(rowId);
            if (action === "remove-override") await removeOverride(rowId, colSlug);
            if (action === "log")             showRowLog(rowId);
        });

        document.addEventListener("click", e => {
            if (menu.classList.contains("visible") && !menu.contains(e.target)) {
                _closeContextMenu();
            }
        });

        document.addEventListener("keydown", e => {
            if (e.key === "Escape") _closeContextMenu();
        });
    }

    function openContextMenu(e, rowId) {
        e.preventDefault();
        _ctxRowId = rowId;

        const row  = _rows.find(r => r.id === rowId);
        const menu = document.getElementById("row-context-menu");
        if (!menu || !row) return;

        const isDeleted = row.is_deleted;
        menu.querySelector('[data-action="delete"]').style.display      = isDeleted ? "none" : "";
        menu.querySelector('[data-action="restore"]').style.display     = isDeleted ? "" : "none";
        menu.querySelector('[data-action="hard-delete"]').style.display = isDeleted ? "" : "none";

        // Voce override: visibile solo se click su una cella con data-overridden="true"
        const td = e.target.closest("td[data-overridden='true']");
        _ctxColSlug = td ? td.querySelector("[data-slug]")?.dataset.slug ?? null : null;
        const showOverride = !isDeleted && _ctxColSlug !== null;
        menu.querySelector('[data-action="remove-override"]').style.display = showOverride ? "" : "none";
        menu.querySelector('.ctx-sep-override').style.display               = showOverride ? "" : "none";

        const x = Math.min(e.clientX, window.innerWidth  - 210);
        const y = Math.min(e.clientY, window.innerHeight - 140);
        menu.style.left = x + "px";
        menu.style.top  = y + "px";
        menu.classList.add("visible");
    }

    function _closeContextMenu() {
        document.getElementById("row-context-menu")?.classList.remove("visible");
        _ctxRowId   = null;
        _ctxColSlug = null;
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
                <td colspan="${columns.length}"
                    style="color:var(--color-danger)">
                    Errore: ${_escHtml(message)}
                </td>
            </tr>`;
    }

    const _escHtml = Utils.escHtml;
    const _escAttr = Utils.escAttr;

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
        toggleRev,
        search,
        showRowLog,
        openContextMenu
    };

})();


// showToast — alias globale per compatibilità con chiamate dirette nei template
const showToast = Utils.showToast;