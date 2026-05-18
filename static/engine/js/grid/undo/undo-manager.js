const UndoManager = (() => {

    let _canUndo = false;
    let _canRedo = false;

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    function _updateButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) btnUndo.disabled = !_canUndo;
        if (btnRedo) btnRedo.disabled = !_canRedo;
    }

    function _applyState(state) {
        _canUndo = !!state.can_undo;
        _canRedo = !!state.can_redo;
        _updateButtons();
    }

    async function refreshState() {
        try {
            const s = await ApiClient.getUndoState();
            _applyState(s);
        } catch (_) { /* ignore */ }
    }

    // --------------------------------------------------------
    // OPERATIONS
    // --------------------------------------------------------

    async function undo() {
        if (!_canUndo) return;
        try {
            const result = await ApiClient.undo();
            _applyState(result);
            await GridManager.init();
            showToast('Undo applied.', 'success');
        } catch (e) {
            showToast('Undo: ' + e.message, 'error');
        }
    }

    async function redo() {
        if (!_canRedo) return;
        try {
            const result = await ApiClient.redo();
            _applyState(result);
            await GridManager.init();
            showToast('Redo applied.', 'success');
        } catch (e) {
            showToast('Redo: ' + e.message, 'error');
        }
    }

    // --------------------------------------------------------
    // KEYBOARD
    // --------------------------------------------------------

    function _onKeyDown(e) {
        if (!(e.ctrlKey || e.metaKey)) return;

        // Let the browser handle Ctrl+Z inside text inputs (cell edit mode)
        if (CellKeyboard.isEditing()) return;

        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            redo();
        }
    }

    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    function init() {
        document.addEventListener('keydown', _onKeyDown);
        // Refresh state whenever any grid data operation completes
        document.addEventListener('undo:updated', refreshState);
        refreshState();
    }

    return { init, undo, redo, refreshState };
})();
