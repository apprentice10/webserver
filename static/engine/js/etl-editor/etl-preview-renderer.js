const EtlPreviewRenderer = (() => {

    const _esc = Utils.escHtml;

    function renderPreview(data) {
        const el = document.getElementById("etl-preview-container");
        if (!el) return;
        let warn = "";
        if (data.warnings && data.warnings.length) {
            warn = `<div class="etl-warnings">${data.warnings.map(w => `<div class="etl-warning">⚠ ${_esc(w)}</div>`).join("")}</div>`;
        }
        if (!data.rows || !data.rows.length) {
            el.innerHTML = warn + '<div class="etl-empty">Query executed — no results.</div>';
            return;
        }
        const rows  = data.rows.slice(0, 50);
        const heads = data.columns.map(c => `<th>${_esc(c)}</th>`).join("");
        const body  = rows.map(r =>
            `<tr>${data.columns.map(c => `<td>${_esc(String(r[c] ?? ""))}</td>`).join("")}</tr>`
        ).join("");
        const note = data.rows.length > 50
            ? `<div class="etl-note">Showing 50 of ${data.rows.length} rows.</div>` : "";
        el.innerHTML = `${warn}
            <div class="etl-preview-info">${data.row_count} rows returned</div>
            ${note}
            <div class="etl-preview-table-wrapper">
                <table class="etl-preview-table"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>
            </div>`;
    }

    function renderApplyResult(result) {
        const el = document.getElementById("etl-preview-container");
        if (!el) return;
        const errs = result.errors && result.errors.length
            ? `<div class="etl-warnings">${result.errors.map(e => `<div class="etl-warning">⚠ ${_esc(e)}</div>`).join("")}</div>` : "";
        el.innerHTML = `${errs}
            <div class="etl-apply-result">
                ${result.columns_created > 0 ? `<div class="etl-result-item etl-result-updated">+ ${result.columns_created} columns created automatically</div>` : ""}
                <div class="etl-result-item etl-result-created">✓ ${result.created} rows created</div>
                <div class="etl-result-item etl-result-updated">↺ ${result.updated} rows updated</div>
                <div class="etl-result-item etl-result-skipped">⊘ ${result.skipped_cells} cells preserved (manually edited)</div>
            </div>`;
    }

    function showMsg(msg, type = "info") {
        const el = document.getElementById("etl-preview-container");
        if (!el) return;
        const colors = { info: "var(--color-text-muted)", error: "var(--color-danger)", warning: "var(--color-warning)", success: "var(--color-success)" };
        el.innerHTML = `<div style="color:${colors[type]||colors.info};padding:12px 0;font-size:13px">${_esc(msg)}</div>`;
    }

    return { renderPreview, renderApplyResult, showMsg };

})();
