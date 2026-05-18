/**
 * rendering/grid-renderer.js
 * Pure HTML generators for grid rows, cells, ghost row, and flag badges.
 * No state. No DOM reads. All inputs passed as explicit parameters.
 */

const GridRenderer = (() => {

    function flagBadgesHtml(flags, overrideEtlValue) {
        const hidden = typeof FlagsManager !== "undefined" ? FlagsManager.getHiddenIds() : new Set();
        const visible = (flags || []).filter(f => !hidden.has(f.id));
        const manualEditHidden = typeof FlagsManager !== "undefined" && FlagsManager.isHiddenByName('manual_edit');
        const etlLabel = (overrideEtlValue === null || overrideEtlValue === "")
            ? "(empty)"
            : Utils.escAttr(String(overrideEtlValue));
        const overrideDot = (!manualEditHidden && overrideEtlValue !== undefined)
            ? `<span class="cell-flag-dot" style="background:#FF8C00" title="ETL: ${etlLabel}"></span>`
            : "";
        if (!overrideDot && !visible.length) return "";
        const dots = visible.map(f => {
            const tip = f.note ? `${f.name}: ${f.note}` : f.name;
            return `<span class="cell-flag-dot" style="background:${Utils.escAttr(f.color)}" title="${Utils.escAttr(tip)}"></span>`;
        }).join("");
        return `<span class="cell-flag-badges">${overrideDot}${dots}</span>`;
    }

    function formatLogPreview(rowLog) {
        if (!rowLog) return '<span style="opacity:0.3">—</span>';
        const first = rowLog.split("\n")[0];
        return Utils.escHtml(first);
    }

    function renderCell(row, col, isDeleted, rowIdx, colIdx) {
        const value  = row[col.slug] ?? "";
        const isLog  = col.slug === "log";
        const isRev  = col.slug === "rev";
        const isTag  = col.slug === "tag";
        const coords = ` data-row-idx="${rowIdx}" data-col-idx="${colIdx}"`;

        if (isLog) {
            return `
                <td data-slug="log" data-column-id="${col.id}" style="width:${col.width}px"${coords}>
                    <div class="cell-log-preview"
                         onclick="HistoryActions.openRowHistory(${row.id}, GridManager.getAllRows())">
                        ${formatLogPreview(row.row_log)}
                    </div>
                </td>`;
        }

        const readonly  = (isRev || isDeleted)
            ? "readonly tabindex='-1'"
            : "readonly data-editable='true'";
        const cellClass = isTag ? "cell-input cell-tag" : "cell-input";
        const isOverridden = row.overridden_cols != null && col.slug in row.overridden_cols;
        const etlValue = isOverridden ? row.overridden_cols[col.slug] : null;
        const overriddenAttr = isOverridden ? ` data-overridden="true"` : "";

        const cellFlags  = row.cell_flags && row.cell_flags[col.slug];
        const badges = flagBadgesHtml(cellFlags, isOverridden ? (etlValue ?? "") : undefined);
        const flagAttr   = badges ? ' data-has-flags="true"' : "";

        return `
            <td data-column-id="${col.id}" style="width:${col.width}px"${overriddenAttr}${flagAttr}${coords}>
                <input
                    type="text"
                    class="${cellClass}"
                    data-row-id="${row.id}"
                    data-field="${col.slug}"
                    value="${Utils.escAttr(value)}"
                    ${readonly}
                >
                ${badges}
            </td>`;
    }

    function renderRow(row, columns, rowIndex) {
        const isDeleted    = row.is_deleted;
        const rowFlags     = row.cell_flags && row.cell_flags[""];
        const isEliminated = !isDeleted && rowFlags && rowFlags.some(f => f.name === "ETL: Eliminated");
        const rowClass     = isDeleted ? "row-deleted" : (isEliminated ? "row-eliminated" : "");
        const cells        = columns.map((col, colIdx) => renderCell(row, col, isDeleted, rowIndex, colIdx)).join("");

        const rev = row['rev'] || '';
        const revHtml = rev ? `<span class="gutter-rev">${Utils.escHtml(rev)}</span>` : '';
        const gutterFlagDots = (rowFlags || [])
            .filter(f => !f.hidden)
            .map(f => `<span class="gutter-flag-dot" style="background:${Utils.escAttr(f.color)}" title="${Utils.escHtml(f.name)}"></span>`)
            .join('');
        const gutterFlagsHtml = gutterFlagDots
            ? `<div class="gutter-flags">${gutterFlagDots}</div>`
            : '';

        return `
            <tr data-row-id="${row.id}"
                class="${rowClass}"
                oncontextmenu="GridManager.openContextMenu(event, ${row.id}, ${isDeleted})">
                <td class="gutter" data-row-idx="${rowIndex}"><div class="gutter-inner"><span class="gutter-drag-handle" title="Drag to reorder">⠿</span><span class="gutter-num">${rowIndex + 1}</span>${revHtml}${gutterFlagsHtml}</div></td>
                ${cells}
            </tr>`;
    }

    function renderGhostRow(columns) {
        const cells = columns.map(col => {
            if (col.slug === "log" || col.slug === "rev") {
                return `<td data-slug="${col.slug}" style="width:${col.width}px"></td>`;
            }
            const isTag = col.slug === "tag";
            return `
                <td style="width:${col.width}px">
                    <input
                        type="text"
                        class="${isTag ? "cell-input cell-tag" : "cell-input"}"
                        data-ghost="true"
                        data-field="${col.slug}"
                        placeholder="${isTag ? "Nuovo TAG..." : ""}"
                    >
                </td>`;
        }).join("");

        return `
            <tr class="row-ghost" id="ghost-row">
                <td class="gutter"><div class="gutter-inner"></div></td>
                ${cells}
            </tr>`;
    }

    return { flagBadgesHtml, formatLogPreview, renderRow, renderCell, renderGhostRow };

})();
