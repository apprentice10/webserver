/**
 * api.js — Engine
 * ----------------
 * Client HTTP universale del Table Engine.
 * Unico modulo autorizzato a fare fetch verso il backend.
 *
 * Tutti i metodi sono async e restituiscono dati già parsati.
 * PROJECT_ID e TOOL_ID sono iniettati dal template Jinja2.
 */

const ApiClient = (() => {

    // --------------------------------------------------------
    // UTILITY INTERNA
    // --------------------------------------------------------

    async function request(url, options = {}) {
        const response = await fetch(url, {
            headers: { "Content-Type": "application/json" },
            ...options
        });

        if (!response.ok) {
            let detail = `Errore HTTP ${response.status}`;
            try {
                const err = await response.json();
                detail = err.detail || detail;
            } catch (_) {}
            throw new Error(detail);
        }

        if (response.status === 204) return null;
        return response.json();
    }


    // --------------------------------------------------------
    // TOOL
    // --------------------------------------------------------

    async function loadTool() {
        return request(`/api/tools/${TOOL_ID}?project_id=${PROJECT_ID}`);
    }

    async function updateToolSettings(data) {
        return request(`/api/tools/${TOOL_ID}/settings?project_id=${PROJECT_ID}`, {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }


    // --------------------------------------------------------
    // COLONNE
    // --------------------------------------------------------

    async function loadColumns() {
        return request(`/api/tools/${TOOL_ID}/columns?project_id=${PROJECT_ID}`);
    }

    async function addColumn(data) {
        return request(`/api/tools/${TOOL_ID}/columns?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function updateColumn(columnId, data) {
        return request(
            `/api/tools/${TOOL_ID}/columns/${columnId}?project_id=${PROJECT_ID}`,
            { method: "PATCH", body: JSON.stringify(data) }
        );
    }

    async function deleteColumn(columnId) {
        return request(
            `/api/tools/${TOOL_ID}/columns/${columnId}?project_id=${PROJECT_ID}`,
            { method: "DELETE" }
        );
    }

    async function updateColumnWidth(columnId, width) {
        return request(
            `/api/tools/${TOOL_ID}/columns/${columnId}/width?project_id=${PROJECT_ID}`,
            { method: "PATCH", body: JSON.stringify({ width }) }
        );
    }

    async function reorderColumns(orderedIds) {
        return request(
            `/api/tools/${TOOL_ID}/columns/reorder?project_id=${PROJECT_ID}`,
            { method: "PUT", body: JSON.stringify({ order: orderedIds }) }
        );
    }


    // --------------------------------------------------------
    // RIGHE
    // --------------------------------------------------------

    async function loadRows(includeDeleted = false) {
        return request(
            `/api/tools/${TOOL_ID}/rows?project_id=${PROJECT_ID}&include_deleted=${includeDeleted}`
        );
    }

    async function createRow(cells) {
        return request(`/api/tools/${TOOL_ID}/rows?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify({ cells })
        });
    }

    async function updateCell(rowId, slug, value) {
        return request(
            `/api/tools/${TOOL_ID}/rows/${rowId}/cell?project_id=${PROJECT_ID}`,
            { method: "PATCH", body: JSON.stringify({ slug, value }) }
        );
    }

    async function softDeleteRow(rowId) {
        return request(
            `/api/tools/${TOOL_ID}/rows/${rowId}/delete?project_id=${PROJECT_ID}`,
            { method: "POST" }
        );
    }

    async function restoreRow(rowId) {
        return request(
            `/api/tools/${TOOL_ID}/rows/${rowId}/restore?project_id=${PROJECT_ID}`,
            { method: "POST" }
        );
    }

    async function hardDeleteRow(rowId) {
        return request(
            `/api/tools/${TOOL_ID}/rows/${rowId}/hard-delete?project_id=${PROJECT_ID}`,
            { method: "POST" }
        );
    }

    async function removeOverride(rowId, colSlug) {
        return request(
            `/api/tools/${TOOL_ID}/rows/${rowId}/override?col=${encodeURIComponent(colSlug)}&project_id=${PROJECT_ID}`,
            { method: "DELETE" }
        );
    }

    async function pasteRows(rows) {
        return request(`/api/tools/${TOOL_ID}/rows/paste?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify({ rows })
        });
    }


    // --------------------------------------------------------
    // SQL EDITOR
    // --------------------------------------------------------

    async function runSql(sql) {
        return request(`/api/tools/${TOOL_ID}/sql?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }


    // --------------------------------------------------------
    // EXPORT
    // --------------------------------------------------------

    function exportExcel() {
        window.location.href =
            `/api/tools/${TOOL_ID}/export/excel?project_id=${PROJECT_ID}`;
    }

    // --------------------------------------------------------
    // ETL
    // --------------------------------------------------------

    async function etlPreview(sql) {
        return request(`/api/tools/${TOOL_ID}/etl/preview?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }

    async function etlApply(sql) {
        return request(`/api/tools/${TOOL_ID}/etl/apply?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify({ sql })
        });
    }

    async function etlSave(sql, label = null) {
        return request(`/api/tools/${TOOL_ID}/etl/save?project_id=${PROJECT_ID}`, {
            method: "POST",
            body: JSON.stringify({ sql, label })
        });
    }

    async function etlRunSaved() {
        return request(`/api/tools/${TOOL_ID}/etl/run?project_id=${PROJECT_ID}`, {
            method: "POST"
        });
    }

    async function etlLoadConfig() {
        return request(`/api/tools/${TOOL_ID}/etl/config?project_id=${PROJECT_ID}`);
    }

    async function etlLoadSchema() {
        return request(`/api/tools/${TOOL_ID}/etl/schema?project_id=${PROJECT_ID}`);
    }


    // --------------------------------------------------------
    // TEMPLATE
    // --------------------------------------------------------

    async function saveTemplate(data) {
        return request("/api/tools/templates", {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function deleteTemplate(templateId) {
        return request(`/api/tools/templates/${templateId}`, { method: "DELETE" });
    }


    // --------------------------------------------------------
    // API PUBBLICA
    // --------------------------------------------------------

    return {
        loadTool,
        updateToolSettings,
        loadColumns,
        addColumn,
        updateColumn,
        deleteColumn,
        updateColumnWidth,
        reorderColumns,
        loadRows,
        createRow,
        updateCell,
        softDeleteRow,
        restoreRow,
        hardDeleteRow,
        removeOverride,
        pasteRows,
        runSql,
        exportExcel,
        etlPreview,
        etlApply,
        etlRunSaved,
        etlSave,
        etlLoadConfig,
        etlLoadSchema,
        saveTemplate,
        deleteTemplate
    };

})();