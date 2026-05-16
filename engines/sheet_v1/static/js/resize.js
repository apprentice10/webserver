/**
 * resize.js — Engine
 * -------------------
 * Gestisce il ridimensionamento colonne via drag.
 *
 * Funzionamento:
 * - mousedown su .resize-handle → inizia drag
 * - mousemove → aggiorna larghezza colonna in tempo reale
 * - mouseup → salva la nuova larghezza nel backend
 */

const ResizeManager = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _dragging    = false;
    let _columnId    = null;
    let _startX      = 0;
    let _startWidth  = 0;
    let _thElement   = null;
    let _saveTimeout = null;


    // --------------------------------------------------------
    // INIT — attacca listener a tutti i resize handle
    // --------------------------------------------------------

    function init() {
        document.querySelectorAll(".resize-handle").forEach(handle => {
            // Rimuove listener precedenti clonando il nodo
            const fresh = handle.cloneNode(true);
            handle.parentNode.replaceChild(fresh, handle);

            fresh.addEventListener("mousedown", _onMouseDown);
            fresh.addEventListener("dblclick",  _onDoubleClick);
        });
    }


    // --------------------------------------------------------
    // DRAG HANDLERS
    // --------------------------------------------------------

    function _onMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        _dragging   = true;
        _columnId   = parseInt(this.dataset.columnId);
        _startX     = e.clientX;
        _thElement  = this.closest("th");
        _startWidth = _thElement.offsetWidth;

        this.classList.add("resizing");

        // Cursore globale durante il drag
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        document.addEventListener("mousemove", _onMouseMove);
        document.addEventListener("mouseup", _onMouseUp);
        document.addEventListener("dragstart", _preventDrag);
    }

    function _preventDrag(e) {
        e.preventDefault();
    }

    function _onMouseMove(e) {
        if (!_dragging) return;

        const delta    = e.clientX - _startX;
        const newWidth = Math.max(20, _startWidth + delta);

        // Aggiorna visivamente in tempo reale
        _thElement.style.width = newWidth + "px";
        syncTableWidth();

        // Aggiorna stato locale
        ColumnsManager.updateLocalWidth(_columnId, newWidth);
    }

    function _onMouseUp(e) {
        if (!_dragging) return;

        _dragging = false;

        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        document.querySelectorAll(".resize-handle.resizing")
            .forEach(h => h.classList.remove("resizing"));

        document.removeEventListener("mousemove", _onMouseMove);
        document.removeEventListener("mouseup", _onMouseUp);
        document.removeEventListener("dragstart", _preventDrag);

        // Salva nel backend con debounce
        const finalWidth = _thElement.offsetWidth;
        clearTimeout(_saveTimeout);
        _saveTimeout = setTimeout(async () => {
            try {
                await ApiClient.updateColumnWidth(_columnId, finalWidth);
            } catch (err) {
                console.warn("Errore salvataggio larghezza colonna:", err.message);
            }
        }, 400);
    }


    // --------------------------------------------------------
    // AUTO-FIT (double-click su resize-handle)
    // --------------------------------------------------------

    function _onDoubleClick(e) {
        e.preventDefault();
        e.stopPropagation();

        const th       = this.closest("th");
        const slug     = th.dataset.slug;
        const columnId = parseInt(this.dataset.columnId);

        const values = [];

        const label = th.querySelector(".th-label");
        if (label) values.push(label.textContent.trim());

        document.querySelectorAll(`input[data-field="${CSS.escape(slug)}"]`).forEach(input => {
            if (input.value) values.push(input.value);
        });

        const refEl  = document.querySelector(".cell-input") || th;
        const fitted = _measureMaxTextWidth(values, refEl);
        const newWidth = Math.max(20, fitted + 24);

        th.style.width = newWidth + "px";
        syncTableWidth();
        ColumnsManager.updateLocalWidth(columnId, newWidth);

        ApiClient.updateColumnWidth(columnId, newWidth).catch(err => {
            console.warn("Errore auto-fit larghezza colonna:", err.message);
        });
    }

    function _measureMaxTextWidth(values, refEl) {
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;top:-9999px;left:-9999px";
        if (refEl) {
            const cs = window.getComputedStyle(refEl);
            probe.style.font        = cs.font;
            probe.style.letterSpacing = cs.letterSpacing;
        }
        document.body.appendChild(probe);

        let max = 0;
        for (const v of values) {
            probe.textContent = v;
            max = Math.max(max, probe.getBoundingClientRect().width);
        }

        document.body.removeChild(probe);
        return Math.ceil(max);
    }


    // --------------------------------------------------------
    // FIT ALL COLUMNS
    // --------------------------------------------------------

    function fitAll() {
        const refEl = document.querySelector(".cell-input");
        document.querySelectorAll("th[data-column-id]").forEach(th => {
            const columnId = parseInt(th.dataset.columnId);
            const slug     = th.dataset.slug;
            const values   = [];

            const label = th.querySelector(".th-label");
            if (label) values.push(label.textContent.trim());

            document.querySelectorAll(`input[data-field="${CSS.escape(slug)}"]`).forEach(inp => {
                if (inp.value) values.push(inp.value);
            });

            const fitted   = _measureMaxTextWidth(values, refEl || th);
            const newWidth = Math.max(20, fitted + 24);

            th.style.width = newWidth + "px";
            ColumnsManager.updateLocalWidth(columnId, newWidth);

            ApiClient.updateColumnWidth(columnId, newWidth).catch(err => {
                console.warn("Auto-fit error:", err.message);
            });
        });
        syncTableWidth();
    }


    // --------------------------------------------------------
    // TABLE WIDTH SYNC
    // --------------------------------------------------------

    // Without an explicit pixel width on <table>, table-layout:fixed ignores
    // per-th widths and redistributes space — making it impossible to shrink a
    // column below its current rendered size.
    function syncTableWidth() {
        const headerRow = document.getElementById("grid-header-row");
        if (!headerRow) return;
        let total = 0;
        const gutter = headerRow.querySelector(".col-gutter");
        if (gutter) total += gutter.offsetWidth;
        headerRow.querySelectorAll("th[data-column-id]").forEach(th => {
            const w = parseInt(th.style.width);
            if (!isNaN(w)) total += w;
        });
        const table = document.querySelector("table.data-grid");
        if (table) table.style.width = total + "px";
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return { init, fitAll, syncTableWidth };

})();