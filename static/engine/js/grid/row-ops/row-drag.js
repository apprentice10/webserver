/**
 * row-ops/row-drag.js — RowDrag
 * Drag-to-reorder rows via the ≡ handle in the row gutter.
 * Drag starts only from .gutter-drag-handle; click-to-select is unaffected.
 */

const RowDrag = (() => {

    let _reloadData = () => {};

    let _isDragging = false;
    let _dragRowId  = null;
    let _indicator  = null;
    let _targetTr   = null;
    let _dropBefore = true;

    // Minimum pixel movement before drag is considered active
    const DRAG_THRESHOLD = 5;
    let _startY = 0;
    let _started = false;

    function configure(deps) {
        _reloadData = deps.reloadData || (() => {});
    }

    function init() {
        const table = document.getElementById("data-grid");
        if (!table) return;
        table.addEventListener("mousedown", _onMousedown);
    }

    function _onMousedown(e) {
        if (!e.target.closest(".gutter-drag-handle")) return;
        const tr = e.target.closest("tr[data-row-id]");
        if (!tr) return;
        e.preventDefault();
        e.stopPropagation();

        _dragRowId  = parseInt(tr.dataset.rowId, 10);
        _startY     = e.clientY;
        _started    = false;
        _isDragging = true;

        document.addEventListener("mousemove", _onMousemove);
        document.addEventListener("mouseup",   _onMouseup);
    }

    function _onMousemove(e) {
        if (!_isDragging) return;

        if (!_started) {
            if (Math.abs(e.clientY - _startY) < DRAG_THRESHOLD) return;
            _started = true;
            _indicator = document.createElement("div");
            _indicator.className = "row-drop-indicator";
            document.body.appendChild(_indicator);
        }

        const rows = Array.from(
            document.querySelectorAll("#data-grid tbody tr[data-row-id]:not(.row-deleted)")
        );
        if (!rows.length) return;

        let bestTr   = null;
        let bestDist = Infinity;
        for (const tr of rows) {
            if (parseInt(tr.dataset.rowId, 10) === _dragRowId) continue;
            const rect = tr.getBoundingClientRect();
            const mid  = rect.top + rect.height / 2;
            const dist = Math.abs(e.clientY - mid);
            if (dist < bestDist) { bestDist = dist; bestTr = tr; }
        }
        if (!bestTr) return;

        _targetTr   = bestTr;
        const rect  = bestTr.getBoundingClientRect();
        const mid   = rect.top + rect.height / 2;
        _dropBefore = e.clientY < mid;

        const lineY = _dropBefore ? rect.top : rect.bottom;
        _indicator.style.top   = (lineY + window.scrollY) + "px";
        _indicator.style.left  = rect.left + "px";
        _indicator.style.width = rect.width + "px";
    }

    async function _onMouseup() {
        document.removeEventListener("mousemove", _onMousemove);
        document.removeEventListener("mouseup",   _onMouseup);

        if (_indicator) { _indicator.remove(); _indicator = null; }

        if (!_started || !_targetTr) {
            _reset();
            return;
        }

        const dragRowId   = _dragRowId;
        const anchorRowId = parseInt(_targetTr.dataset.rowId, 10);
        const placement   = _dropBefore ? "before" : "after";
        _reset();

        if (dragRowId === anchorRowId) return;

        try {
            await ApiClient.reorderRow(dragRowId, anchorRowId, placement);
            await _reloadData();
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    function _reset() {
        _isDragging = false;
        _dragRowId  = null;
        _targetTr   = null;
        _started    = false;
    }

    return { configure, init };

})();
