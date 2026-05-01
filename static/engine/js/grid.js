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
    let _ctxRowId      = null;   // Row ID del context menu aperto
    let _ctxColSlug    = null;   // Col slug (only overridden cells) for remove-override action
    let _ctxColSlugLog = null;   // Col slug for cell-log action (any data cell)
    let _editingInput  = null;   // Input correntemente in edit mode (non readonly)
    let _ranges        = [];    // [{start:{r,c}, end:{r,c}}, ...] — all selected ranges
    let _activeDragIdx = -1;    // index into _ranges of the range currently being dragged
    let _isDragging    = false;
    let _isAdditive    = false; // true when Ctrl is held (ranges accumulate)
    let _ctxFlagsCache = null;  // [{id,name,color}] — non-system flags; null = reload on next submenu open


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
            _initRangeSelection();
            _initColumnHeaderSelection();
            _initCopyToClipboard();
        } catch (err) {
            _showError(err.message);
        }
    }


    // --------------------------------------------------------
    // RENDERING
    // --------------------------------------------------------

    function render() {
        _clearRange();
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

    function _flagBadgesHtml(flags, overrideEtlValue) {
        const hidden = typeof FlagsManager !== "undefined" ? FlagsManager.getHiddenIds() : new Set();
        const visible = (flags || []).filter(f => !hidden.has(f.id));
        const manualEditHidden = typeof FlagsManager !== "undefined" && FlagsManager.isHiddenByName('manual_edit');
        const etlLabel = (overrideEtlValue === null || overrideEtlValue === "")
            ? "(empty)"
            : Utils.escAttr(String(overrideEtlValue));
        const overrideDot = (!manualEditHidden && overrideEtlValue !== undefined)
            ? `<span class="cell-flag-dot" style="background:#FF8C00" title="ETL: ${etlLabel}"></span>`
            : "";
        if (!overrideDot && !visible.length) return "";
        const dots = visible.map(f =>
            `<span class="cell-flag-dot" style="background:${Utils.escAttr(f.color)}" title="${Utils.escAttr(f.name)}"></span>`
        ).join("");
        return `<span class="cell-flag-badges">${overrideDot}${dots}</span>`;
    }

    /**
     * Renderizza una riga dati.
     */
    function _renderRow(row, columns, rowIndex) {
        const isDeleted    = row.is_deleted;
        const rowFlags     = row.cell_flags && row.cell_flags[""];
        const isEliminated = !isDeleted && rowFlags && rowFlags.some(f => f.name === "ETL: Eliminated");
        const rowClass     = isDeleted ? "row-deleted" : (isEliminated ? "row-eliminated" : "");
        const cells        = columns.map((col, colIdx) => _renderCell(row, col, isDeleted, rowIndex, colIdx)).join("");
        const rowBadges    = _flagBadgesHtml(rowFlags);

        return `
            <tr data-row-id="${row.id}"
                class="${rowClass}"
                oncontextmenu="GridManager.openContextMenu(event, ${row.id}, ${isDeleted})">
                <td class="row-num${rowBadges ? ' row-num-flags' : ''}" data-row-idx="${rowIndex}">${rowIndex + 1}${rowBadges}</td>
                ${cells}
            </tr>`;
    }

    /**
     * Renderizza una singola cella.
     */
    function _renderCell(row, col, isDeleted, rowIdx, colIdx) {
        const value  = row[col.slug] ?? "";
        const isLog  = col.slug === "log";
        const isRev  = col.slug === "rev";
        const isTag  = col.slug === "tag";
        const coords = ` data-row-idx="${rowIdx}" data-col-idx="${colIdx}"`;

        if (isLog) {
            return `
                <td data-slug="log" style="width:${col.width}px"${coords}>
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
        const overriddenAttr = isOverridden ? ` data-overridden="true"` : "";

        const cellFlags  = row.cell_flags && row.cell_flags[col.slug];
        const flagBadges = _flagBadgesHtml(cellFlags, isOverridden ? (etlValue ?? "") : undefined);
        const flagAttr   = flagBadges ? ' data-has-flags="true"' : "";

        return `
            <td style="width:${col.width}px"${overriddenAttr}${flagAttr}${coords}>
                <input
                    type="text"
                    class="${cellClass}"
                    data-row-id="${row.id}"
                    data-field="${col.slug}"
                    value="${_escAttr(value)}"
                    ${readonly}
                >
                ${flagBadges}
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

        // Range selection — mousedown/mouseenter su <td> dati (non ghost)
        document.querySelectorAll("tr[data-row-id] td[data-row-idx]").forEach(td => {
            td.addEventListener("mousedown",  _onTdMousedown);
            td.addEventListener("mouseenter", _onTdMouseenter);
        });

        // Row number click — select entire row
        document.querySelectorAll("td.row-num[data-row-idx]").forEach(td => {
            td.addEventListener("click", function(e) {
                const rowIdx = +this.dataset.rowIdx;
                if (isNaN(rowIdx)) return;
                _selectRow(rowIdx, e.ctrlKey || e.metaKey);
            });
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
        _clearRange();
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
            } else {
                _clearRange();
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
    // RANGE SELECTION
    // --------------------------------------------------------

    function _initRangeSelection() {
        document.addEventListener("mouseup", () => {
            if (_isDragging) {
                _isDragging = false;
                document.getElementById("data-grid")?.classList.remove("selecting");
            }
        });
    }

    function _onTdMousedown(e) {
        if (e.button !== 0) return;
        const input = this.querySelector(".cell-input");
        if (input && !input.hasAttribute("readonly")) return;

        const r = +this.dataset.rowIdx;
        const c = +this.dataset.colIdx;
        if (isNaN(r) || isNaN(c)) return;

        if (e.shiftKey && _ranges.length > 0) {
            // Extend primary range end, keep its anchor fixed
            _ranges[0] = { start: _ranges[0].start, end: { r, c } };
            _activeDragIdx = 0;
            _isDragging = true;
            _isAdditive = false;
            document.getElementById("data-grid")?.classList.add("selecting");
            _updateRangeHighlight();
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            // Additive: keep existing ranges, append a new one
            _ranges.push({ start: { r, c }, end: { r, c } });
            _activeDragIdx = _ranges.length - 1;
            _isAdditive = true;
        } else {
            // Plain click/drag: start fresh
            _ranges = [{ start: { r, c }, end: { r, c } }];
            _activeDragIdx = 0;
            _isAdditive = false;
        }

        _isDragging = true;
        document.getElementById("data-grid")?.classList.add("selecting");
        _updateRangeHighlight();
    }

    function _onTdMouseenter(e) {
        if (!_isDragging || _activeDragIdx === -1) return;
        const r = +this.dataset.rowIdx;
        const c = +this.dataset.colIdx;
        if (isNaN(r) || isNaN(c)) return;
        _ranges[_activeDragIdx].end = { r, c };
        _updateRangeHighlight();
    }

    function _updateRangeHighlight() {
        document.querySelectorAll("td.cell-selected")
            .forEach(td => td.classList.remove("cell-selected"));
        if (_ranges.length === 0) return;

        document.querySelectorAll("td[data-row-idx][data-col-idx]").forEach(td => {
            const r = +td.dataset.rowIdx;
            const c = +td.dataset.colIdx;
            for (const range of _ranges) {
                const rMin = Math.min(range.start.r, range.end.r);
                const rMax = Math.max(range.start.r, range.end.r);
                const cMin = Math.min(range.start.c, range.end.c);
                const cMax = Math.max(range.start.c, range.end.c);
                if (r >= rMin && r <= rMax && c >= cMin && c <= cMax) {
                    td.classList.add("cell-selected");
                    break;
                }
            }
        });
    }

    function _clearRange() {
        _ranges        = [];
        _activeDragIdx = -1;
        _isDragging    = false;
        _isAdditive    = false;
        document.getElementById("data-grid")?.classList.remove("selecting");
        document.querySelectorAll("td.cell-selected")
            .forEach(td => td.classList.remove("cell-selected"));
    }

    // Registered once from init() — headers don't re-render on data changes.
    function _initColumnHeaderSelection() {
        const thead = document.querySelector("#data-grid thead");
        if (!thead) return;
        thead.addEventListener("click", e => {
            if (e.target.classList.contains("resize-handle")) return;
            const th = e.target.closest("th");
            if (!th) return;
            const ths = Array.from(thead.querySelectorAll("th"));
            const colIdx = ths.indexOf(th) - 1; // -1 for row-num <th>
            if (colIdx < 0) return;
            _selectColumn(colIdx, e.ctrlKey || e.metaKey);
        });
    }

    function _selectColumn(colIdx, additive = false) {
        if (_filteredRows.length === 0) return;
        const range = { start: { r: 0, c: colIdx }, end: { r: _filteredRows.length - 1, c: colIdx } };
        if (additive) {
            _ranges.push(range);
        } else {
            _ranges = [range];
        }
        _activeDragIdx = -1;
        _isDragging    = false;
        document.getElementById("data-grid")?.classList.remove("selecting");
        _updateRangeHighlight();
    }

    function _selectRow(rowIdx, additive = false) {
        const colCount = ColumnsManager.getColumns().length;
        if (colCount === 0) return;
        const range = { start: { r: rowIdx, c: 0 }, end: { r: rowIdx, c: colCount - 1 } };
        if (additive) {
            _ranges.push(range);
        } else {
            _ranges = [range];
        }
        _activeDragIdx = -1;
        _isDragging    = false;
        document.getElementById("data-grid")?.classList.remove("selecting");
        _updateRangeHighlight();
    }

    function _initCopyToClipboard() {
        document.addEventListener("keydown", async e => {
            if (!(e.key === "c" && (e.ctrlKey || e.metaKey))) return;
            if (_ranges.length === 0) return;
            if (_editingInput) return;

            e.preventDefault();

            const columns = ColumnsManager.getColumns();

            // Bounding box across all ranges
            let rMin = Infinity, rMax = -Infinity;
            let cMin = Infinity, cMax = -Infinity;
            for (const range of _ranges) {
                rMin = Math.min(rMin, range.start.r, range.end.r);
                rMax = Math.max(rMax, range.start.r, range.end.r);
                cMin = Math.min(cMin, range.start.c, range.end.c);
                cMax = Math.max(cMax, range.start.c, range.end.c);
            }

            const lines = [];
            for (let r = rMin; r <= rMax; r++) {
                const row = _filteredRows[r];
                if (!row) continue;
                const cells = [];
                for (let c = cMin; c <= cMax; c++) {
                    const inRange = _ranges.some(range => {
                        const r0 = Math.min(range.start.r, range.end.r);
                        const r1 = Math.max(range.start.r, range.end.r);
                        const c0 = Math.min(range.start.c, range.end.c);
                        const c1 = Math.max(range.start.c, range.end.c);
                        return r >= r0 && r <= r1 && c >= c0 && c <= c1;
                    });
                    const col = columns[c];
                    cells.push(inRange && col ? String(row[col.slug] ?? "") : "");
                }
                lines.push(cells.join("\t"));
            }

            try {
                await navigator.clipboard.writeText(lines.join("\n"));
                const count = (rMax - rMin + 1) * (cMax - cMin + 1);
                Utils.showToast(`${count} cell${count === 1 ? "" : "s"} copied.`, "success");
            } catch {
                Utils.showToast("Cannot access clipboard.", "error");
            }
        });
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

            // Aggiorna override dot e attributo senza re-render completo
            const td = inputEl.closest("td");
            if (td) {
                const isOverridden = updatedRow.overridden_cols != null && field in updatedRow.overridden_cols;
                if (isOverridden) td.setAttribute("data-overridden", "true");
                else              td.removeAttribute("data-overridden");
                const etlVal  = isOverridden ? (updatedRow.overridden_cols[field] ?? "") : undefined;
                const cfSlug  = updatedRow.cell_flags && updatedRow.cell_flags[field];
                const badges  = _flagBadgesHtml(cfSlug, isOverridden ? etlVal : undefined);
                const existing = td.querySelector(".cell-flag-badges");
                if (existing) existing.remove();
                if (badges) {
                    td.insertAdjacentHTML("beforeend", badges);
                    td.setAttribute("data-has-flags", "true");
                } else {
                    td.removeAttribute("data-has-flags");
                }
            }

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


    async function keepRow(rowId) {
        try {
            await ApiClient.keepRow(rowId);
            const row = _rows.find(r => r.id === rowId);
            if (row && row.cell_flags && row.cell_flags[""]) {
                row.cell_flags[""] = row.cell_flags[""].filter(f => f.name !== "ETL: Eliminated");
            }
            _applyFilters();
            render();
            showToast("Row kept — ETL: Eliminated flag removed.", "success");
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
            const action      = item.dataset.action;
            const rowId       = _ctxRowId;
            const colSlug     = _ctxColSlug;
            const colSlugLog  = _ctxColSlugLog;
            const flagsSnap   = _ctxFlagsCache;
            _closeContextMenu();

            if (action === "delete")          await softDeleteRow(rowId);
            if (action === "restore")         await restoreRow(rowId);
            if (action === "hard-delete")     await hardDeleteRow(rowId);
            if (action === "keep-row")        await keepRow(rowId);
            if (action === "remove-override") await removeOverride(rowId, colSlug);
            if (action === "log")             showRowLog(rowId);
            if (action === "cell-log")        showCellLog(rowId, colSlugLog);
            if (action === "range-log")       showRangeLog();
            if (action === "flags-trigger")   return;
            if (action === "open-flag-manager") { FlagsManager.show(); return; }
            if (action === "toggle-flag") {
                const flagId = parseInt(item.dataset.flagId, 10);
                const cells  = _getSelectedCells();
                if (!cells.length || isNaN(flagId)) return;
                try {
                    const result = await ApiClient.toggleCellFlags(flagId, cells);
                    const flag   = flagsSnap?.find(f => f.id === flagId);
                    for (const { row_tag, col_slug } of cells) {
                        const row = _rows.find(r => r.tag === row_tag);
                        if (!row) continue;
                        if (!row.cell_flags) row.cell_flags = {};
                        const arr = row.cell_flags[col_slug] ?? [];
                        if (result.action === "removed") {
                            row.cell_flags[col_slug] = arr.filter(f => f.id !== flagId);
                        } else if (flag) {
                            if (!arr.some(f => f.id === flagId))
                                row.cell_flags[col_slug] = [...arr, flag];
                        }
                    }
                    _applyFilters();
                    render();
                } catch (err) {
                    showToast(err.message, "error");
                }
                return;
            }
        });

        document.addEventListener("click", e => {
            if (menu.classList.contains("visible") && !menu.contains(e.target)) {
                _closeContextMenu();
            }
        });

        document.addEventListener("keydown", e => {
            if (e.key === "Escape") _closeContextMenu();
        });

        const flagTriggerEl = menu.querySelector('[data-action="flags-trigger"]');
        if (flagTriggerEl) {
            flagTriggerEl.addEventListener("mouseenter", async () => {
                const listEl = document.getElementById("ctx-flags-list");
                if (_ctxFlagsCache !== null) {
                    _populateFlagsSubmenu(_ctxFlagsCache, _getSelectedCells());
                    return;
                }
                if (listEl) listEl.innerHTML = '<div class="ctx-item" style="color:var(--color-text-muted);cursor:default;pointer-events:none">Loading…</div>';
                try {
                    const all      = await ApiClient.listFlags();
                    _ctxFlagsCache = all.filter(f => !f.is_system);
                    _populateFlagsSubmenu(_ctxFlagsCache, _getSelectedCells());
                } catch {
                    if (listEl) listEl.innerHTML = '<div class="ctx-item" style="color:var(--color-danger);cursor:default;pointer-events:none">Error loading flags</div>';
                }
            });
        }
    }

    function openContextMenu(e, rowId, fromDeleted = false) {
        e.preventDefault();
        _ctxRowId = rowId;

        // Use fromDeleted hint to disambiguate: _trash.id and tool.__id are independent
        // autoincrement sequences that can produce the same numeric value.
        const row = _rows.find(r => r.id === rowId && Boolean(r.is_deleted) === Boolean(fromDeleted));
        const menu = document.getElementById("row-context-menu");
        if (!menu || !row) return;

        // Items 16/17: if right-click lands on a data cell, check whether it is
        // inside the current range selection.
        // Inside  → keep _ranges (range context menu).
        // Outside → collapse to the single clicked cell.
        const clickedTd = e.target.closest("td[data-row-idx][data-col-idx]");
        if (clickedTd) {
            const r = +clickedTd.dataset.rowIdx;
            const c = +clickedTd.dataset.colIdx;
            const inside = _ranges.length > 0 && _ranges.some(rng => {
                const rMin = Math.min(rng.start.r, rng.end.r);
                const rMax = Math.max(rng.start.r, rng.end.r);
                const cMin = Math.min(rng.start.c, rng.end.c);
                const cMax = Math.max(rng.start.c, rng.end.c);
                return r >= rMin && r <= rMax && c >= cMin && c <= cMax;
            });
            if (!inside) {
                _ranges = [{ start: { r, c }, end: { r, c } }];
                _updateRangeHighlight();
            }
        }

        const isDeleted = row.is_deleted;
        menu.querySelector('[data-action="delete"]').style.display      = isDeleted ? "none" : "";
        menu.querySelector('[data-action="restore"]').style.display     = isDeleted ? "" : "none";
        menu.querySelector('[data-action="hard-delete"]').style.display = isDeleted ? "" : "none";

        // Keep row: visible only on rows flagged ETL: Eliminated
        const rowCellFlags = row.cell_flags && row.cell_flags[""];
        const isEliminated = !isDeleted && rowCellFlags && rowCellFlags.some(f => f.name === "ETL: Eliminated");
        menu.querySelector('[data-action="keep-row"]').style.display    = isEliminated ? "" : "none";
        menu.querySelector('.ctx-sep-keep-row').style.display           = isEliminated ? "" : "none";

        // Voce override: visibile solo se click su una cella con data-overridden="true"
        const tdOverridden = e.target.closest("td[data-overridden='true']");
        _ctxColSlug = tdOverridden ? tdOverridden.querySelector("[data-field]")?.dataset.field ?? null : null;
        const showOverride = !isDeleted && _ctxColSlug !== null;
        menu.querySelector('[data-action="remove-override"]').style.display = showOverride ? "" : "none";
        menu.querySelector('.ctx-sep-override').style.display               = showOverride ? "" : "none";

        // Voce cell-log / range-log: visibile su qualsiasi cella dati (non log, non rev, non row-num)
        const tdAny = e.target.closest("td[data-col-idx]");
        _ctxColSlugLog = tdAny ? (tdAny.querySelector("[data-field]")?.dataset.field ?? null) : null;
        const showLogEntry = !isDeleted && _ctxColSlugLog !== null;
        const isSingle = _isSingleCellSelection();
        menu.querySelector('[data-action="cell-log"]').style.display    = showLogEntry && isSingle  ? "" : "none";
        menu.querySelector('[data-action="range-log"]').style.display   = showLogEntry && !isSingle ? "" : "none";
        menu.querySelector('.ctx-sep-cell-log').style.display           = showLogEntry ? "" : "none";

        const flagTrigger = menu.querySelector('[data-action="flags-trigger"]');
        const flagSep     = menu.querySelector('.ctx-sep-flags');
        if (flagTrigger) flagTrigger.style.display = showLogEntry ? "" : "none";
        if (flagSep)     flagSep.style.display     = showLogEntry ? "" : "none";
        if (flagTrigger) {
            // menu left = min(clientX, innerWidth-210); menu width ≈ 195px; submenu width ≈ 190px
            const menuLeft  = Math.min(e.clientX, window.innerWidth - 210);
            flagTrigger.classList.toggle("submenu-left", menuLeft + 195 + 190 > window.innerWidth);
        }
        _ctxFlagsCache = null;

        const x = Math.min(e.clientX, window.innerWidth  - 210);
        const y = Math.min(e.clientY, window.innerHeight - 140);
        menu.style.left = x + "px";
        menu.style.top  = y + "px";
        menu.classList.add("visible");
    }

    function _closeContextMenu() {
        document.getElementById("row-context-menu")?.classList.remove("visible");
        _ctxRowId      = null;
        _ctxColSlug    = null;
        _ctxColSlugLog = null;
        _ctxFlagsCache = null;
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
    // SHOW CELL LOG (sidebar)
    // --------------------------------------------------------

    function showCellLog(rowId, colSlug) {
        if (!colSlug) return;
        const row = _rows.find(r => r.id === rowId);
        if (!row) return;

        const colKey = colSlug.toUpperCase();
        const rowLabel = _escHtml(row.tag || `#${rowId}`);
        const colLabel = _escHtml(colSlug);

        let bodyHtml;
        if (!row.row_log) {
            bodyHtml = '<p class="sidebar-log-empty">No changes recorded for this cell.</p>';
        } else {
            const allEntries = row.row_log.split("\n").filter(Boolean);
            // Entry format: "[timestamp REV n] COL_KEY: old → new"
            const cellEntries = allEntries.filter(e => e.includes(`] ${colKey}:`));

            if (cellEntries.length === 0) {
                bodyHtml = '<p class="sidebar-log-empty">No changes recorded for this cell.</p>';
            } else {
                const items = cellEntries.map(e => {
                    const m = e.match(/^\[(.+?)\]\s+\w+:\s+(.+)$/);
                    const ts     = m ? _escHtml(m[1]) : '';
                    const change = m ? _escHtml(m[2]) : _escHtml(e);
                    return `<li class="sidebar-log-entry">
                        <div class="sidebar-log-ts">${ts}</div>
                        <div class="sidebar-log-change">${change}</div>
                    </li>`;
                }).join('');
                bodyHtml = `<ul class="sidebar-log-list">${items}</ul>`;
            }
        }

        const html = `
            <div class="sidebar-log-meta">
                <span class="sidebar-log-label">Column:</span>
                <span class="sidebar-log-value">${colLabel}</span>
                <span class="sidebar-log-label">Row:</span>
                <span class="sidebar-log-value">${rowLabel}</span>
            </div>
            ${bodyHtml}`;

        SidebarManager.open('LOG');
        SidebarManager.setTitle(`LOG — ${colLabel}`);
        SidebarManager.setContent(html);
    }


    // --------------------------------------------------------
    // RANGE LOG (sidebar, multi-cell aggregated view)
    // --------------------------------------------------------

    function _isSingleCellSelection() {
        if (_ranges.length === 0) return true;
        const seen = new Set();
        for (const rng of _ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            const cMin = Math.min(rng.start.c, rng.end.c);
            const cMax = Math.max(rng.start.c, rng.end.c);
            for (let r = rMin; r <= rMax; r++)
                for (let c = cMin; c <= cMax; c++)
                    seen.add(`${r},${c}`);
        }
        return seen.size <= 1;
    }

    function showRangeLog() {
        if (_ranges.length === 0) return;

        const columns = ColumnsManager.getColumns();

        // Collect unique cells in range order (col-major grouping)
        const colCellMap = new Map(); // colSlug → Map(rowTag → entries[])

        for (const rng of _ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            const cMin = Math.min(rng.start.c, rng.end.c);
            const cMax = Math.max(rng.start.c, rng.end.c);
            for (let ci = cMin; ci <= cMax; ci++) {
                const col = columns[ci];
                if (!col) continue;
                const colSlug = col.slug;
                const colKey  = colSlug.toUpperCase();
                if (!colCellMap.has(colSlug)) colCellMap.set(colSlug, new Map());
                const rowMap = colCellMap.get(colSlug);

                for (let ri = rMin; ri <= rMax; ri++) {
                    const row = _filteredRows[ri];
                    if (!row) continue;
                    const rowTag = row.tag || `#${row.id}`;
                    if (!rowMap.has(rowTag)) rowMap.set(rowTag, []);
                    if (row.row_log) {
                        const entries = row.row_log.split('\n').filter(e => e.includes(`] ${colKey}:`));
                        rowMap.get(rowTag).push(...entries);
                    }
                }
            }
        }

        let hasAny = false;
        let html   = '';

        for (const [colSlug, rowMap] of colCellMap) {
            let rowsHtml = '';
            for (const [rowTag, entries] of rowMap) {
                if (entries.length === 0) continue;
                hasAny = true;
                const items = entries.map(e => {
                    const m = e.match(/^\[(.+?)\]\s+\w+:\s+(.+)$/);
                    const ts     = m ? _escHtml(m[1]) : '';
                    const change = m ? _escHtml(m[2]) : _escHtml(e);
                    return `<li class="sidebar-log-entry">
                        <div class="sidebar-log-ts">${ts}</div>
                        <div class="sidebar-log-change">${change}</div>
                    </li>`;
                }).join('');
                rowsHtml += `
                    <div class="sidebar-log-row-label">${_escHtml(rowTag)}</div>
                    <ul class="sidebar-log-list">${items}</ul>`;
            }
            if (!rowsHtml) continue;
            html += `
                <div class="sidebar-log-group">
                    <div class="sidebar-log-group-header">${_escHtml(colSlug)}</div>
                    ${rowsHtml}
                </div>`;
        }

        if (!hasAny) html = '<p class="sidebar-log-empty">No changes recorded for the selected range.</p>';

        SidebarManager.open('LOG');
        SidebarManager.setTitle('LOG — selection');
        SidebarManager.setContent(html);
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
    // FLAG SUBMENU HELPERS
    // --------------------------------------------------------

    function _getSelectedCells() {
        const columns = ColumnsManager.getColumns();
        const cells   = [];
        const seen    = new Set();
        for (const rng of _ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            const cMin = Math.min(rng.start.c, rng.end.c);
            const cMax = Math.max(rng.start.c, rng.end.c);
            for (let r = rMin; r <= rMax; r++) {
                const row = _filteredRows[r];
                if (!row) continue;
                for (let c = cMin; c <= cMax; c++) {
                    const col = columns[c];
                    if (!col || col.slug === "log" || col.slug === "rev") continue;
                    const key = `${row.tag}|${col.slug}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        cells.push({ row_tag: row.tag, col_slug: col.slug });
                    }
                }
            }
        }
        return cells;
    }

    function _flagCheckState(flagId, cells) {
        let count = 0;
        for (const { row_tag, col_slug } of cells) {
            const row = _rows.find(r => r.tag === row_tag);
            if (!row) continue;
            const arr = row.cell_flags?.[col_slug] ?? [];
            if (arr.some(f => f.id === flagId)) count++;
        }
        if (count === 0)            return "none";
        if (count === cells.length) return "all";
        return "some";
    }

    function _populateFlagsSubmenu(flags, cells) {
        const list = document.getElementById("ctx-flags-list");
        if (!list) return;
        if (!flags.length) {
            list.innerHTML = '<div class="ctx-item" style="color:var(--color-text-muted);cursor:default;pointer-events:none">No flags defined</div>';
            return;
        }
        list.innerHTML = flags.map(flag => {
            const state      = _flagCheckState(flag.id, cells);
            const checkGlyph = state === "none" ? "" : "✓";
            const mixedClass = state === "some"  ? " ctx-flag-mixed" : "";
            return `<div class="ctx-flag-item${mixedClass}" data-action="toggle-flag" data-flag-id="${flag.id}">` +
                   `<span class="ctx-flag-dot" style="background:${_escAttr(flag.color)}"></span>` +
                   `<span style="flex:1">${_escHtml(flag.name)}</span>` +
                   `<span class="ctx-flag-check">${checkGlyph}</span>` +
                   `</div>`;
        }).join("");
    }


    // --------------------------------------------------------
    function removeFlagFromCells(flagId) {
        for (const row of _rows) {
            if (!row.cell_flags) continue;
            for (const slug of Object.keys(row.cell_flags)) {
                row.cell_flags[slug] = row.cell_flags[slug].filter(f => f.id !== flagId);
            }
        }
        render();
    }

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
        showCellLog,
        showRangeLog,
        openContextMenu,
        removeFlagFromCells,
        getRange:     () => (_ranges.length > 0 ? _ranges[0] : null),
        getRanges:    () => [..._ranges],
        clearRange:   _clearRange,
        selectColumn: _selectColumn,
        selectRow:    _selectRow
    };

})();


// showToast — alias globale per compatibilità con chiamate dirette nei template
const showToast = Utils.showToast;