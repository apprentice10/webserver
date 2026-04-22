/**
 * sql_editor.js
 * --------------
 * Power SQL Editor per il tool Instrument List.
 *
 * Responsabilità:
 * - Mostra/nasconde il pannello SQL
 * - Invia query al backend
 * - Renderizza i risultati in tabella
 * - Gestisce errori SQL
 */

const SqlEditor = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _visible = false;


    // --------------------------------------------------------
    // TOGGLE PANNELLO
    // --------------------------------------------------------

    function toggle() {
        _visible = !_visible;
        const panel = document.getElementById("sql-editor-panel");
        panel.style.display = _visible ? "flex" : "none";

        if (_visible) {
            document.getElementById("sql-input").focus();
        }
    }


    // --------------------------------------------------------
    // ESECUZIONE QUERY
    // --------------------------------------------------------

    async function run() {
        const sql = document.getElementById("sql-input").value.trim();
        const resultsEl = document.getElementById("sql-results");

        if (!sql) {
            resultsEl.innerHTML = '<div class="sql-error">Inserisci una query SQL.</div>';
            return;
        }

        resultsEl.innerHTML = '<div style="color:var(--color-text-muted);padding:8px 0">Esecuzione...</div>';

        try {
            const data = await ApiClient.runSql(sql);
            _renderResults(data);
        } catch (err) {
            resultsEl.innerHTML = `<div class="sql-error">⚠ ${_escapeHtml(err.message)}</div>`;
        }
    }


    // --------------------------------------------------------
    // RENDERING RISULTATI
    // --------------------------------------------------------

    /**
     * Renderizza i risultati della query in una tabella HTML.
     * Gestisce sia SELECT (rows + columns) che INSERT/UPDATE/DELETE (rowcount).
     */
    function _renderResults(data) {
        const resultsEl = document.getElementById("sql-results");

        // Query non-SELECT (INSERT, UPDATE, DELETE)
        if (data.rowcount !== undefined && !data.columns) {
            resultsEl.innerHTML = `
                <div class="sql-success">
                    ✓ Query eseguita. Righe interessate: ${data.rowcount}
                </div>`;
            return;
        }

        // Nessun risultato
        if (!data.rows || data.rows.length === 0) {
            resultsEl.innerHTML = '<div class="sql-success">✓ Query eseguita. Nessun risultato.</div>';
            return;
        }

        // Tabella risultati
        const headers = data.columns
            .map(col => `<th>${_escapeHtml(col)}</th>`)
            .join("");

        const rows = data.rows
            .map(row => {
                const cells = data.columns
                    .map(col => `<td>${_escapeHtml(String(row[col] ?? ""))}</td>`)
                    .join("");
                return `<tr>${cells}</tr>`;
            })
            .join("");

        resultsEl.innerHTML = `
            <div style="color:var(--color-text-muted);font-size:11px;padding:4px 0 6px">
                ${data.rows.length} righe restituite
            </div>
            <table>
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }


    // --------------------------------------------------------
    // PULIZIA
    // --------------------------------------------------------

    function clear() {
        document.getElementById("sql-input").value = "";
        document.getElementById("sql-results").innerHTML = "";
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        toggle,
        run,
        clear
    };

})();