const RowOps = (() => {

    // Injected by configure()
    let _getRows             = () => [];
    let _getFilteredRows     = () => [];
    let _updateRow           = () => {};  // (id, data) → updates _rows[idx] only
    let _removeRows          = () => {};  // (idSet)    → filters both arrays
    let _applyFilters        = () => {};
    let _render              = () => {};
    let _addRowAtPosition    = () => {};  // (row) → inserts into _rows at correct index
    let _reloadData          = () => {};  // full data reload from server

    function configure(deps) {
        _getRows             = deps.getRows;
        _getFilteredRows     = deps.getFilteredRows;
        _updateRow           = deps.updateRow;
        _removeRows          = deps.removeRows;
        _applyFilters        = deps.applyFilters;
        _render              = deps.render;
        _addRowAtPosition    = deps.addRowAtPosition || (() => {});
        _reloadData          = deps.reloadData       || (() => {});
    }

    // ── Soft delete ───────────────────────────────────────────

    async function softDeleteRow(rowId) {
        const selected = SelectionManager.getSelectedRowIds(_getFilteredRows()).filter(id => {
            const r = _getRows().find(x => x.id === id);
            return r && !r.is_deleted;
        });
        const rowIds = selected.length > 0 ? selected : [rowId];

        const msg = rowIds.length === 1
            ? "Delete this row? It can be restored."
            : `Delete ${rowIds.length} rows? They can be restored.`;
        if (!confirm(msg)) return;

        try {
            for (const id of rowIds) {
                const updated = await ApiClient.softDeleteRow(id);
                _updateRow(id, updated);
            }
            _applyFilters();
            _render();
            document.dispatchEvent(new CustomEvent('undo:updated'));
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Restore ───────────────────────────────────────────────

    async function restoreRow(rowId) {
        const selected = SelectionManager.getSelectedRowIds(_getFilteredRows()).filter(id => {
            const r = _getRows().find(x => x.id === id);
            return r && r.is_deleted;
        });
        const rowIds = selected.length > 0 ? selected : [rowId];

        try {
            for (const id of rowIds) {
                const updated = await ApiClient.restoreRow(id);
                _updateRow(id, updated);
            }
            _applyFilters();
            _render();
            Utils.showToast(
                rowIds.length === 1 ? "Row restored." : `${rowIds.length} rows restored.`,
                "success"
            );
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Hard delete ───────────────────────────────────────────

    async function hardDeleteRow(rowId) {
        const selected = SelectionManager.getSelectedRowIds(_getFilteredRows()).filter(id => {
            const r = _getRows().find(x => x.id === id);
            return r && r.is_deleted;
        });
        const rowIds = selected.length > 0 ? selected : [rowId];

        const msg = rowIds.length === 1
            ? "Permanently delete this row? This cannot be undone."
            : `Permanently delete ${rowIds.length} rows? This cannot be undone.`;
        if (!confirm(msg)) return;

        try {
            for (const id of rowIds) {
                await ApiClient.hardDeleteRow(id);
            }
            _removeRows(new Set(rowIds));
            _render();
            Utils.showToast(
                rowIds.length === 1
                    ? "Row permanently deleted."
                    : `${rowIds.length} rows permanently deleted.`,
                "success"
            );
            document.dispatchEvent(new CustomEvent('undo:updated'));
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Keep row (remove ETL: Eliminated flag) ────────────────

    async function keepRow(rowId) {
        const selected = SelectionManager.getSelectedRowIds(_getFilteredRows()).filter(id => {
            const r = _getRows().find(x => x.id === id);
            return r && r.cell_flags && r.cell_flags[""] &&
                   r.cell_flags[""].some(f => f.name === "ETL: Eliminated");
        });
        const rowIds = selected.length > 0 ? selected : [rowId];

        try {
            for (const id of rowIds) {
                await ApiClient.keepRow(id);
                const row = _getRows().find(r => r.id === id);
                if (row && row.cell_flags && row.cell_flags[""]) {
                    row.cell_flags[""] = row.cell_flags[""].filter(f => f.name !== "ETL: Eliminated");
                }
            }
            _applyFilters();
            _render();
            Utils.showToast(
                rowIds.length === 1
                    ? "Row kept — ETL: Eliminated flag removed."
                    : `${rowIds.length} rows kept — ETL: Eliminated flag removed.`,
                "success"
            );
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Remove override ───────────────────────────────────────

    async function _doRemoveOverride(cells) {
        if (!cells.length) return;
        try {
            for (const { row_tag, col_slug } of cells) {
                const row = _getRows().find(r => r.tag === row_tag);
                if (!row || !col_slug) continue;
                const updated = await ApiClient.removeOverride(row.id, col_slug);
                _updateRow(row.id, updated);
            }
            _applyFilters();
            _render();
            Utils.showToast(
                cells.length === 1 ? "Manual edit removed." : `${cells.length} overrides removed.`,
                "success"
            );
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    async function removeOverride(rowId, colSlug) {
        const selCells = SelectionManager.getSelectedCells(_getFilteredRows(), ColumnsManager.getColumns());
        if (selCells && selCells.length > 0) {
            await _doRemoveOverride(selCells);
        } else {
            const row = _getRows().find(r => r.id === rowId);
            if (!row || !colSlug) return;
            await _doRemoveOverride([{ row_tag: row.tag, col_slug: colSlug }]);
        }
    }

    // ── Insert row above / below ──────────────────────────────

    async function insertRowAbove(rowId) {
        try {
            const newRow = await ApiClient.insertRow(rowId, "above");
            _addRowAtPosition(newRow);
            _applyFilters();
            _render();
            document.dispatchEvent(new CustomEvent('undo:updated'));
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    async function insertRowBelow(rowId) {
        try {
            const newRow = await ApiClient.insertRow(rowId, "below");
            _addRowAtPosition(newRow);
            _applyFilters();
            _render();
            document.dispatchEvent(new CustomEvent('undo:updated'));
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Copy and insert below ─────────────────────────────────

    async function copyRowInsert(rowId) {
        try {
            const newRow = await ApiClient.copyRowInsert(rowId);
            _addRowAtPosition(newRow);
            _applyFilters();
            _render();
            Utils.showToast("Row copied and inserted.", "success");
            document.dispatchEvent(new CustomEvent('undo:updated'));
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    return {
        configure,
        softDeleteRow, restoreRow, hardDeleteRow, keepRow, removeOverride,
        insertRowAbove, insertRowBelow, copyRowInsert,
    };

})();
