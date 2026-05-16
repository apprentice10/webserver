/**
 * grid.js — Engine
 * -----------------
 * Rendering e interazione della griglia universale.
 *
 * SECTION MAP (for targeted reading):
 *   ~L19  : state (_rows, _filteredRows, _ctxRowId …)
 *   ~L37  : init()
 *   ~L58  : rendering  (render, _initVirtualScroll — row/cell HTML → GridRenderer)
 *   ~L250 : event listeners  (_attachListeners — wires CellKeyboard.* handlers)
 *   ~L275 : ghost row  (_createFromGhost)
 *   ~L320 : cell save  → CellSave (P4-G7)
 *   ~L370 : soft-delete / restore / hard-delete
 *   ~L430 : toggleDeleted / toggleLog / context menu
 *   ~L680 : search / filters / appendRows
 *   ~L710 : utility (_normalizeCellsFromInput, updateRowData, refreshRowDOM, …)
 *   ~L820 : flag submenu helpers + public API
 */

const GridManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _rows         = [];     // Tutte le righe (incluse deleted)
    let _filteredRows = [];     // Righe dopo filtro ricerca
    let _showDeleted  = false;  // Mostra righe eliminate?
    let _searchQuery  = "";     // Query ricerca corrente
    let _rafPending    = false; // virtual scroll: RAF throttle flag
    // _editingInput → CellKeyboard (P4-G2)
    // _ctxRowId/ColSlug/ColSlugLog/FlagsCache → ContextMenu (P4-G3)


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    async function init() {
        try {
            await ColumnsManager.loadColumns();
            ColumnsManager.renderHeader();

            const [loadedRows, sfState] = await Promise.all([
                ApiClient.loadRows(true),
                ApiClient.getSortFilterState().catch(() => null),
            ]);
            _rows = loadedRows;
            if (typeof SortFilterManager !== 'undefined') SortFilterManager.loadState(sfState);
            _applyFilters();
            _initVirtualScroll();
            render();

            SelectionManager.configure(() => _filteredRows.length);
            CellSave.configure({
                getRows:         () => _rows,
                getFilteredRows: () => _filteredRows,
            });
            CellKeyboard.configure({
                getFilteredRows:  () => _filteredRows,
                getRowHeight:     _getRowHeight,
                normalizeCells:   _normalizeCellsFromInput,
                doSaveCell:       CellSave.doSaveCell,
                createFromGhost:  _createFromGhost,
                forceRender:      render,
            });
            PasteManager.init();
            RowOps.configure({
                getRows:          () => _rows,
                getFilteredRows:  () => _filteredRows,
                updateRow:        (id, data) => {
                    const idx = _rows.findIndex(r => r.id === id);
                    if (idx !== -1) _rows[idx] = data;
                },
                removeRows:       (idSet) => {
                    _rows         = _rows.filter(r => !idSet.has(r.id));
                    _filteredRows = _filteredRows.filter(r => !idSet.has(r.id));
                },
                applyFilters:     _applyFilters,
                render,
                addRowAtPosition: _addRowAtPosition,
                reloadData,
            });
            ContextMenu.configure({
                getRows:         () => _rows,
                getFilteredRows: () => _filteredRows,
                applyFilters:    _applyFilters,
                render,
                softDeleteRow:   RowOps.softDeleteRow,
                restoreRow:      RowOps.restoreRow,
                hardDeleteRow:   RowOps.hardDeleteRow,
                keepRow:         RowOps.keepRow,
                removeOverride:  RowOps.removeOverride,
                insertRowAbove:  RowOps.insertRowAbove,
                insertRowBelow:  RowOps.insertRowBelow,
                copyRowInsert:   RowOps.copyRowInsert,
            });
            ContextMenu.init();
            RowDrag.configure({ reloadData });
            RowDrag.init();
            SelectionManager.initGlobal();
            ClipboardManager.configure({
                getRanges:       SelectionManager.getRanges,
                isEditing:       CellKeyboard.isEditing,
                getColumns:      ColumnsManager.getColumns,
                getFilteredRows: () => _filteredRows,
            });
            ClipboardManager.init();
            _initSearchShortcut();
            _initSelectAll();
            _initFindReplace();
            _initAutocomplete();
            _initCut();
            _initPasteSpecial();
            _initFillHandle();
            if (typeof SortFilterManager !== 'undefined') {
                SortFilterManager.registerPanel();
                SortFilterManager.attachHeaderListeners();
                SortFilterManager.updateHeaderIndicators();
            }
            document.addEventListener('grid:rowUpdated', e => refreshRowDOM(e.detail.rowId, e.detail.row));
        } catch (err) {
            _showError(err.message);
        }
    }


    // --------------------------------------------------------
    // RENDERING
    // --------------------------------------------------------

    const OVERSCAN = 10;

    function _getRowHeight() {
        return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) + 1;
    }

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
            html += GridRenderer.renderGhostRow(columns);
            tbody.innerHTML = html;
            _attachListeners();
            SelectionManager.updateHighlight();
            if (typeof CutPaste   !== 'undefined') CutPaste.applyVisual();
            if (typeof FillHandle !== 'undefined') FillHandle.update();
            return;
        }

        const container = document.getElementById('grid-scroll-container');
        const scrollTop = container ? container.scrollTop : 0;
        const viewH     = container ? container.clientHeight : window.innerHeight;
        const rowH      = _getRowHeight();
        const colSpan   = columns.length + 1;

        const firstVis = Math.floor(scrollTop / rowH);
        const lastVis  = Math.ceil((scrollTop + viewH) / rowH);
        const start    = Math.max(0, firstVis - OVERSCAN);
        const end      = Math.min(_filteredRows.length - 1, lastVis + OVERSCAN);

        const topPad    = start * rowH;
        const bottomPad = Math.max(0, (_filteredRows.length - 1 - end) * rowH);

        if (topPad > 0) {
            html += `<tr class="vs-spacer" style="height:${topPad}px"><td colspan="${colSpan}"></td></tr>`;
        }
        for (let i = start; i <= end; i++) {
            html += GridRenderer.renderRow(_filteredRows[i], columns, i);
        }
        if (bottomPad > 0) {
            html += `<tr class="vs-spacer" style="height:${bottomPad}px"><td colspan="${colSpan}"></td></tr>`;
        }
        html += GridRenderer.renderGhostRow(columns);

        tbody.innerHTML = html;
        _attachListeners();
        SelectionManager.updateHighlight();
        if (typeof CutPaste    !== 'undefined') CutPaste.applyVisual();
        if (typeof FillHandle  !== 'undefined') FillHandle.update();
    }

    // _flagBadgesHtml, _renderRow, _renderCell, _renderGhostRow, _formatLogPreview → GridRenderer (P4-G4)

    function _initVirtualScroll() {
        const container = document.getElementById('grid-scroll-container');
        if (!container) return;
        container.addEventListener('scroll', () => {
            if (_rafPending) return;
            _rafPending = true;
            requestAnimationFrame(() => { _rafPending = false; render(); });
        });
        // Re-render when density changes (--row-h updates)
        new MutationObserver(() => render())
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] });
    }

    // --------------------------------------------------------
    // EVENT LISTENERS
    // --------------------------------------------------------

    function _attachListeners() {
        // Editable cells (select mode by default, edit mode on dblclick)
        document.querySelectorAll(".cell-input[data-editable]").forEach(input => {
            input.addEventListener("focus",    CellKeyboard.onCellFocus);
            input.addEventListener("blur",     CellKeyboard.onCellBlur);
            input.addEventListener("keydown",  CellKeyboard.onCellKeydown);
            input.addEventListener("dblclick", CellKeyboard.onCellDblClick);
            input.addEventListener("paste",    CellKeyboard.onCellPaste);
        });

        // Ghost row — TAG required to create a row
        const ghostTag = document.querySelector("[data-ghost][data-field='tag']");
        if (ghostTag) {
            ghostTag.addEventListener("keydown", CellKeyboard.onGhostKeydown);
            ghostTag.addEventListener("blur",    CellKeyboard.onGhostBlur);
        }

        // Other ghost cells — navigation only
        document.querySelectorAll("[data-ghost]:not([data-field='tag'])").forEach(input => {
            input.addEventListener("keydown", CellKeyboard.onCellKeydown);
        });

        SelectionManager.attachCellListeners();
    }


    // --------------------------------------------------------
    // SEARCH SHORTCUT ( / key focuses search )
    // --------------------------------------------------------

    function scrollToRow(rowIdx) {
        const container = document.getElementById('grid-scroll-container');
        if (!container) return;
        const rowH    = _getRowHeight();
        const headerH = document.querySelector('#data-grid thead')?.offsetHeight || rowH;
        const rowTop  = rowIdx * rowH;
        const viewTop = container.scrollTop + headerH;
        const viewBot = container.scrollTop + container.clientHeight;
        if (rowTop < viewTop) {
            container.scrollTop = Math.max(0, rowTop - headerH);
        } else if (rowTop + rowH > viewBot) {
            container.scrollTop = rowTop + rowH - container.clientHeight;
        }
        render();
    }

    function _initCut() {
        CutPaste.configure({
            getFilteredRows: () => _filteredRows,
            getAllRows:       () => _rows,
            updateRowData,
            render,
        });
        CutPaste.init();
    }

    function _initPasteSpecial() {
        PasteSpecial.configure({
            getFilteredRows: () => _filteredRows,
            updateRowData,
            render,
        });
        PasteSpecial.init();
    }

    function _initFillHandle() {
        FillHandle.configure({
            getFilteredRows: () => _filteredRows,
            getRowHeight:    _getRowHeight,
            updateRowData,
            render,
        });
        FillHandle.init();
    }

    function _initSearchShortcut() {
        document.addEventListener('keydown', e => {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            e.preventDefault();
            const search = document.getElementById('search-input');
            if (search) { search.focus(); search.select(); }
        });
    }

    function _initFindReplace() {
        FindReplace.configure({
            getFilteredRows: () => _filteredRows,
            scrollToRow,
        });
        document.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'h') return;
            if (CellKeyboard.isEditing()) return;
            const active = document.activeElement;
            if (active && active.tagName !== 'BODY' && !active.closest('#data-grid, #grid-scroll-container, #fr-panel')) return;
            e.preventDefault();
            FindReplace.isOpen() ? FindReplace.close() : FindReplace.open();
        });
    }

    function _initAutocomplete() {
        AutoComplete.init();
    }

    function _initSelectAll() {
        document.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'a') return;
            if (CellKeyboard.isEditing()) return;
            const active = document.activeElement;
            // Only intercept when focus is inside the grid or on body
            if (active && active.tagName !== 'BODY' && !active.closest('#data-grid, #grid-scroll-container')) return;
            e.preventDefault();
            SelectionManager.selectAll();
        });
    }


    // --------------------------------------------------------
    // GHOST ROW — creazione riga rapida
    // --------------------------------------------------------

    async function _createFromGhost(tag) {
        if (RevisionPicker.getViewingRevision() !== null) return;
        try {
            const newRow = await ApiClient.createRow({ tag });

            _rows.push(newRow);
            _applyFilters();

            // Scroll to the new row before render so it lands in the virtual window
            const newIndex = _filteredRows.findIndex(r => r.id === newRow.id);
            if (newIndex >= 0) {
                const container = document.getElementById('grid-scroll-container');
                if (container) container.scrollTop = newIndex * _getRowHeight();
            }
            render();

            // Focus the first editable cell of the new row
            setTimeout(() => {
                const newRowEl = document.querySelector(`tr[data-row-id="${newRow.id}"]`);
                if (newRowEl) {
                    const input = newRowEl.querySelector('.cell-input[data-editable]');
                    if (input) { input.focus(); input.select(); }
                }
            }, 0);

            document.dispatchEvent(new CustomEvent('undo:updated'));

        } catch (err) {
            showToast(err.message, "error");
            const ghostTag = document.querySelector("[data-ghost][data-field='tag']");
            if (ghostTag) ghostTag.value = "";
        }
    }

    // _doSaveCell, _updateLogCell → CellSave (P4-G7)

    // softDeleteRow, restoreRow, hardDeleteRow, keepRow, removeOverride, _doRemoveOverride → RowOps (P4-G5)

    // --------------------------------------------------------
    // ROW POSITION HELPERS
    // --------------------------------------------------------

    function _addRowAtPosition(newRow) {
        const pos = newRow.position;
        for (const r of _rows) {
            if (r.position >= pos) r.position++;
        }
        const idx = _rows.findIndex(r => r.position > pos);
        if (idx === -1) _rows.push(newRow);
        else _rows.splice(idx, 0, newRow);
    }

    // --------------------------------------------------------
    // SNAPSHOT / READ-ONLY
    // --------------------------------------------------------

    function loadSnapshotData(columns, rows) {
        ColumnsManager.loadFromData(columns);
        ColumnsManager.renderHeader();
        _rows = rows;
        _searchQuery = "";
        _applyFilters();
        render();
    }

    async function reloadData() {
        await ColumnsManager.loadColumns();
        ColumnsManager.renderHeader();
        _rows = await ApiClient.loadRows(true);
        _searchQuery = "";
        _applyFilters();
        render();
    }

    function setReadOnly(isReadOnly) {
        const container = document.getElementById('tool-container');
        if (container) container.toggleAttribute('data-readonly', isReadOnly);
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
    // CONTEXT MENU — delegated to ContextMenu (P4-G3)
    // --------------------------------------------------------

    // openContextMenu kept as grid.js public API; wires into _renderRow template string.
    function openContextMenu(e, rowId, fromDeleted = false) {
        ContextMenu.open(e, rowId, fromDeleted);
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

        // Sort & filter (column-level filters + multi-level sort)
        if (typeof SortFilterManager !== 'undefined') {
            rows = SortFilterManager.applyToRows(rows);
        }

        _filteredRows = rows;
    }

    function applySort() {
        _applyFilters();
        render();
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

    // Converts a focused cell input into the standard [{row_tag, col_slug}] shape.
    // Returns [] if the input cannot be resolved to a known row.
    function _normalizeCellsFromInput(inputEl) {
        const rowId = parseInt(inputEl.dataset.rowId);
        const field = inputEl.dataset.field;
        const row = _rows.find(r => r.id === rowId);
        if (!row || !field) return [];
        return [{ row_tag: row.tag, col_slug: field }];
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

    function getRowByTag(tag) {
        return _rows.find(r => r.tag === tag) || null;
    }

    function refreshRowDOM(rowId, updatedRow) {
        const idx = _rows.findIndex(r => r.id === rowId);
        if (idx !== -1) _rows[idx] = updatedRow;
        const fidx = _filteredRows.findIndex(r => r.id === rowId);
        if (fidx !== -1) _filteredRows[fidx] = updatedRow;
        CellSave.updateLogCell(rowId, updatedRow.row_log);
        const columns = ColumnsManager.getColumns();
        const rowEl   = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (rowEl) {
            const rowIdx = _filteredRows.findIndex(r => r.id === rowId);
            rowEl.outerHTML = GridRenderer.renderRow(updatedRow, columns, rowIdx);
            _attachListeners();
            SelectionManager.updateHighlight();
        }
    }

    // FLAG SUBMENU HELPERS + removeFlagFromCells → ContextMenu (P4-G3)

    // API PUBBLICA
    // --------------------------------------------------------

    return {
        init,
        render,
        appendRows,
        updateRowData,
        getRowById,
        getRowByTag,
        refreshRowDOM,
        softDeleteRow:       RowOps.softDeleteRow,
        restoreRow:          RowOps.restoreRow,
        hardDeleteRow:       RowOps.hardDeleteRow,
        toggleDeleted,
        toggleLog,
        toggleRev,
        search,
        openContextMenu,
        removeFlagFromCells:  ContextMenu.removeFlagFromCells,
        getRange:            SelectionManager.getFirstRange,
        getRanges:           SelectionManager.getRanges,
        getAllRows:           () => [..._rows],
        clearRange:          SelectionManager.clearRange,
        selectColumn:        SelectionManager.selectColumn,
        selectRow:           SelectionManager.selectRow,
        selectAll:           SelectionManager.selectAll,
        getSelectionForPaste: () => SelectionManager.getSelectionForPaste(_filteredRows),
        loadSnapshotData,
        reloadData,
        setReadOnly,
        scrollToRow,
        getFilteredRows: () => [..._filteredRows],
        applySort,
    };

})();


// showToast — alias globale per compatibilità con chiamate dirette nei template
const showToast = Utils.showToast;