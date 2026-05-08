const EtlCanvasPreview = (() => {

    let _panelEl = null;
    let _bodyEl  = null;
    let _titleEl = null;

    function _els() {
        if (!_panelEl) {
            _panelEl = document.getElementById('ecv-preview-panel');
            _bodyEl  = document.getElementById('ecv-preview-body');
            _titleEl = document.getElementById('ecv-preview-title');
        }
    }

    function _esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _position(x, y) {
        _els();
        if (!_panelEl) return;
        const wrap = document.getElementById('ecv-canvas-wrap');
        const maxX = (wrap ? wrap.offsetWidth  : 800) - 500;
        const maxY = (wrap ? wrap.offsetHeight : 600) - 340;
        _panelEl.style.left    = Math.max(8, Math.min(x + 10, maxX)) + 'px';
        _panelEl.style.top     = Math.max(8, Math.min(y - 30, maxY)) + 'px';
        _panelEl.style.display = 'flex';
    }

    function _tableHtml(data) {
        const cols = data.columns || [];
        const rows = (data.rows || []).slice(0, 50);
        if (cols.length === 0) return '<div class="ecv-pv-empty">No columns returned.</div>';
        const head  = `<tr>${cols.map(c => `<th>${_esc(c)}</th>`).join('')}</tr>`;
        const tbody = rows.map(r => `<tr>${cols.map(c => `<td>${_esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('');
        const warn  = (data.warnings || []).length ? ` · ⚠ ${_esc(data.warnings[0])}` : '';
        return `<div class="ecv-pv-info">${data.row_count} row(s)${warn}</div>
<div class="ecv-pv-scroll"><table class="ecv-pv-table"><thead>${head}</thead><tbody>${tbody}</tbody></table></div>`;
    }

    function show(data, x, y, fromId) {
        _els();
        if (!_panelEl) return;
        _position(x, y);
        if (_titleEl) _titleEl.textContent = `Preview: ${fromId}`;
        if (!_bodyEl) return;
        if (data === null) {
            _bodyEl.innerHTML = '<div class="ecv-pv-loading">Running preview…</div>';
        } else {
            _bodyEl.innerHTML = _tableHtml(data);
        }
    }

    function showError(msg, x, y) {
        _els();
        if (!_panelEl) return;
        _position(x, y);
        if (_titleEl) _titleEl.textContent = 'Preview Error';
        if (_bodyEl) _bodyEl.innerHTML = `<div class="ecv-pv-err">${_esc(msg)}</div>`;
    }

    function close() {
        _els();
        if (_panelEl) _panelEl.style.display = 'none';
    }

    return { show, showError, close };

})();
