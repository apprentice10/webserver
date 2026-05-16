const PasteSpecial = (() => {

    let _matrix = null;
    let _cfg = {};

    function configure(opts) { _cfg = opts; }

    function init() {
        document.addEventListener('keydown', _onKeydown);
    }

    function _onKeydown(e) {
        if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyV' || !e.shiftKey || e.altKey) return;
        if (CellKeyboard.isEditing()) return;
        const active = document.activeElement;
        if (active && active.tagName !== 'BODY' && !active.closest('#data-grid, #grid-scroll-container')) return;
        e.preventDefault();
        e.stopPropagation();
        open();
    }

    async function open() {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) { showToast('Clipboard is empty.', 'info'); return; }
            _matrix = _parseClipboard(text);
            if (!_matrix.length) { showToast('No data to paste.', 'info'); return; }
            _renderModal();
        } catch (err) {
            showToast('Cannot read clipboard. Try copying your data first.', 'error');
        }
    }

    function close() {
        const overlay = document.getElementById('ps-modal');
        if (overlay) overlay.style.display = 'none';
        _matrix = null;
    }

    async function confirm() {
        if (!_matrix) return;
        const hasHeader = document.getElementById('ps-header-toggle')?.checked ?? false;
        const dataRows  = hasHeader ? _matrix.slice(1) : _matrix;
        if (!dataRows.length) { showToast('No data rows to paste.', 'info'); return; }

        const selects = document.querySelectorAll('.ps-col-select');
        const mapping = [];
        selects.forEach(sel => {
            if (sel.value !== '__ignore__') {
                mapping.push({ incomingIdx: parseInt(sel.dataset.incomingIdx), slug: sel.value });
            }
        });
        if (!mapping.length) { showToast('All columns are set to Ignore.', 'info'); return; }

        const filteredRows = _cfg.getFilteredRows();
        const ranges = SelectionManager.getRanges();
        const startRowIdx = ranges.length > 0
            ? Math.min(ranges[0].start.r, ranges[0].end.r)
            : 0;

        const updates = [];
        for (let ri = 0; ri < dataRows.length; ri++) {
            const rowIdx = startRowIdx + ri;
            if (rowIdx >= filteredRows.length) break;
            const row = filteredRows[rowIdx];
            if (!row || row.is_deleted) continue;
            for (const { incomingIdx, slug } of mapping) {
                if (incomingIdx >= dataRows[ri].length) continue;
                updates.push({ rowId: row.id, slug, value: dataRows[ri][incomingIdx] });
            }
        }

        close();
        if (!updates.length) { showToast('No cells to update.', 'info'); return; }

        showToast(`Updating ${updates.length} cells...`, 'info');
        let okCount = 0;
        const errors = [];
        for (const u of updates) {
            try {
                const upd = await ApiClient.updateCell(u.rowId, u.slug, u.value);
                _cfg.updateRowData(u.rowId, upd);
                okCount++;
            } catch (err) {
                errors.push(`${u.rowId}/${u.slug}: ${err.message}`);
            }
        }
        _cfg.render();
        showToast(
            errors.length ? `${okCount} updated, ${errors.length} errors.` : `${okCount} cells updated.`,
            errors.length ? 'error' : 'success'
        );
    }

    function _renderModal() {
        const overlay = document.getElementById('ps-modal');
        if (!overlay) return;

        const sheetCols   = ColumnsManager.getColumns().filter(c => c.slug !== 'rev' && c.slug !== 'log');
        const hasHeader   = _detectHeaderRow(sheetCols);
        const incomingLen = _matrix[0]?.length ?? 0;

        document.getElementById('ps-header-toggle').checked = hasHeader;
        document.getElementById('ps-preview').innerHTML     = _buildPreview(hasHeader);
        document.getElementById('ps-mapper').innerHTML      = _buildMapper(incomingLen, sheetCols, hasHeader);
        _updateRowCount();

        overlay.style.display = 'flex';
    }

    function _detectHeaderRow(sheetCols) {
        if (!_matrix.length) return false;
        const firstRow = _matrix[0].map(v => v.toLowerCase().trim());
        const colNames = sheetCols.map(c => (c.name || c.slug).toLowerCase().trim());
        return firstRow.some(v => colNames.includes(v));
    }

    function _buildPreview(hasHeader) {
        const rows = _matrix.slice(0, 5);
        const rowsHtml = rows.map((row, ri) => {
            const cls   = (ri === 0 && hasHeader) ? ' class="ps-header-row"' : '';
            const cells = row.map(v => `<td>${Utils.escHtml(String(v))}</td>`).join('');
            return `<tr${cls}>${cells}</tr>`;
        }).join('');
        return `<table class="ps-table">${rowsHtml}</table>`;
    }

    function _buildMapper(incomingLen, sheetCols, hasHeader) {
        const firstRow = _matrix[0] || [];
        const rows = [];
        for (let i = 0; i < incomingLen; i++) {
            const label     = hasHeader ? Utils.escHtml(String(firstRow[i] || `Col ${i + 1}`)) : `Column ${i + 1}`;
            const autoSlug  = hasHeader ? _autoMatch(firstRow[i], sheetCols)
                                        : (i < sheetCols.length ? sheetCols[i].slug : '__ignore__');
            const options   = sheetCols.map(c =>
                `<option value="${Utils.escAttr(c.slug)}"${autoSlug === c.slug ? ' selected' : ''}>${Utils.escHtml(c.name || c.slug)}</option>`
            ).join('');
            rows.push(`
                <div class="ps-map-row">
                    <span class="ps-col-label">${label}</span>
                    <span class="ps-map-arrow">→</span>
                    <select class="ps-col-select" data-incoming-idx="${i}">
                        <option value="__ignore__"${autoSlug === '__ignore__' ? ' selected' : ''}>— Ignore —</option>
                        ${options}
                    </select>
                </div>`);
        }
        return rows.join('');
    }

    function _autoMatch(headerVal, cols) {
        if (!headerVal) return '__ignore__';
        const norm  = String(headerVal).toLowerCase().trim();
        const match = cols.find(c => (c.name || c.slug).toLowerCase().trim() === norm || c.slug.toLowerCase() === norm);
        return match ? match.slug : '__ignore__';
    }

    function _updateRowCount() {
        const hasHeader = document.getElementById('ps-header-toggle')?.checked ?? false;
        const count     = hasHeader ? Math.max(0, (_matrix?.length ?? 0) - 1) : (_matrix?.length ?? 0);
        const el        = document.getElementById('ps-row-count');
        if (el) el.textContent = `${count} data row${count !== 1 ? 's' : ''} will be pasted`;
    }

    function _parseClipboard(text) {
        const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines   = cleaned.split('\n');
        if (lines[lines.length - 1].trim() === '') lines.pop();
        if (!lines.length) return [];
        const sep = lines[0].includes('\t') ? '\t' : ',';
        return lines.map(line => sep === '\t' ? line.split('\t') : _csvSplit(line));
    }

    function _csvSplit(line) {
        const result = [];
        let current = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQ && line[i + 1] === '"') { current += '"'; i++; }
                else inQ = !inQ;
            } else if (ch === ',' && !inQ) { result.push(current.trim()); current = ''; }
            else current += ch;
        }
        result.push(current.trim());
        return result;
    }

    return { configure, init, open, close, confirm, _updateRowCount };

})();
