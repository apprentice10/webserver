const RollbackService = (() => {

    async function _rollbackCell(rowId, colSlug, entryId) {
        try {
            const updated = await HistoryApi.rollbackCell(rowId, colSlug, entryId);
            document.dispatchEvent(new CustomEvent('grid:rowUpdated', { detail: { rowId, row: updated } }));
            Utils.showToast('Value restored', 'success');
            await HistoryPanel.showCellLog(rowId, colSlug, updated);
        } catch (e) {
            Utils.showToast(e.message || 'Rollback failed', 'error');
        }
    }

    function bindRollbackButtons() {
        document.querySelectorAll('.sidebar-log-rollback').forEach(btn => {
            btn.addEventListener('click', async () => {
                const rId     = parseInt(btn.dataset.rowId, 10);
                const col     = btn.dataset.col;
                const entryId = parseInt(btn.dataset.entryId, 10);
                await _rollbackCell(rId, col, entryId);
            });
        });
    }

    return { bindRollbackButtons };

})();
