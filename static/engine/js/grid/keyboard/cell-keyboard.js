const CellKeyboard = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _editingInput = null;
    let _cfg = {};

    function configure(opts) {
        _cfg = opts;
    }

    function isEditing() {
        return _editingInput !== null;
    }

    // --------------------------------------------------------
    // EDIT MODE
    // --------------------------------------------------------

    function enterEditMode(input) {
        if (_editingInput === input) return;
        if (_editingInput) _editingInput.blur();
        SelectionManager.clearRange();
        _editingInput = input;
        input.removeAttribute("readonly");
        input.focus();
        input.select();
    }

    // --------------------------------------------------------
    // SCROLL + KEYBOARD NAVIGATION
    // --------------------------------------------------------

    function _scrollRowIntoView(rowIdx) {
        const container = document.getElementById('grid-scroll-container');
        if (!container) return;
        const rowH    = _cfg.getRowHeight();
        const headerH = document.querySelector('#data-grid thead')?.offsetHeight || rowH;
        const rowTop  = rowIdx * rowH;
        const rowBot  = rowTop + rowH;
        const viewTop = container.scrollTop + headerH;
        const viewBot = container.scrollTop + container.clientHeight;

        if (rowTop < viewTop) {
            container.scrollTop = Math.max(0, rowTop - headerH);
        } else if (rowBot > viewBot) {
            container.scrollTop = rowBot - container.clientHeight + rowH;
        }

        const filteredRows = _cfg.getFilteredRows();
        const targetRow = filteredRows[rowIdx];
        if (targetRow && !document.querySelector(`input[data-row-id="${targetRow.id}"]`)) {
            _cfg.forceRender();
        }
    }

    function _moveFocus(currentInput, dCol, dRow) {
        const td = currentInput.closest('td[data-row-idx]');
        const filteredRows = _cfg.getFilteredRows();

        if (!td) {
            // Ghost row fallback: ArrowUp moves to last data row
            if (dRow < 0 && filteredRows.length > 0) {
                const lastIdx = filteredRows.length - 1;
                const editableCols = ColumnsManager.getColumns().filter(c => c.slug !== 'log' && c.slug !== 'rev');
                if (!editableCols.length) return;
                _scrollRowIntoView(lastIdx);
                const target = filteredRows[lastIdx];
                requestAnimationFrame(() => {
                    const input = document.querySelector(`input[data-row-id="${target.id}"][data-field="${editableCols[0].slug}"]`);
                    if (input) { input.focus(); input.select(); }
                });
            }
            return;
        }

        const editableCols = ColumnsManager.getColumns().filter(c => c.slug !== 'log' && c.slug !== 'rev');
        const field     = currentInput.dataset.field;
        const curColIdx = editableCols.findIndex(c => c.slug === field);
        if (curColIdx === -1) return;

        const curRowIdx = +td.dataset.rowIdx;
        const newRowIdx = curRowIdx + dRow;
        const newColIdx = curColIdx + dCol;

        if (newColIdx < 0 || newColIdx >= editableCols.length) return;

        // Past last row → move to ghost row
        if (newRowIdx >= filteredRows.length) {
            const ghost = document.querySelector(`[data-ghost][data-field="${editableCols[newColIdx].slug}"]`);
            if (ghost) ghost.focus();
            return;
        }
        if (newRowIdx < 0) return;

        _scrollRowIntoView(newRowIdx);
        const targetRow = filteredRows[newRowIdx];
        const targetCol = editableCols[newColIdx];
        requestAnimationFrame(() => {
            const input = document.querySelector(`input[data-row-id="${targetRow.id}"][data-field="${targetCol.slug}"]`);
            if (input) { input.focus(); input.select(); }
        });
    }

    // --------------------------------------------------------
    // CELL EVENT HANDLERS
    // --------------------------------------------------------

    function onCellFocus() {
        this.dataset.originalValue = this.value;
        this.closest("tr")?.classList.add("selected");
    }

    async function onCellBlur() {
        this.closest("tr")?.classList.remove("selected");
        const newVal  = this.value.trim();
        const origVal = this.dataset.originalValue ?? "";

        if (this.hasAttribute("data-editable")) {
            this.setAttribute("readonly", "");
            if (_editingInput === this) _editingInput = null;
        }

        if (newVal === origVal) return;
        const cells = _cfg.normalizeCells(this);
        if (cells.length === 0) return;
        await _cfg.doSaveCell(this, cells[0], newVal);
    }

    function onCellDblClick() {
        enterEditMode(this);
    }

    function onCellPaste(e) {
        if (!this.hasAttribute("readonly")) return;
        const text = (e.clipboardData?.getData("text/plain") ?? "").trim();
        const isMultiCell = text.includes("\n") || text.includes("\t");
        if (isMultiCell) return; // paste.js handles multi-cell
        e.preventDefault();
        enterEditMode(this);
        this.value = text;
    }

    function onCellKeydown(e) {
        // AutoComplete intercepts arrow/alt/escape keys when its dropdown is visible
        if (AutoComplete.onKeydown(e, this)) return;

        const isEditing = !this.hasAttribute("readonly");

        if (e.key === "Enter") {
            e.preventDefault();
            if (!isEditing && this.hasAttribute("data-editable")) {
                enterEditMode(this);
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
                SelectionManager.clearRange();
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
        // Printable key on selected (non-editing) cell → enter edit mode and replace value
        if (!isEditing && this.hasAttribute("data-editable") && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            enterEditMode(this);
            this.value = "";
        }
    }

    // --------------------------------------------------------
    // GHOST ROW HANDLERS
    // --------------------------------------------------------

    async function onGhostKeydown(e) {
        if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const tag = this.value.trim().toUpperCase();
            if (!tag) return;
            await _cfg.createFromGhost(tag);
        }
        if (e.key === "Escape") {
            this.value = "";
        }
    }

    async function onGhostBlur() {
        const tag = this.value.trim().toUpperCase();
        if (!tag) return;
        await _cfg.createFromGhost(tag);
    }

    // --------------------------------------------------------

    return {
        configure,
        isEditing,
        enterEditMode,
        onCellFocus,
        onCellBlur,
        onCellDblClick,
        onCellKeydown,
        onCellPaste,
        onGhostKeydown,
        onGhostBlur,
    };

})();
