const HistoryPanel = (() => {

    let _logSidebarCtx = null;  // {rowId, colSlug} or null — for future context-refresh use

    async function showRowLog(rowId, row) {
        if (!row) return;

        _logSidebarCtx = { rowId, colSlug: null };
        const rowLabel = Utils.escHtml(row.tag || `#${rowId}`);

        SidebarManager.open('History');
        SidebarManager.setTitle(`History — ${rowLabel}`);
        SidebarManager.setContent('<p class="sidebar-log-empty">Loading…</p>');

        try {
            const entries = await HistoryApi.getAudit({ rowTag: row.tag, limit: 300 });
            if (!entries || entries.length === 0) {
                SidebarManager.setContent('<p class="sidebar-log-empty">No changes recorded for this row.</p>');
                return;
            }

            const colMap = new Map();
            for (const e of entries) {
                const cs = e.col_slug || '(row)';
                if (!colMap.has(cs)) colMap.set(cs, []);
                colMap.get(cs).push(e);
            }

            let html = `<div class="sidebar-log-meta">
                <span class="sidebar-log-label">Row:</span>
                <span class="sidebar-log-value">${rowLabel}</span>
            </div>`;

            for (const [cs, colEntries] of colMap) {
                const colId = cs === '(row)' ? null : cs;
                html += `<div class="sidebar-log-group">
                    <div class="sidebar-log-group-header">${Utils.escHtml(cs)}</div>
                    ${HistoryRenderer.renderAuditEntries(colEntries, rowId, colId)}
                </div>`;
            }

            html += `<div class="sidebar-log-actions"><button class="btn-icon btn-log-export" onclick="HistoryRenderer.exportLog()">Export history</button></div>`;
            SidebarManager.setContent(html);
            RollbackService.bindRollbackButtons();
            document.dispatchEvent(new CustomEvent('grid:historyRendered'));
        } catch (e) {
            SidebarManager.setContent('<p class="sidebar-log-empty">Error loading log.</p>');
        }
    }

    async function showCellLog(rowId, colSlug, row) {
        if (!colSlug || !row) return;

        _logSidebarCtx = { rowId, colSlug };
        const colLabel = Utils.escHtml(colSlug);
        const rowLabel = Utils.escHtml(row.tag || `#${rowId}`);

        SidebarManager.open('History');
        SidebarManager.setTitle(`History — ${colLabel}`);
        SidebarManager.setContent('<p class="sidebar-log-empty">Loading…</p>');

        try {
            const entries = await HistoryApi.getAudit({ rowTag: row.tag, colSlug });
            const headerHtml = `<div class="sidebar-log-meta">
                <span class="sidebar-log-label">Column:</span>
                <span class="sidebar-log-value">${colLabel}</span>
                <span class="sidebar-log-label">Row:</span>
                <span class="sidebar-log-value">${rowLabel}</span>
            </div>`;
            const bodyHtml = HistoryRenderer.renderAuditEntries(entries, rowId, colSlug);
            const actionsHtml = (entries && entries.length > 0)
                ? `<div class="sidebar-log-actions"><button class="btn-icon btn-log-export" onclick="HistoryRenderer.exportLog()">Export history</button></div>`
                : '';
            SidebarManager.setContent(headerHtml + bodyHtml + actionsHtml);
            RollbackService.bindRollbackButtons();
            document.dispatchEvent(new CustomEvent('grid:historyRendered'));
        } catch (e) {
            SidebarManager.setContent('<p class="sidebar-log-empty">Error loading log.</p>');
        }
    }

    async function showRangeLog(ranges, filteredRows, columns) {
        if (ranges.length === 0) return;

        _logSidebarCtx = null;

        const colCellMap = new Map();
        const rowTagSet  = new Set();

        for (const rng of ranges) {
            const rMin = Math.min(rng.start.r, rng.end.r);
            const rMax = Math.max(rng.start.r, rng.end.r);
            const cMin = Math.min(rng.start.c, rng.end.c);
            const cMax = Math.max(rng.start.c, rng.end.c);
            for (let ci = cMin; ci <= cMax; ci++) {
                const col = columns[ci];
                if (!col || col.slug === 'log' || col.slug === 'rev') continue;
                if (!colCellMap.has(col.slug)) colCellMap.set(col.slug, new Set());
                for (let ri = rMin; ri <= rMax; ri++) {
                    const row = filteredRows[ri];
                    if (!row) continue;
                    rowTagSet.add(row.tag);
                    colCellMap.get(col.slug).add(row.tag);
                }
            }
        }

        if (rowTagSet.size === 0) return;

        SidebarManager.open('History');
        SidebarManager.setTitle('History — selection');
        SidebarManager.setContent('<p class="sidebar-log-empty">Loading…</p>');

        try {
            const entries = await HistoryApi.getAudit({
                rowTags:  [...rowTagSet].join(','),
                colSlugs: [...colCellMap.keys()].join(','),
                limit:    500,
            });

            const idx = new Map();
            for (const e of entries) {
                const cs = e.col_slug || '';
                const rt = e.row_tag  || '';
                if (!idx.has(cs)) idx.set(cs, new Map());
                const rm = idx.get(cs);
                if (!rm.has(rt)) rm.set(rt, []);
                rm.get(rt).push(e);
            }

            let hasAny = false;
            let html = '';

            for (const [colSlug, rowTagSet2] of colCellMap) {
                const colIdx = idx.get(colSlug);
                if (!colIdx) continue;
                let colHtml = '';
                for (const rowTag of rowTagSet2) {
                    const rowEntries = colIdx.get(rowTag) || [];
                    if (rowEntries.length === 0) continue;
                    hasAny = true;
                    const row2   = filteredRows.find(r => r.tag === rowTag);
                    const rowId2 = row2 ? row2.id : null;
                    colHtml += `<div class="sidebar-log-row-label">${Utils.escHtml(rowTag)}</div>
                        ${HistoryRenderer.renderAuditEntries(rowEntries, rowId2, colSlug)}`;
                }
                if (!colHtml) continue;
                html += `<div class="sidebar-log-group">
                    <div class="sidebar-log-group-header">${Utils.escHtml(colSlug)}</div>
                    ${colHtml}
                </div>`;
            }

            if (!hasAny) html = '<p class="sidebar-log-empty">No changes recorded for the selected range.</p>';
            else html += `<div class="sidebar-log-actions"><button class="btn-icon btn-log-export" onclick="HistoryRenderer.exportLog()">Export history</button></div>`;

            SidebarManager.setContent(html);
            RollbackService.bindRollbackButtons();
        } catch (e) {
            SidebarManager.setContent('<p class="sidebar-log-empty">Error loading log.</p>');
        }
    }

    return { showRowLog, showCellLog, showRangeLog };

})();
