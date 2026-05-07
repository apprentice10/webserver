const SqlEditor = (() => {

    let _sqlDraft    = '';
    let _resultsHtml = '';

    // --------------------------------------------------------
    // INIT — attach Ctrl+Enter shortcut
    // --------------------------------------------------------

    function _init() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter' && PanelSystem.isPanelOpen('sql')) {
                run();
            }
        });
    }

    // --------------------------------------------------------
    // RENDER INTO panel body (called by PanelSystem.onActivate)
    // --------------------------------------------------------

    function renderInto(body) {
        body.innerHTML =
            `<div class="sql-editor-body">` +
                `<textarea id="sql-input" class="sql-input" spellcheck="false"` +
                ` placeholder="SELECT * FROM tool_rows WHERE tool_id = …"></textarea>` +
                `<div class="sql-editor-actions">` +
                    `<button class="btn btn-primary btn-sm" onclick="SqlEditor.run()">▶ Run</button>` +
                    `<button class="btn btn-ghost btn-sm" onclick="SqlEditor.clear()">Clear</button>` +
                `</div>` +
            `</div>` +
            `<div class="sql-results" id="sql-results"></div>`;
        const ta = document.getElementById('sql-input');
        if (ta) {
            ta.value = _sqlDraft;
            ta.addEventListener('input', () => { _sqlDraft = ta.value; });
            ta.focus();
        }
        const res = document.getElementById('sql-results');
        if (res && _resultsHtml) res.innerHTML = _resultsHtml;
    }

    // --------------------------------------------------------
    // TOGGLE
    // --------------------------------------------------------

    function toggle() { PanelSystem.togglePanel('sql'); }

    // --------------------------------------------------------
    // RUN QUERY
    // --------------------------------------------------------

    async function run() {
        const input   = document.getElementById('sql-input');
        const results = document.getElementById('sql-results');
        if (!input || !results) return;
        const sql = input.value.trim();
        if (!sql) {
            results.innerHTML = '<div class="sql-error">Enter a SQL query.</div>';
            _resultsHtml = results.innerHTML;
            return;
        }
        results.innerHTML = '<div style="color:var(--color-text-muted);padding:6px 0">Running…</div>';
        try {
            const data = await ApiClient.runSql(sql);
            _renderResults(data);
        } catch (err) {
            results.innerHTML = `<div class="sql-error">⚠ ${Utils.escHtml(err.message)}</div>`;
        }
        _resultsHtml = results.innerHTML;
    }

    // --------------------------------------------------------
    // RENDER RESULTS
    // --------------------------------------------------------

    function _renderResults(data) {
        const results = document.getElementById('sql-results');
        if (!results) return;
        if (data.rowcount !== undefined && !data.columns) {
            results.innerHTML = `<div class="sql-success">✓ Query executed. Rows affected: ${data.rowcount}</div>`;
            return;
        }
        if (!data.rows || !data.rows.length) {
            results.innerHTML = '<div class="sql-success">✓ No results.</div>';
            return;
        }
        const headers = data.columns.map(c => `<th>${Utils.escHtml(c)}</th>`).join('');
        const rows = data.rows.map(row => {
            const cells = data.columns.map(c => `<td>${Utils.escHtml(String(row[c] ?? ''))}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        results.innerHTML =
            `<div style="color:var(--color-text-muted);font-size:11px;padding:4px 0 6px">${data.rows.length} rows returned</div>` +
            `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    // --------------------------------------------------------
    // CLEAR
    // --------------------------------------------------------

    function clear() {
        const input   = document.getElementById('sql-input');
        const results = document.getElementById('sql-results');
        if (input)   { input.value = '';       _sqlDraft    = ''; }
        if (results) { results.innerHTML = ''; _resultsHtml = ''; }
    }

    _init();

    return { toggle, run, clear, renderInto };

})();
