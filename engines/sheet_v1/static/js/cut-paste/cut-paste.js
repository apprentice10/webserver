const CutPaste = (() => {

    // [{rowId, row_tag, col_slug, value}] | null
    let _cutCells = null;
    let _cfg = {};

    function configure(opts) { _cfg = opts; }

    function isActive() { return _cutCells !== null; }

    function cancelCut() {
        if (!_cutCells) return;
        _cutCells = null;
        _cfg.render();
    }

    // Applies .cell-cut CSS class to all TDs that are in cut state.
    // Called after every render() to mark the newly created DOM elements.
    function applyVisual() {
        if (!_cutCells) {
            document.querySelectorAll('td.cell-cut').forEach(td => td.classList.remove('cell-cut'));
            return;
        }
        const cutSet = new Set(_cutCells.map(c => `${c.rowId}|${c.col_slug}`));
        document.querySelectorAll('input.cell-input').forEach(input => {
            const key = `${input.dataset.rowId}|${input.dataset.field}`;
            const td = input.closest('td');
            if (td) td.classList.toggle('cell-cut', cutSet.has(key));
        });
    }

    function init() {
        document.addEventListener('keydown', _onKeydown, true);
        // capture=true so we run before PasteManager when cut is active
        document.addEventListener('paste', _onPaste, true);
    }

    function _onKeydown(e) {
        // Cancel cut on Escape (only when not in cell edit mode — Escape in edit mode cancels the edit, not the cut)
        if (!e.ctrlKey && !e.metaKey && _cutCells && e.key === 'Escape' && !CellKeyboard.isEditing()) {
            cancelCut();
            return;
        }

        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        if (e.code !== 'KeyX') return;
        if (CellKeyboard.isEditing()) return;

        const active = document.activeElement;
        if (active && active.tagName !== 'BODY' && !active.closest('#data-grid, #grid-scroll-container')) return;

        const filteredRows = _cfg.getFilteredRows();
        const columns = ColumnsManager.getColumns();
        const selected = SelectionManager.getSelectedCells(filteredRows, columns);
        if (!selected.length) return;

        e.preventDefault();

        const allRows = _cfg.getAllRows();
        const rowMap = new Map(allRows.map(r => [r.tag, r]));
        _cutCells = selected.map(({ row_tag, col_slug }) => {
            const row = rowMap.get(row_tag);
            return {
                rowId:    row ? row.id : null,
                row_tag,
                col_slug,
                value:    row ? (row[col_slug] ?? '') : '',
            };
        });

        _copyToClipboard(filteredRows, columns);
        _cfg.render();
    }

    async function _onPaste(e) {
        if (!_cutCells) return;
        if (CellKeyboard.isEditing()) return;

        const active = document.activeElement;
        if (!active || !active.classList.contains('cell-input') || active.dataset.ghost) {
            cancelCut();
            return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();

        const anchorRowId  = parseInt(active.dataset.rowId);
        const anchorField  = active.dataset.field;
        const filteredRows = _cfg.getFilteredRows();
        const allRows      = _cfg.getAllRows();
        const editableCols = ColumnsManager.getColumns().filter(c => c.slug !== 'rev' && c.slug !== 'log');

        const anchorRowIdx = filteredRows.findIndex(r => r.id === anchorRowId);
        const anchorColIdx = editableCols.findIndex(c => c.slug === anchorField);
        if (anchorRowIdx === -1 || anchorColIdx === -1) { cancelCut(); return; }

        const tagToRowIdx  = new Map(filteredRows.map((r, i) => [r.tag, i]));
        const slugToColIdx = new Map(editableCols.map((c, i) => [c.slug, i]));

        // Compute top-left of the cut region (in editable-col coordinates)
        let srcMinRow = Infinity, srcMinCol = Infinity;
        for (const c of _cutCells) {
            const ri = tagToRowIdx.get(c.row_tag);
            const ci = slugToColIdx.get(c.col_slug);
            if (ri !== undefined && ri < srcMinRow) srcMinRow = ri;
            if (ci !== undefined && ci < srcMinCol) srcMinCol = ci;
        }

        const updates = [];
        for (const c of _cutCells) {
            const srcRowIdx = tagToRowIdx.get(c.row_tag);
            const srcColIdx = slugToColIdx.get(c.col_slug);
            if (srcRowIdx === undefined || srcColIdx === undefined) continue;
            const destRowIdx = anchorRowIdx + (srcRowIdx - srcMinRow);
            const destColIdx = anchorColIdx + (srcColIdx - srcMinCol);
            if (destRowIdx >= filteredRows.length || destColIdx >= editableCols.length) continue;
            const destRow = filteredRows[destRowIdx];
            if (!destRow || destRow.is_deleted) continue;
            updates.push({
                destRowId: destRow.id,
                destSlug:  editableCols[destColIdx].slug,
                value:     c.value,
                srcRowId:  c.rowId,
                srcSlug:   c.col_slug,
            });
        }

        const savedCutCells = _cutCells;
        _cutCells = null;

        if (!updates.length) { _cfg.render(); return; }

        showToast(`Pasting ${updates.length} cell${updates.length > 1 ? 's' : ''}...`, 'info');

        let okCount = 0;
        const errors = [];
        for (const u of updates) {
            try {
                const upd = await ApiClient.updateCell(u.destRowId, u.destSlug, u.value);
                _cfg.updateRowData(u.destRowId, upd);
                okCount++;
            } catch (err) {
                errors.push(`${u.destRowId}/${u.destSlug}: ${err.message}`);
            }
        }

        // Clear source cells not overlapping with the destination
        const destKeys = new Set(updates.map(u => `${u.destRowId}|${u.destSlug}`));
        for (const c of savedCutCells) {
            if (!c.rowId) continue;
            if (destKeys.has(`${c.rowId}|${c.col_slug}`)) continue;
            const srcRow = allRows.find(r => r.id === c.rowId);
            if (!srcRow || srcRow.is_deleted) continue;
            try {
                const upd = await ApiClient.updateCell(c.rowId, c.col_slug, '');
                _cfg.updateRowData(c.rowId, upd);
            } catch (err) {
                errors.push(`clear ${c.rowId}/${c.col_slug}: ${err.message}`);
            }
        }

        _cfg.render();
        showToast(
            errors.length ? `${okCount} pasted, ${errors.length} errors.` : `${okCount} cell${okCount > 1 ? 's' : ''} pasted.`,
            errors.length ? 'error' : 'success'
        );
    }

    function _copyToClipboard(filteredRows, columns) {
        const editableCols = columns.filter(c => c.slug !== 'rev' && c.slug !== 'log');
        const tagToRowIdx  = new Map(filteredRows.map((r, i) => [r.tag, i]));
        const slugToColIdx = new Map(editableCols.map((c, i) => [c.slug, i]));

        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const c of _cutCells) {
            const ri = tagToRowIdx.get(c.row_tag) ?? 0;
            const ci = slugToColIdx.get(c.col_slug) ?? 0;
            if (ri < minR) minR = ri; if (ri > maxR) maxR = ri;
            if (ci < minC) minC = ci; if (ci > maxC) maxC = ci;
        }
        if (minR === Infinity) return;

        const cellMap = new Map(_cutCells.map(c => [
            `${tagToRowIdx.get(c.row_tag) ?? 0}|${slugToColIdx.get(c.col_slug) ?? 0}`,
            c.value,
        ]));

        const lines = [];
        for (let r = minR; r <= maxR; r++) {
            const cols = [];
            for (let c = minC; c <= maxC; c++) cols.push(cellMap.get(`${r}|${c}`) ?? '');
            lines.push(cols.join('\t'));
        }
        navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    }

    return { configure, init, isActive, applyVisual, cancelCut };

})();
