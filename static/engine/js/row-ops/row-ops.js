const RowOps = (() => {

    // Injected by configure()
    let _getRows         = () => [];
    let _getFilteredRows = () => [];
    let _updateRow       = () => {};  // (id, data) → updates _rows[idx] only
    let _removeRows      = () => {};  // (idSet)    → filters both arrays
    let _applyFilters    = () => {};
    let _render          = () => {};

    function configure(deps) {
        _getRows         = deps.getRows;
        _getFilteredRows = deps.getFilteredRows;
        _updateRow       = deps.updateRow;
        _removeRows      = deps.removeRows;
        _applyFilters    = deps.applyFilters;
        _render          = deps.render;
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
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Restore ───────────────────────────────────────────────

    async function restoreRow(rowId) {
        try {
            const updated = await ApiClient.restoreRow(rowId);
            _updateRow(rowId, updated);
            _applyFilters();
            _render();
            Utils.showToast("Row restored.", "success");
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
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    // ── Keep row (remove ETL: Eliminated flag) ────────────────

    async function keepRow(rowId) {
        try {
            await ApiClient.keepRow(rowId);
            const row = _getRows().find(r => r.id === rowId);
            if (row && row.cell_flags && row.cell_flags[""]) {
                row.cell_flags[""] = row.cell_flags[""].filter(f => f.name !== "ETL: Eliminated");
            }
            _applyFilters();
            _render();
            Utils.showToast("Row kept — ETL: Eliminated flag removed.", "success");
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

    // Compatibility wrapper — context menu single-cell path
    async function removeOverride(rowId, colSlug) {
        const row = _getRows().find(r => r.id === rowId);
        if (!row || !colSlug) return;
        await _doRemoveOverride([{ row_tag: row.tag, col_slug: colSlug }]);
    }

    return { configure, softDeleteRow, restoreRow, hardDeleteRow, keepRow, removeOverride };

})();
