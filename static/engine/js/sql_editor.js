/**
 * sql_editor.js — Engine
 * -----------------------
 * Power SQL Editor universale del Table Engine.
 *
 * Responsabilità:
 * - Toggle pannello SQL
 * - Invio query al backend
 * - Rendering risultati in tabella
 * - Gestione errori SQL
 * - Shortcut Ctrl+Enter per eseguire
 */

const SqlEditor = (() => {

    // --------------------------------------------------------
    // STATO INTERNO
    // --------------------------------------------------------

    let _visible = false;


    // --------------------------------------------------------
    // INIT — attacca shortcut Ctrl+Enter
    // --------------------------------------------------------

    function _init() {
        document.addEventListener("keydown", function (e) {
            if (e.ctrlKey && e.key === "Enter") {
                const panel = document.getElementById("sql-editor-panel");
                if (panel && panel.style.display !== "none") {
                    run();
                }
            }
        });
    }


    // --------------------------------------------------------
    // TOGGLE
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
        const sql       = document.getElementById("sql-input").value.trim();
        const resultsEl = document.getElementById("sql-results");

        if (!sql) {
            resultsEl.innerHTML = '<div class="sql-error">Inserisci una query SQL.</div>';
            return;
        }

        resultsEl.innerHTML =
            '<div style="color:var(--color-text-muted);padding:6px 0">Esecuzione...</div>';

        try {
            const data = await ApiClient.runSql(sql);
            _renderResults(data);
        } catch (err) {
            resultsEl.innerHTML =
                `<div class="sql-error">⚠ ${_escHtml(err.message)}</div>`;
        }
    }


    // --------------------------------------------------------
    // RENDERING RISULTATI
    // --------------------------------------------------------

    function _renderResults(data) {
        const resultsEl = document.getElementById("sql-results");

        // Query non-SELECT
        if (data.rowcount !== undefined && !data.columns) {
            resultsEl.innerHTML = `
                <div class="sql-success">
                    ✓ Query eseguita. Righe interessate: ${data.rowcount}
                </div>`;
            return;
        }

        // Nessun risultato
        if (!data.rows || data.rows.length === 0) {
            resultsEl.innerHTML =
                '<div class="sql-success">✓ Nessun risultato.</div>';
            return;
        }

        const headers = data.columns
            .map(col => `<th>${_escHtml(col)}</th>`)
            .join("");

        const rows = data.rows
            .map(row => {
                const cells = data.columns
                    .map(col => `<td>${_escHtml(String(row[col] ?? ""))}</td>`)
                    .join("");
                return `<tr>${cells}</tr>`;
            }).join("");

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
        document.getElementById("sql-input").value    = "";
        document.getElementById("sql-results").innerHTML = "";
    }


    // --------------------------------------------------------
    // UTILITY
    // --------------------------------------------------------

    function _escHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }


    // --------------------------------------------------------
    // AVVIO
    // --------------------------------------------------------

    _init();


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return { toggle, run, clear };

})();