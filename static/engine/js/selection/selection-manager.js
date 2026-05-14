const SelectionManager = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _ranges           = [];
    let _activeDragIdx    = -1;
    let _isDragging       = false;
    let _isAdditive       = false;
    let _getFilteredRowCount = () => 0;

    // Injected by GridManager.init() so _selectColumn knows the current row count.
    function configure(getFilteredRowCount) {
        _getFilteredRowCount = getFilteredRowCount;
    }


    // --------------------------------------------------------
    // GLOBAL INIT — register document-level and once-per-session listeners
    // --------------------------------------------------------

    function initGlobal() {
        document.addEventListener("mouseup", () => {
            if (_isDragging) {
                _isDragging = false;
                document.getElementById("data-grid")?.classList.remove("selecting");
            }
        });

        _initRangeReadout();
        _initColumnHeaderSelection();
    }


    // --------------------------------------------------------
    // RANGE READOUT CHIP
    // --------------------------------------------------------

    function _initRangeReadout() {
        const chip = document.createElement('div');
        chip.className = 'range-readout';
        chip.id = 'range-readout';
        document.body.appendChild(chip);

        document.addEventListener('mousemove', e => {
            if (!_isDragging || _ranges.length === 0) {
                chip.style.display = 'none';
                return;
            }
            const range = _ranges[_activeDragIdx];
            if (!range) { chip.style.display = 'none'; return; }
            const rows = Math.abs(range.end.r - range.start.r) + 1;
            const cols = Math.abs(range.end.c - range.start.c) + 1;
            if (rows === 1 && cols === 1) { chip.style.display = 'none'; return; }
            chip.textContent = `${rows}R × ${cols}C`;
            chip.style.display = 'block';
            chip.style.top  = (e.clientY + 14) + 'px';
            chip.style.left = (e.clientX + 14) + 'px';
        });

        document.addEventListener('mouseup', () => {
            chip.style.display = 'none';
        });
    }


    // --------------------------------------------------------
    // COLUMN HEADER SELECTION — registered once (headers don't re-render)
    // --------------------------------------------------------

    function _initColumnHeaderSelection() {
        const thead = document.querySelector("#data-grid thead");
        if (!thead) return;
        thead.addEventListener("click", e => {
            if (e.target.classList.contains("resize-handle")) return;
            const th = e.target.closest("th");
            if (!th) return;
            const ths = Array.from(thead.querySelectorAll("th"));
            const colIdx = ths.indexOf(th) - 1; // -1 for gutter <th>
            if (colIdx < 0) return;
            selectColumn(colIdx, e.ctrlKey || e.metaKey);
        });
    }


    // --------------------------------------------------------
    // PER-RENDER LISTENERS — call from grid.js _attachListeners() after every render
    // --------------------------------------------------------

    function attachCellListeners() {
        document.querySelectorAll("tr[data-row-id] td[data-row-idx]").forEach(td => {
            td.addEventListener("mousedown",  _onTdMousedown);
            td.addEventListener("mouseenter", _onTdMouseenter);
        });

        document.querySelectorAll("td.gutter[data-row-idx]").forEach(td => {
            td.addEventListener("click", function(e) {
                const rowIdx = +this.dataset.rowIdx;
                if (isNaN(rowIdx)) return;
                selectRow(rowIdx, e.ctrlKey || e.metaKey);
            });
        });
    }


    // --------------------------------------------------------
    // MOUSE DRAG HANDLERS
    // --------------------------------------------------------

    function _onTdMousedown(e) {
        if (e.button !== 0) return;
        const input = this.querySelector(".cell-input");
        if (input && !input.hasAttribute("readonly")) return;

        const r = +this.dataset.rowIdx;
        const c = +this.dataset.colIdx;
        if (isNaN(r) || isNaN(c)) return;

        if (e.shiftKey && _ranges.length > 0) {
            _ranges[0] = { start: _ranges[0].start, end: { r, c } };
            _activeDragIdx = 0;
            _isDragging = true;
            _isAdditive = false;
            document.getElementById("data-grid")?.classList.add("selecting");
            updateHighlight();
            return;
        }

        if (e.ctrlKey || e.metaKey) {
            _ranges.push({ start: { r, c }, end: { r, c } });
            _activeDragIdx = _ranges.length - 1;
            _isAdditive = true;
        } else {
            _ranges = [{ start: { r, c }, end: { r, c } }];
            _activeDragIdx = 0;
            _isAdditive = false;
        }

        _isDragging = true;
        document.getElementById("data-grid")?.classList.add("selecting");
        updateHighlight();
    }

    function _onTdMouseenter(e) {
        if (!_isDragging || _activeDragIdx === -1) return;
        const r = +this.dataset.rowIdx;
        const c = +this.dataset.colIdx;
        if (isNaN(r) || isNaN(c)) return;
        _ranges[_activeDragIdx].end = { r, c };
        updateHighlight();
    }


    // --------------------------------------------------------
    // RANGE OPERATIONS
    // --------------------------------------------------------

    function updateHighlight() {
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

    function clearRange() {
        _ranges        = [];
        _activeDragIdx = -1;
        _isDragging    = false;
        _isAdditive    = false;
        document.getElementById("data-grid")?.classList.remove("selecting");
        document.querySelectorAll("td.cell-selected")
            .forEach(td => td.classList.remove("cell-selected"));
    }

    function selectColumn(colIdx, additive = false) {
        const rowCount = _getFilteredRowCount();
        if (rowCount === 0) return;
        const range = { start: { r: 0, c: colIdx }, end: { r: rowCount - 1, c: colIdx } };
        if (additive) {
            _ranges.push(range);
        } else {
            _ranges = [range];
        }
        _activeDragIdx = -1;
        _isDragging    = false;
        document.getElementById("data-grid")?.classList.remove("selecting");
        updateHighlight();
    }

    function selectRow(rowIdx, additive = false) {
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
        updateHighlight();
    }

    // Collapse selection to a single cell — used by openContextMenu when right-click
    // lands outside the current selection.
    function collapseToCell(r, c) {
        _ranges = [{ start: { r, c }, end: { r, c } }];
        updateHighlight();
    }


    // --------------------------------------------------------
    // QUERY HELPERS
    // --------------------------------------------------------

    function isSingleCellSelection() {
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

    function getSelectedRowIds(filteredRows) {
        const seen = new Set();
        const ids  = [];
        for (const rng of _ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            for (let r = rMin; r <= rMax; r++) {
                const row = filteredRows[r];
                if (row && !seen.has(row.id)) {
                    seen.add(row.id);
                    ids.push(row.id);
                }
            }
        }
        return ids;
    }

    function getSelectedCells(filteredRows, columns) {
        const cells = [];
        const seen  = new Set();
        for (const rng of _ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            const cMin = Math.min(rng.start.c, rng.end.c);
            const cMax = Math.max(rng.start.c, rng.end.c);
            for (let r = rMin; r <= rMax; r++) {
                const row = filteredRows[r];
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


    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    return {
        configure,
        initGlobal,
        attachCellListeners,
        updateHighlight,
        clearRange,
        selectColumn,
        selectRow,
        collapseToCell,
        isSingleCellSelection,
        getSelectedCells,
        getSelectedRowIds,
        getRanges:            () => [..._ranges],
        getFirstRange:        () => (_ranges.length > 0 ? _ranges[0] : null),
        getSelectionForPaste: (filteredRows) => ({ ranges: _ranges, filteredRows }),
    };

})();
