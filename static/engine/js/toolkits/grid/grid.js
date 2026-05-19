/**
 * toolkits/grid/grid.js
 * ----------------------
 * Updated: 2026-05-19 10:00
 * Grid Toolkit adapter IIFE.
 * Wraps the shared GridManager for use inside the ToolkitHost runtime.
 * One instance per engine page (current product constraint — D-SGT-05).
 *
 * Called by ToolkitHost as: Grid.init(ctx, decl)
 * Returns the adapter API object; ToolkitHost registers it under decl.id.
 */
const Grid = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _ctx    = null;
    let _decl   = null;
    let _id     = 'grid';

    // Local ownership set: slugs whose column filters are locked by the Grouping Toolkit.
    // SortFilterManager.setGroupingOwned() is wired in Phase 2; this set guards the adapter side.
    const _ownedColumns = new Set();


    // --------------------------------------------------------
    // INIT (D-SGT-02)
    // --------------------------------------------------------

    function init(ctx, decl) {
        _ctx  = ctx;
        _decl = decl;
        _id   = decl?.id ?? 'grid';

        const config       = ctx.config[_id] ?? {};
        const endpointBase = _interpolate(config.endpointBase ?? '', ctx.engine);

        // PanelSystem before GridManager (D-SGT-02 step 2)
        if (typeof PanelSystem !== 'undefined') PanelSystem.init();

        // Grid startup fires in background so ToolkitHost receives the real instance
        // synchronously — Grouping.init can then subscribe to grid:loaded before data arrives.
        GridManager.init({ endpointBase }).catch(e => console.error('[Grid] init error', e));

        // Return adapter instance — ToolkitHost registers it under _id (D-SGT-02 step 4)
        return {
            setGroupingFilter,
            clearGroupingFilter,
            setGroupingOwned,
            releaseGroupingOwned,
            getAllRows,
            getColumns,
            setEndpointBase,
            reload,
            getActiveFilters,
            saveCellValue,
        };
    }


    // --------------------------------------------------------
    // TOKEN INTERPOLATION (D-SGT-06)
    // --------------------------------------------------------

    function _interpolate(str, engine) {
        const vars = { ...engine, toolId: engine.toolInstanceId };
        return str.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
    }


    // --------------------------------------------------------
    // GROUPING FILTER API (D-SGT-03)
    // --------------------------------------------------------

    function setGroupingFilter(column, value) {
        if (typeof SortFilterManager === 'undefined') return;
        SortFilterManager.setColumnFilter(column, [{ type: 'values', values: [value] }]);
        GridManager.applySort();
    }

    function clearGroupingFilter(column) {
        if (typeof SortFilterManager === 'undefined') return;
        SortFilterManager.clearColumnFilter(column);
        GridManager.applySort();
    }

    function setGroupingOwned(column) {
        _ownedColumns.add(column);
        if (typeof SortFilterManager !== 'undefined' && typeof SortFilterManager.setGroupingOwned === 'function') {
            SortFilterManager.setGroupingOwned(column, true);
        }
    }

    function releaseGroupingOwned(column) {
        _ownedColumns.delete(column);
        if (typeof SortFilterManager !== 'undefined' && typeof SortFilterManager.setGroupingOwned === 'function') {
            SortFilterManager.setGroupingOwned(column, false);
        }
    }


    // --------------------------------------------------------
    // DATA ACCESS (D-SGT-03)
    // --------------------------------------------------------

    function getAllRows() {
        return GridManager.getAllRows();
    }

    function getColumns() {
        if (typeof ColumnsManager !== 'undefined') return ColumnsManager.getColumns();
        return [];
    }

    function getActiveFilters() {
        if (typeof SortFilterManager !== 'undefined' && typeof SortFilterManager.getState === 'function') {
            return SortFilterManager.getState();
        }
        return {};
    }


    // --------------------------------------------------------
    // ENDPOINT SWITCH (D-SGT-03, D-SGT-04)
    // --------------------------------------------------------

    async function setEndpointBase(newAddress) {
        // D-SGT-04 reset contract — in this exact order:
        if (typeof SortFilterManager !== 'undefined') SortFilterManager.clearAll();
        if (typeof SelectionManager  !== 'undefined') SelectionManager.clearRange();
        _ownedColumns.forEach(slug => {
            if (typeof SortFilterManager !== 'undefined' && typeof SortFilterManager.setGroupingOwned === 'function') {
                SortFilterManager.setGroupingOwned(slug, false);
            }
        });
        _ownedColumns.clear();
        if (_ctx) _ctx.emit('grid:endpointChanged', { id: _id, endpointBase: newAddress });
        ApiClient.configure({ endpointBase: newAddress });
        await GridManager.reloadData();
    }

    async function reload() {
        await GridManager.reloadData();
    }

    // --------------------------------------------------------
    // CELL MUTATION (D-CAT — Catalog Toolkit extension point)
    // --------------------------------------------------------

    // Saves a single cell value via ApiClient (which already holds endpointBase).
    // Does NOT update in-memory rows — caller must call reload() after all saves.
    async function saveCellValue(rowId, field, value) {
        return ApiClient.updateCell(Number(rowId), field, value);
    }


    // --------------------------------------------------------
    // PUBLIC API — returned to ToolkitHost
    // --------------------------------------------------------

    return { init };

})();
