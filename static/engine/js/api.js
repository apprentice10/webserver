/**
 * api.js — Engine
 * ----------------
 * Universal HTTP client for the Table Engine.
 * Only module allowed to fetch() the backend.
 *
 * DB_PATH and TOOL_ID are injected by the Jinja2 template.
 */

const ApiClient = (() => {

    function _db() { return encodeURIComponent(DB_PATH); }

    async function request(url, options = {}) {
        const response = await fetch(url, {
            headers: { "Content-Type": "application/json" },
            ...options
        });
        if (!response.ok) {
            let detail = `HTTP error ${response.status}`;
            try {
                const err = await response.json();
                detail = err.detail || detail;
            } catch (_) {}
            throw new Error(detail);
        }
        if (response.status === 204) return null;
        return response.json();
    }


    // ── Tool ──────────────────────────────────────────────────

    async function loadTool() {
        return request(`/api/tools/${TOOL_ID}?db=${_db()}`);
    }

    async function updateToolSettings(data) {
        return request(`/api/tools/${TOOL_ID}/settings?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }


    // ── Columns ───────────────────────────────────────────────

    async function loadColumns() {
        return request(`/api/tools/${TOOL_ID}/columns?db=${_db()}`);
    }

    async function addColumn(data) {
        return request(`/api/tools/${TOOL_ID}/columns?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function updateColumn(columnId, data) {
        return request(`/api/tools/${TOOL_ID}/columns/${columnId}?db=${_db()}`,
            { method: "PATCH", body: JSON.stringify(data) });
    }

    async function deleteColumn(columnId) {
        return request(`/api/tools/${TOOL_ID}/columns/${columnId}?db=${_db()}`,
            { method: "DELETE" });
    }

    async function updateColumnWidth(columnId, width) {
        return request(`/api/tools/${TOOL_ID}/columns/${columnId}/width?db=${_db()}`,
            { method: "PATCH", body: JSON.stringify({ width }) });
    }

    async function reorderColumns(orderedIds) {
        return request(`/api/tools/${TOOL_ID}/columns/reorder?db=${_db()}`,
            { method: "PUT", body: JSON.stringify({ order: orderedIds }) });
    }


    // ── Rows ──────────────────────────────────────────────────

    async function loadRows(includeDeleted = false) {
        return request(`/api/tools/${TOOL_ID}/rows?db=${_db()}&include_deleted=${includeDeleted}`);
    }

    async function createRow(cells) {
        return request(`/api/tools/${TOOL_ID}/rows?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ cells })
        });
    }

    async function updateCell(rowId, slug, value) {
        return request(`/api/tools/${TOOL_ID}/rows/${rowId}/cell?db=${_db()}`,
            { method: "PATCH", body: JSON.stringify({ slug, value }) });
    }

    async function softDeleteRow(rowId) {
        return request(`/api/tools/${TOOL_ID}/rows/${rowId}/delete?db=${_db()}`,
            { method: "POST" });
    }

    async function restoreRow(rowId) {
        return request(`/api/tools/${TOOL_ID}/rows/${rowId}/restore?db=${_db()}`,
            { method: "POST" });
    }

    async function hardDeleteRow(rowId) {
        return request(`/api/tools/${TOOL_ID}/rows/${rowId}/hard-delete?db=${_db()}`,
            { method: "POST" });
    }

    async function removeOverride(rowId, colSlug) {
        return request(
            `/api/tools/${TOOL_ID}/rows/${rowId}/override?col=${encodeURIComponent(colSlug)}&db=${_db()}`,
            { method: "DELETE" });
    }

    async function keepRow(rowId) {
        return request(`/api/tools/${TOOL_ID}/rows/${rowId}/keep?db=${_db()}`,
            { method: "POST" });
    }

    async function pasteRows(rows) {
        return request(`/api/tools/${TOOL_ID}/rows/paste?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ rows })
        });
    }


    // ── SQL Editor ────────────────────────────────────────────

    async function runSql(sql) {
        return request(`/api/tools/${TOOL_ID}/sql?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }


    // ── Export ────────────────────────────────────────────────

    function exportExcel() {
        window.location.href = `/api/tools/${TOOL_ID}/export/excel?db=${_db()}`;
    }


    // ── ETL ───────────────────────────────────────────────────

    async function etlCompile(model) {
        return request(`/api/tools/${TOOL_ID}/etl/compile?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model })
        });
    }

    async function etlPreview(model) {
        return request(`/api/tools/${TOOL_ID}/etl/preview?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model })
        });
    }

    async function etlApply(model) {
        return request(`/api/tools/${TOOL_ID}/etl/apply?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model })
        });
    }

    async function etlSave(model, label = null) {
        return request(`/api/tools/${TOOL_ID}/etl/save?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model, label })
        });
    }

    async function etlRunSaved() {
        return request(`/api/tools/${TOOL_ID}/etl/run?db=${_db()}`, { method: "POST" });
    }

    async function etlLoadConfig() {
        return request(`/api/tools/${TOOL_ID}/etl/config?db=${_db()}`);
    }

    async function listProjectTools() {
        return request(`/api/tools/project?db=${_db()}`);
    }

    async function etlLoadSchema() {
        return request(`/api/tools/${TOOL_ID}/etl/schema?db=${_db()}`);
    }


    // ── Flags ─────────────────────────────────────────────────

    async function listFlags() {
        return request(`/api/tools/flags?db=${_db()}`);
    }

    async function createFlag(name, color) {
        return request(`/api/tools/flags?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ name, color })
        });
    }

    async function updateFlag(flagId, data) {
        return request(`/api/tools/flags/${flagId}?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }

    async function deleteFlag(flagId) {
        return request(`/api/tools/flags/${flagId}?db=${_db()}`, { method: "DELETE" });
    }

    async function toggleCellFlags(flagId, cells) {
        return request(`/api/tools/${TOOL_ID}/cell-flags/toggle?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ flag_id: flagId, cells })
        });
    }


    // ── Templates ─────────────────────────────────────────────

    async function saveTemplate(data) {
        return request(`/api/tools/templates?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function deleteTemplate(templateId) {
        return request(`/api/tools/templates/${templateId}?db=${_db()}`, { method: "DELETE" });
    }

    async function etlSaveDraft(model) {
        return request(`/api/tools/${TOOL_ID}/etl/config?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify({ model })
        });
    }

    async function etlSqlToModel(sql) {
        return request(`/api/tools/${TOOL_ID}/etl/sql_to_model?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }

    async function getAudit({ rowTag, rowTags, colSlug, colSlugs, limit = 200 } = {}) {
        const p = new URLSearchParams({ db: DB_PATH, limit });
        if (rowTag)   p.set("row_tag",  rowTag);
        if (rowTags)  p.set("row_tags", rowTags);
        if (colSlug)  p.set("col_slug", colSlug);
        if (colSlugs) p.set("col_slugs", colSlugs);
        return request(`/api/tools/${TOOL_ID}/audit?${p}`);
    }

    async function rollbackCell(rowId, col, entryId) {
        const p = new URLSearchParams({ db: DB_PATH, col, entry_id: entryId });
        return request(`/api/tools/${TOOL_ID}/rows/${rowId}/rollback?${p}`, { method: "POST" });
    }


    return {
        loadTool, updateToolSettings,
        listFlags, createFlag, updateFlag, deleteFlag, toggleCellFlags,
        loadColumns, addColumn, updateColumn, deleteColumn, updateColumnWidth, reorderColumns,
        loadRows, createRow, updateCell, softDeleteRow, restoreRow, hardDeleteRow,
        removeOverride, keepRow, pasteRows,
        runSql, exportExcel,
        etlCompile, etlPreview, etlApply, etlRunSaved, etlSave,
        etlLoadConfig, etlLoadSchema, listProjectTools,
        saveTemplate, deleteTemplate, etlSaveDraft, etlSqlToModel,
        getAudit, rollbackCell,
    };

})();
