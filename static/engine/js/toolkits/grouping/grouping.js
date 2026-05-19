/**
 * toolkits/grouping/grouping.js
 * ------------------------------
 * Grouping Toolkit IIFE.
 * Reads unique non-empty values from a source column in a source Grid Toolkit,
 * renders a combobox in the configured slot, and injects client-side column
 * filters into one or more target Grid Toolkit instances.
 *
 * All config is static in engine.json (D-GT-08). No backend calls.
 * Called by ToolkitHost as: Grouping.init(ctx, decl)
 */
const Grouping = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _ctx    = null;
    let _id     = 'grouping';
    let _config = null;
    let _select = null;


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    function init(ctx, decl) {
        _ctx    = ctx;
        _id     = decl?.id ?? 'grouping';
        _config = ctx.config[_id] ?? {};

        const { source_toolkit_id, source_column, target_toolkit_ids = [], slot } = _config;

        if (!source_toolkit_id || !source_column) {
            console.warn('[Grouping] missing source_toolkit_id or source_column in config');
            return {};
        }

        // Mount combobox into the pre-allocated slot element (D-GT-05)
        const slotEl = slot ? document.querySelector(slot) : null;
        if (!slotEl) {
            console.warn('[Grouping] slot not found:', slot);
            return {};
        }

        _select = document.createElement('select');
        _select.className = 'grouping-combobox';
        _select.innerHTML = '<option value="">(All)</option>';
        slotEl.appendChild(_select);

        // Lock owned column on all target toolkits (D-GT-03)
        for (const targetId of target_toolkit_ids) {
            const target = ctx.getToolkit(targetId);
            if (target && typeof target.setGroupingOwned === 'function') {
                target.setGroupingOwned(source_column);
            }
        }

        // Populate combobox whenever grid data is (re)loaded (D-GT-04)
        document.addEventListener('grid:loaded', () => {
            _populateCombobox(source_toolkit_id, source_column);
        });

        // Combobox change → inject or clear filter on all target toolkits (D-GT-01, D-GT-02)
        _select.addEventListener('change', () => {
            const value = _select.value;
            for (const targetId of target_toolkit_ids) {
                const target = ctx.getToolkit(targetId);
                if (!target) continue;
                if (value === '') {
                    target.clearGroupingFilter(source_column);
                } else {
                    target.setGroupingFilter(source_column, value);
                }
            }
        });

        return {};
    }


    // --------------------------------------------------------
    // COMBOBOX POPULATION
    // --------------------------------------------------------

    function _populateCombobox(sourceId, column) {
        const source = _ctx.getToolkit(sourceId);
        if (!source) return;

        const rows = source.getAllRows();
        const values = [...new Set(
            rows
                .map(r => r[column])
                .filter(v => v !== null && v !== undefined && v !== '')
        )].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

        // Preserve current selection across repopulation (D-GT-07)
        const current = _select.value;
        _select.innerHTML = '<option value="">(All)</option>' +
            values.map(v => `<option value="${Utils.escAttr(v)}">${Utils.escHtml(v)}</option>`).join('');

        if (current && values.includes(current)) _select.value = current;
    }


    // --------------------------------------------------------
    // PUBLIC API — returned to ToolkitHost
    // --------------------------------------------------------

    return { init };

})();
