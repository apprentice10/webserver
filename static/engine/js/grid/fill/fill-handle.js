const FillHandle = (() => {

    const HANDLE_PX = 7;

    let _handle    = null;
    let _indicator = null;
    let _isDragging = false;
    let _selBounds  = null; // {top, left, bottom, right} viewport coords of full selection
    let _cfg = {};

    function configure(opts) { _cfg = opts; }

    function init() {
        _handle = document.createElement('div');
        _handle.className = 'fill-handle';
        _handle.title = 'Drag to fill';
        document.body.appendChild(_handle);

        _indicator = document.createElement('div');
        _indicator.className = 'fill-indicator';
        document.body.appendChild(_indicator);

        _handle.addEventListener('mousedown', _onMousedown);
        // Update fill handle position after any mouseup (selection drag end, clicks, etc.)
        document.addEventListener('mouseup', () => { if (!_isDragging) update(); });
    }

    // Called after every render() + updateHighlight().
    // Positions the handle at the bottom-right corner of the selection.
    function update() {
        if (!_handle || _isDragging) return;
        const tds = document.querySelectorAll('td.cell-selected');
        if (!tds.length) { _handle.style.display = 'none'; return; }

        let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
        tds.forEach(td => {
            const r = td.getBoundingClientRect();
            if (r.top    < top)    top    = r.top;
            if (r.left   < left)   left   = r.left;
            if (r.bottom > bottom) bottom = r.bottom;
            if (r.right  > right)  right  = r.right;
        });

        _selBounds = { top, left, bottom, right };
        _handle.style.left    = `${right  - HANDLE_PX / 2}px`;
        _handle.style.top     = `${bottom - HANDLE_PX / 2}px`;
        _handle.style.display = 'block';
    }

    function _onMousedown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof CutPaste !== 'undefined') CutPaste.cancelCut();
        _isDragging = true;
        _indicator.style.display = 'block';
        document.addEventListener('mousemove', _onMousemove);
        document.addEventListener('mouseup', _onMouseup);
    }

    function _onMousemove(e) {
        if (!_isDragging || !_selBounds) return;
        const dx = e.clientX - _selBounds.right;
        const dy = e.clientY - _selBounds.bottom;
        const fillDown = dy >= dx;
        if (fillDown) {
            _indicator.style.left   = `${_selBounds.left}px`;
            _indicator.style.top    = `${_selBounds.top}px`;
            _indicator.style.width  = `${_selBounds.right - _selBounds.left}px`;
            _indicator.style.height = `${Math.max(0, e.clientY - _selBounds.top)}px`;
        } else {
            _indicator.style.left   = `${_selBounds.left}px`;
            _indicator.style.top    = `${_selBounds.top}px`;
            _indicator.style.width  = `${Math.max(0, e.clientX - _selBounds.left)}px`;
            _indicator.style.height = `${_selBounds.bottom - _selBounds.top}px`;
        }
    }

    async function _onMouseup(e) {
        if (!_isDragging) return;
        _isDragging = false;
        _indicator.style.display = 'none';
        document.removeEventListener('mousemove', _onMousemove);
        document.removeEventListener('mouseup', _onMouseup);
        if (!_selBounds) return;

        const ranges = SelectionManager.getRanges();
        if (!ranges.length) return;
        const r0 = ranges[0];
        const rMin = Math.min(r0.start.r, r0.end.r);
        const rMax = Math.max(r0.start.r, r0.end.r);
        const cMin = Math.min(r0.start.c, r0.end.c);
        const cMax = Math.max(r0.start.c, r0.end.c);

        const dx = e.clientX - _selBounds.right;
        const dy = e.clientY - _selBounds.bottom;
        const fillDown = dy >= dx;

        // Determine how many extra rows/cols to fill via elementFromPoint
        let fillCount = 0;
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const targetTd = targetEl?.closest('td[data-row-idx]');

        if (fillDown) {
            if (targetTd) {
                fillCount = Math.max(0, parseInt(targetTd.dataset.rowIdx) - rMax);
            } else {
                fillCount = Math.max(0, Math.floor((e.clientY - _selBounds.bottom) / _cfg.getRowHeight()));
            }
        } else {
            if (targetTd) {
                fillCount = Math.max(0, parseInt(targetTd.dataset.colIdx) - cMax);
            } else {
                const approxColW = (_selBounds.right - _selBounds.left) / Math.max(1, cMax - cMin + 1);
                fillCount = Math.max(0, Math.floor((e.clientX - _selBounds.right) / approxColW));
            }
        }

        if (!fillCount) { update(); return; }

        const filteredRows = _cfg.getFilteredRows();
        const allCols      = ColumnsManager.getColumns();
        const fillCells    = [];

        if (fillDown) {
            for (let c = cMin; c <= cMax; c++) {
                const colObj = allCols[c];
                if (!colObj || colObj.slug === 'rev' || colObj.slug === 'log') continue;
                const srcVals = [];
                for (let r = rMin; r <= rMax; r++) {
                    const row = filteredRows[r];
                    if (row) srcVals.push(row[colObj.slug] ?? '');
                }
                const step = _detectStep(srcVals);
                for (let i = 1; i <= fillCount; i++) {
                    const destRow = filteredRows[rMax + i];
                    if (!destRow || destRow.is_deleted) continue;
                    fillCells.push({ row_id: destRow.id, col_slug: colObj.slug, value: _fillValue(srcVals, step, i) });
                }
            }
        } else {
            for (let r = rMin; r <= rMax; r++) {
                const row = filteredRows[r];
                if (!row || row.is_deleted) continue;
                const srcVals = [];
                for (let c = cMin; c <= cMax; c++) {
                    const colObj = allCols[c];
                    if (colObj && colObj.slug !== 'rev' && colObj.slug !== 'log') {
                        srcVals.push(row[colObj.slug] ?? '');
                    }
                }
                const step = _detectStep(srcVals);
                let filled = 0;
                for (let c = cMax + 1; c < allCols.length && filled < fillCount; c++) {
                    const colObj = allCols[c];
                    if (!colObj || colObj.slug === 'rev' || colObj.slug === 'log') continue;
                    filled++;
                    fillCells.push({ row_id: row.id, col_slug: colObj.slug, value: _fillValue(srcVals, step, filled) });
                }
            }
        }

        if (!fillCells.length) { update(); return; }

        showToast(`Filling ${fillCells.length} cell${fillCells.length > 1 ? 's' : ''}...`, 'info');
        try {
            const res = await ApiClient.batchUpdate(fillCells);
            for (const row of res.updated) _cfg.updateRowData(row.id, row);
            _cfg.render();
            showToast(`${res.updated.length} cell${res.updated.length !== 1 ? 's' : ''} filled.`, 'success');
        } catch (err) {
            _cfg.render();
            showToast(`Fill failed: ${err.message}`, 'error');
        }
    }

    // Returns the numeric step if all consecutive diffs are equal, else null.
    function _detectStep(vals) {
        if (vals.length < 2) return null;
        const nums = vals.map(Number);
        if (nums.some(isNaN)) return null;
        const diffs = [];
        for (let i = 1; i < nums.length; i++) diffs.push(nums[i] - nums[i - 1]);
        return diffs.every(d => d === diffs[0]) ? diffs[0] : null;
    }

    function _fillValue(srcVals, step, i) {
        if (!srcVals.length) return '';
        const lastVal = srcVals[srcVals.length - 1];
        const lastNum = Number(lastVal);
        if (!isNaN(lastNum) && String(lastVal).trim() !== '') {
            // Detected step or single-cell → increment
            const inc = step !== null ? step : 1;
            const dec = (String(lastVal).split('.')[1] || '').length;
            const result = lastNum + inc * i;
            return dec > 0 ? result.toFixed(dec) : String(result);
        }
        // Text: repeat cyclically
        return srcVals[i % srcVals.length];
    }

    return { configure, init, update };

})();
