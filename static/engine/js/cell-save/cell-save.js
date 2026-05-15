const CellSave = (() => {

    let _cfg = {
        getRows:         () => [],
        getFilteredRows: () => [],
    };

    function configure(cfg) {
        Object.assign(_cfg, cfg);
    }

    async function doSaveCell(inputEl, cell, newValue) {
        if (RevisionPicker.getViewingRevision() !== null) return;
        const rows = _cfg.getRows();
        const row  = rows.find(r => r.tag === cell.row_tag);
        if (!row) return;
        const rowId = row.id;
        const field = cell.col_slug;

        inputEl.style.opacity = "0.5";

        try {
            const updatedRow = await ApiClient.updateCell(rowId, field, newValue);

            const idx = rows.findIndex(r => r.id === rowId);
            if (idx !== -1) rows[idx] = updatedRow;

            const filteredRows = _cfg.getFilteredRows();
            const fidx = filteredRows.findIndex(r => r.id === rowId);
            if (fidx !== -1) filteredRows[fidx] = updatedRow;

            updateLogCell(rowId, updatedRow.row_log);

            const td = inputEl.closest("td");
            if (td) {
                const isOverridden = updatedRow.overridden_cols != null && field in updatedRow.overridden_cols;
                if (isOverridden) td.setAttribute("data-overridden", "true");
                else              td.removeAttribute("data-overridden");
                const etlVal  = isOverridden ? (updatedRow.overridden_cols[field] ?? "") : undefined;
                const cfSlug  = updatedRow.cell_flags && updatedRow.cell_flags[field];
                const badges  = GridRenderer.flagBadgesHtml(cfSlug, isOverridden ? etlVal : undefined);
                const existing = td.querySelector(".cell-flag-badges");
                if (existing) existing.remove();
                if (badges) {
                    td.insertAdjacentHTML("beforeend", badges);
                    td.setAttribute("data-has-flags", "true");
                } else {
                    td.removeAttribute("data-has-flags");
                }
            }

            inputEl.style.opacity = "1";
            inputEl.dataset.originalValue = newValue;

        } catch (err) {
            inputEl.value = inputEl.dataset.originalValue ?? "";
            inputEl.style.opacity = "1";
            inputEl.style.outline = "2px solid var(--color-danger)";
            setTimeout(() => inputEl.style.outline = "", 2000);
            showToast(err.message, "error");
        }
    }

    function updateLogCell(rowId, rowLog) {
        const rowEl = document.querySelector(`tr[data-row-id="${rowId}"]`);
        if (!rowEl) return;
        const logCell = rowEl.querySelector(".cell-log-preview");
        if (logCell) logCell.innerHTML = GridRenderer.formatLogPreview(rowLog);
    }

    return { configure, doSaveCell, updateLogCell };

})();
