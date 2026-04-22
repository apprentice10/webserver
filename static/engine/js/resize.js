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
        });
    }


    // --------------------------------------------------------
    // DRAG HANDLERS
    // --------------------------------------------------------

    function _onMouseDown(e) {
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
    }

    function _onMouseMove(e) {
        if (!_dragging) return;

        const delta    = e.clientX - _startX;
        const newWidth = Math.max(40, Math.min(_startWidth + delta, 800));

        // Aggiorna visivamente in tempo reale
        _thElement.style.width = newWidth + "px";

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
    // API PUBBLICA
    // --------------------------------------------------------

    return { init };

})();