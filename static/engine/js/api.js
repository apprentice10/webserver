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
        return request(`/api/engines/${TOOL_ID}?db=${_db()}`);
    }

    async function updateToolSettings(data) {
        return request(`/api/engines/${TOOL_ID}/settings?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }


    // ── Columns ───────────────────────────────────────────────

    async function loadColumns() {
        return request(`/api/engines/${TOOL_ID}/columns?db=${_db()}`);
    }

    async function addColumn(data) {
        return request(`/api/engines/${TOOL_ID}/columns?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function updateColumn(columnId, data) {
        return request(`/api/engines/${TOOL_ID}/columns/${columnId}?db=${_db()}`,
            { method: "PATCH", body: JSON.stringify(data) });
    }

    async function deleteColumn(columnId) {
        return request(`/api/engines/${TOOL_ID}/columns/${columnId}?db=${_db()}`,
            { method: "DELETE" });
    }

    async function updateColumnWidth(columnId, width) {
        return request(`/api/engines/${TOOL_ID}/columns/${columnId}/width?db=${_db()}`,
            { method: "PATCH", body: JSON.stringify({ width }) });
    }

    async function reorderColumns(orderedIds) {
        return request(`/api/engines/${TOOL_ID}/columns/reorder?db=${_db()}`,
            { method: "PUT", body: JSON.stringify({ order: orderedIds }) });
    }


    // ── Rows ──────────────────────────────────────────────────

    async function loadRows(includeDeleted = false) {
        return request(`/api/engines/${TOOL_ID}/rows?db=${_db()}&include_deleted=${includeDeleted}`);
    }

    async function createRow(cells) {
        return request(`/api/engines/${TOOL_ID}/rows?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ cells })
        });
    }

    async function updateCell(rowId, slug, value) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/cell?db=${_db()}`,
            { method: "PATCH", body: JSON.stringify({ slug, value }) });
    }

    async function softDeleteRow(rowId) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/delete?db=${_db()}`,
            { method: "POST" });
    }

    async function restoreRow(rowId) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/restore?db=${_db()}`,
            { method: "POST" });
    }

    async function hardDeleteRow(rowId) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/hard-delete?db=${_db()}`,
            { method: "POST" });
    }

    async function removeOverride(rowId, colSlug) {
        return request(
            `/api/engines/${TOOL_ID}/rows/${rowId}/override?col=${encodeURIComponent(colSlug)}&db=${_db()}`,
            { method: "DELETE" });
    }

    async function keepRow(rowId) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/keep?db=${_db()}`,
            { method: "POST" });
    }

    async function insertRow(rowId, placement) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/insert?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ placement })
        });
    }

    async function copyRowInsert(rowId) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/copy-insert?db=${_db()}`,
            { method: "POST" });
    }

    async function reorderRow(rowId, anchorRowId, placement) {
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/reorder?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ anchor_row_id: anchorRowId, placement })
        });
    }

    async function pasteRows(rows) {
        return request(`/api/engines/${TOOL_ID}/rows/paste?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ rows })
        });
    }


    // ── SQL Editor ────────────────────────────────────────────

    async function runSql(sql) {
        return request(`/api/engines/${TOOL_ID}/sql?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }


    // ── Export ────────────────────────────────────────────────

    function exportExcel() {
        window.location.href = `/api/engines/${TOOL_ID}/export/excel?db=${_db()}`;
    }


    // ── ETL ───────────────────────────────────────────────────

    async function etlCompile(model) {
        return request(`/api/engines/${TOOL_ID}/etl/compile?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model })
        });
    }

    async function etlPreview(model) {
        return request(`/api/engines/${TOOL_ID}/etl/preview?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model })
        });
    }

    async function etlApply(model) {
        return request(`/api/engines/${TOOL_ID}/etl/apply?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model })
        });
    }

    async function etlSave(model, label = null) {
        return request(`/api/engines/${TOOL_ID}/etl/save?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ model, label })
        });
    }

    async function etlRunSaved() {
        return request(`/api/engines/${TOOL_ID}/etl/run?db=${_db()}`, { method: "POST" });
    }

    async function etlLoadConfig() {
        return request(`/api/engines/${TOOL_ID}/etl/config?db=${_db()}`);
    }

    async function listProjectTools() {
        return request(`/api/engines/project?db=${_db()}`);
    }

    async function etlLoadSchema() {
        return request(`/api/engines/${TOOL_ID}/etl/schema?db=${_db()}`);
    }


    // ── Flags ─────────────────────────────────────────────────

    async function listFlags() {
        return request(`/api/engines/flags?db=${_db()}`);
    }

    async function createFlag(name, color) {
        return request(`/api/engines/flags?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ name, color })
        });
    }

    async function updateFlag(flagId, data) {
        return request(`/api/engines/flags/${flagId}?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }

    async function deleteFlag(flagId) {
        return request(`/api/engines/flags/${flagId}?db=${_db()}`, { method: "DELETE" });
    }

    async function toggleCellFlags(flagId, cells, note = "") {
        return request(`/api/engines/${TOOL_ID}/cell-flags/toggle?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ flag_id: flagId, cells, note })
        });
    }

    async function updateCellFlagNote(flagId, cells, note) {
        return request(`/api/engines/${TOOL_ID}/cell-flags/note?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify({ flag_id: flagId, cells, note })
        });
    }

    async function listFlagRules() {
        return request(`/api/engines/${TOOL_ID}/flag-rules?db=${_db()}`);
    }

    async function createFlagRule(rule) {
        return request(`/api/engines/${TOOL_ID}/flag-rules?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify(rule)
        });
    }

    async function deleteFlagRule(ruleId) {
        return request(`/api/engines/${TOOL_ID}/flag-rules/${ruleId}?db=${_db()}`, { method: "DELETE" });
    }


    // ── Templates ─────────────────────────────────────────────

    async function saveTemplate(data) {
        return request(`/api/engines/templates?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function deleteTemplate(templateId) {
        return request(`/api/engines/templates/${templateId}?db=${_db()}`, { method: "DELETE" });
    }

    async function etlSaveDraft(model) {
        return request(`/api/engines/${TOOL_ID}/etl/config?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify({ model })
        });
    }

    async function etlSqlToModel(sql) {
        return request(`/api/engines/${TOOL_ID}/etl/sql_to_model?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }

    // ── Revisions ─────────────────────────────────────────────

    async function getRevisions() {
        return request(`/api/project/revisions?db=${_db()}`);
    }

    async function createRevision(description, author) {
        return request(`/api/project/revision?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ description, author })
        });
    }

    async function deleteRevision(number) {
        return request(`/api/project/revision/${number}?db=${_db()}`, { method: "DELETE" });
    }

    async function getRevisionSnapshot(number, toolSlug) {
        return request(`/api/project/revision/${number}/tool/${encodeURIComponent(toolSlug)}?db=${_db()}`);
    }

    async function revertRevision(number) {
        return request(`/api/project/revision/${number}/revert?db=${_db()}`, { method: "POST" });
    }


    // ── Find & Replace ────────────────────────────────────────

    async function findReplace({ search, replacement, match_case, match_entire_cell, scope } = {}) {
        return request(`/api/engines/${TOOL_ID}/find_replace?db=${_db()}`, {
            method: "POST",
            body: JSON.stringify({ search, replacement, match_case, match_entire_cell, scope }),
        });
    }

    async function getColumnValues(colSlug, prefix = "") {
        const p = new URLSearchParams({ db: DB_PATH });
        if (prefix) p.set("prefix", prefix);
        return request(`/api/engines/${TOOL_ID}/column_values/${encodeURIComponent(colSlug)}?${p}`);
    }


    // ── Undo / Redo ───────────────────────────────────────────

    async function undo() {
        return request(`/api/engines/${TOOL_ID}/undo?db=${_db()}`, { method: "POST" });
    }

    async function redo() {
        return request(`/api/engines/${TOOL_ID}/redo?db=${_db()}`, { method: "POST" });
    }

    async function getUndoState() {
        return request(`/api/engines/${TOOL_ID}/undo-state?db=${_db()}`);
    }


    // ── Sort / Filter ─────────────────────────────────────────

    async function getSortFilterState() {
        return request(`/api/engines/${TOOL_ID}/sort-filter-state?db=${_db()}`);
    }

    async function setSortFilterState(state) {
        return request(`/api/engines/${TOOL_ID}/sort-filter-state?db=${_db()}`, {
            method: "PATCH",
            body: JSON.stringify(state),
        });
    }


    // ── Audit ─────────────────────────────────────────────────

    async function getAudit({ rowTag, rowTags, colSlug, colSlugs, limit = 200, revision } = {}) {
        const p = new URLSearchParams({ db: DB_PATH, limit });
        if (rowTag)        p.set("row_tag",  rowTag);
        if (rowTags)       p.set("row_tags", rowTags);
        if (colSlug)       p.set("col_slug", colSlug);
        if (colSlugs)      p.set("col_slugs", colSlugs);
        if (revision != null) p.set("revision", revision);
        return request(`/api/engines/${TOOL_ID}/audit?${p}`);
    }

    async function rollbackCell(rowId, col, entryId) {
        const p = new URLSearchParams({ db: DB_PATH, col, entry_id: entryId });
        return request(`/api/engines/${TOOL_ID}/rows/${rowId}/rollback?${p}`, { method: "POST" });
    }

    async function getUtilities(category) {
        const p = new URLSearchParams();
        if (category) p.set("category", category);
        return request(`/api/engines/utilities?${p}`);
    }


    return {
        loadTool, updateToolSettings,
        listFlags, createFlag, updateFlag, deleteFlag, toggleCellFlags, updateCellFlagNote,
        listFlagRules, createFlagRule, deleteFlagRule,
        loadColumns, addColumn, updateColumn, deleteColumn, updateColumnWidth, reorderColumns,
        loadRows, createRow, updateCell, softDeleteRow, restoreRow, hardDeleteRow,
        removeOverride, keepRow, pasteRows,
        insertRow, copyRowInsert, reorderRow,
        runSql, exportExcel,
        etlCompile, etlPreview, etlApply, etlRunSaved, etlSave,
        etlLoadConfig, etlLoadSchema, listProjectTools,
        saveTemplate, deleteTemplate, etlSaveDraft, etlSqlToModel,
        getRevisions, createRevision, deleteRevision,
        getRevisionSnapshot, revertRevision,
        getAudit, rollbackCell,
        getUtilities,
        findReplace, getColumnValues,
        getSortFilterState, setSortFilterState,
        undo, redo, getUndoState,
    };

})();
