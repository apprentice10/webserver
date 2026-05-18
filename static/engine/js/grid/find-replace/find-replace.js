const FindReplace = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _panel    = null;
    let _matches  = [];   // [{rowId, rowIdx, colSlug, colIdx}]
    let _matchIdx = -1;
    let _cfg      = {};

    function configure(opts) { _cfg = opts; }

    // --------------------------------------------------------
    // PATTERN BUILDER
    // --------------------------------------------------------

    function _buildPattern(search, matchCase, matchEntire) {
        const escaped = search
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\\*/g, '.*')
            .replace(/\\\?/g, '.');
        return new RegExp(matchEntire ? `^${escaped}$` : escaped, matchCase ? '' : 'i');
    }

    // --------------------------------------------------------
    // MATCH COLLECTION (client-side, on in-memory data)
    // --------------------------------------------------------

    function _collectMatches() {
        const search     = document.getElementById('fr-search')?.value || '';
        if (!search) return [];
        const matchCase  = document.getElementById('fr-match-case')?.checked || false;
        const matchEntire = document.getElementById('fr-match-entire')?.checked || false;
        const selOnly    = document.getElementById('fr-scope')?.value === 'selection';
        const pattern    = _buildPattern(search, matchCase, matchEntire);

        const filteredRows = _cfg.getFilteredRows();
        const allCols      = ColumnsManager.getColumns();
        const editableCols = allCols.filter(c => !c.is_system && c.slug !== 'log' && c.slug !== 'rev');
        const matches      = [];

        if (selOnly) {
            const cells = SelectionManager.getSelectedCells(filteredRows, allCols);
            for (const cell of cells) {
                const ri = filteredRows.findIndex(r => r.tag === cell.row_tag);
                if (ri < 0) continue;
                const row = filteredRows[ri];
                const ci  = allCols.findIndex(c => c.slug === cell.col_slug);
                if (ci < 0) continue;
                if (pattern.test(String(row[cell.col_slug] ?? '')))
                    matches.push({ rowId: row.id, rowIdx: ri, colSlug: cell.col_slug, colIdx: ci });
            }
        } else {
            for (let ri = 0; ri < filteredRows.length; ri++) {
                const row = filteredRows[ri];
                if (row.is_deleted) continue;
                for (const col of editableCols) {
                    if (pattern.test(String(row[col.slug] ?? ''))) {
                        const ci = allCols.findIndex(c => c.slug === col.slug);
                        matches.push({ rowId: row.id, rowIdx: ri, colSlug: col.slug, colIdx: ci });
                    }
                }
            }
        }
        return matches;
    }

    // --------------------------------------------------------
    // FIND ACTIONS
    // --------------------------------------------------------

    function findAll() {
        _matches  = _collectMatches();
        _matchIdx = _matches.length > 0 ? 0 : -1;
        if (!_matches.length) {
            Utils.showToast('No matches found', 'info');
            SelectionManager.clearRange();
            return;
        }
        SelectionManager.setRanges(_matches.map(m => ({
            start: { r: m.rowIdx, c: m.colIdx },
            end:   { r: m.rowIdx, c: m.colIdx },
        })));
        Utils.showToast(`${_matches.length} match${_matches.length === 1 ? '' : 'es'} found`, 'success');
        _cfg.scrollToRow(_matches[0].rowIdx);
    }

    function findNext() {
        _matches = _collectMatches();
        if (!_matches.length) { Utils.showToast('No matches found', 'info'); return; }
        _matchIdx = (_matchIdx + 1) % _matches.length;
        const m = _matches[_matchIdx];
        SelectionManager.collapseToCell(m.rowIdx, m.colIdx);
        _cfg.scrollToRow(m.rowIdx);
    }

    // --------------------------------------------------------
    // REPLACE ACTIONS
    // --------------------------------------------------------

    function _getFormValues() {
        return {
            search:      document.getElementById('fr-search')?.value || '',
            replacement: document.getElementById('fr-replace')?.value || '',
            matchCase:   document.getElementById('fr-match-case')?.checked || false,
            matchEntire: document.getElementById('fr-match-entire')?.checked || false,
            selOnly:     document.getElementById('fr-scope')?.value === 'selection',
        };
    }

    async function replaceAll() {
        const { search, replacement, matchCase, matchEntire, selOnly } = _getFormValues();
        if (!search) return;
        let scope = null;
        if (selOnly) {
            const filteredRows = _cfg.getFilteredRows();
            scope = SelectionManager.getSelectedCells(filteredRows, ColumnsManager.getColumns())
                .map(c => {
                    const row = filteredRows.find(r => r.tag === c.row_tag);
                    return row ? { row_id: row.id, col_slug: c.col_slug } : null;
                })
                .filter(Boolean);
        }
        try {
            const result = await ApiClient.findReplace({
                search, replacement,
                match_case: matchCase, match_entire_cell: matchEntire, scope,
            });
            for (const row of (result.rows || [])) GridManager.refreshRowDOM(row.id, row);
            _matches = []; _matchIdx = -1;
            Utils.showToast(`${result.count} cell${result.count === 1 ? '' : 's'} replaced`, 'success');
        } catch (err) {
            Utils.showToast(err.message || 'Replace failed', 'error');
        }
    }

    async function replaceCurrent() {
        if (!_matches.length) { findNext(); return; }
        const idx = _matchIdx < 0 ? 0 : _matchIdx;
        const m   = _matches[idx];
        const { search, replacement, matchCase, matchEntire } = _getFormValues();
        try {
            const result = await ApiClient.findReplace({
                search, replacement,
                match_case: matchCase, match_entire_cell: matchEntire,
                scope: [{ row_id: m.rowId, col_slug: m.colSlug }],
            });
            for (const row of (result.rows || [])) GridManager.refreshRowDOM(row.id, row);
            _matches.splice(idx, 1);
            if (_matches.length) {
                _matchIdx = Math.min(idx, _matches.length - 1);
                const next = _matches[_matchIdx];
                SelectionManager.collapseToCell(next.rowIdx, next.colIdx);
                _cfg.scrollToRow(next.rowIdx);
            } else {
                _matchIdx = -1;
                Utils.showToast('All replacements done', 'success');
            }
        } catch (err) {
            Utils.showToast(err.message || 'Replace failed', 'error');
        }
    }

    // --------------------------------------------------------
    // PANEL BUILD
    // --------------------------------------------------------

    function _makeDraggable(panel, handle) {
        let ox = 0, oy = 0, mx = 0, my = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ox = panel.offsetLeft; oy = panel.offsetTop;
            mx = e.clientX;        my = e.clientY;
            const move = ev => { panel.style.left = (ox + ev.clientX - mx) + 'px'; panel.style.top = (oy + ev.clientY - my) + 'px'; };
            const stop = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });
    }

    function _buildPanel() {
        const div = document.createElement('div');
        div.id = 'fr-panel';
        div.className = 'fr-panel';
        div.innerHTML = `
            <div class="fr-header" id="fr-header">
                <span>Find &amp; Replace</span>
                <button class="fr-close" id="fr-close" title="Close (Esc)">✕</button>
            </div>
            <div class="fr-body">
                <div class="fr-row">
                    <label class="fr-label">Find</label>
                    <input id="fr-search" class="fr-input" placeholder="Search… (* ? wildcards)" autocomplete="off" />
                </div>
                <div class="fr-row">
                    <label class="fr-label">Replace</label>
                    <input id="fr-replace" class="fr-input" placeholder="Replacement value" autocomplete="off" />
                </div>
                <div class="fr-options">
                    <label class="fr-opt"><input type="checkbox" id="fr-match-case"> Case</label>
                    <label class="fr-opt"><input type="checkbox" id="fr-match-entire"> Entire cell</label>
                    <select id="fr-scope" class="fr-select">
                        <option value="sheet">Entire sheet</option>
                        <option value="selection">Selection</option>
                    </select>
                </div>
                <div class="fr-actions">
                    <button class="btn btn-ghost btn-sm" id="fr-btn-find-next">Find Next</button>
                    <button class="btn btn-ghost btn-sm" id="fr-btn-find-all">Find All</button>
                    <button class="btn btn-ghost btn-sm" id="fr-btn-replace">Replace</button>
                    <button class="btn btn-sm" id="fr-btn-replace-all">Replace All</button>
                </div>
            </div>`;
        document.body.appendChild(div);

        div.querySelector('#fr-close').addEventListener('click', close);
        div.querySelector('#fr-btn-find-next').addEventListener('click', findNext);
        div.querySelector('#fr-btn-find-all').addEventListener('click', findAll);
        div.querySelector('#fr-btn-replace').addEventListener('click', replaceCurrent);
        div.querySelector('#fr-btn-replace-all').addEventListener('click', replaceAll);

        div.querySelector('#fr-search').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); findNext(); }
            if (e.key === 'Escape') close();
        });
        div.querySelector('#fr-replace').addEventListener('keydown', e => {
            if (e.key === 'Escape') close();
        });

        _makeDraggable(div, div.querySelector('#fr-header'));
        return div;
    }

    // --------------------------------------------------------
    // PUBLIC
    // --------------------------------------------------------

    function open() {
        if (!_panel) _panel = _buildPanel();
        _panel.style.display = 'flex';
        _matches = []; _matchIdx = -1;
        setTimeout(() => document.getElementById('fr-search')?.focus(), 0);
    }

    function close() {
        if (_panel) _panel.style.display = 'none';
        _matches = []; _matchIdx = -1;
    }

    function isOpen() {
        return !!(_panel && _panel.style.display !== 'none');
    }

    return { configure, open, close, isOpen };

})();
