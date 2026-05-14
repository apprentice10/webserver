const HistoryRenderer = (() => {

    function renderAuditEntries(entries, rowId, colSlug) {
        if (!entries || entries.length === 0)
            return '<p class="sidebar-log-empty">No changes recorded.</p>';
        const items = entries.map(e => {
            const ts   = Utils.escHtml(e.ts || '');
            const ct   = Utils.escHtml(e.change_type || e.action || '');
            const rev  = e.revision ? ` REV ${Utils.escHtml(e.revision)}` : '';
            const oldV = (e.old_val != null) ? `'${Utils.escHtml(String(e.old_val))}'` : '—';
            const newV = (e.new_val != null) ? `'${Utils.escHtml(String(e.new_val))}'` : '—';
            const rollbackBtn = (rowId && colSlug)
                ? `<button class="sidebar-log-rollback" data-row-id="${rowId}" data-col="${Utils.escAttr(colSlug)}" data-entry-id="${e.id}" title="Restore this value">↩</button>`
                : '';
            return `<li class="sidebar-log-entry">
                <div class="sidebar-log-ts">${ts}${rev} <span class="sidebar-log-type">${ct}</span>${rollbackBtn}</div>
                <div class="sidebar-log-change">${oldV} → ${newV}</div>
            </li>`;
        }).join('');
        return `<ul class="sidebar-log-list">${items}</ul>`;
    }

    function exportLog() {
        const body = document.querySelector('#sidebar-panel .sidebar-body');
        if (!body) return;
        const titleEl = document.querySelector('#sidebar-panel .sidebar-title');
        const lines = titleEl ? [titleEl.textContent.trim(), ''] : [];
        body.querySelectorAll(
            '.sidebar-log-meta, .sidebar-log-group-header, .sidebar-log-row-label, ' +
            '.sidebar-log-ts, .sidebar-log-change'
        ).forEach(el => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('button').forEach(b => b.remove());
            const text = clone.textContent.trim();
            if (text) lines.push(text);
        });
        if (lines.length <= 1) return;
        const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'audit_log.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return { renderAuditEntries, exportLog };

})();
