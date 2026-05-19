/**
 * toolkits/catalog/catalog.js
 * ----------------------------
 * Updated: 2026-05-19 10:00
 * Catalog Toolkit IIFE.
 * Decorates the Grid Toolkit with catalog synchronization:
 *   - TAG autocomplete via <datalist>
 *   - Tracked-column autocomplete via per-column <datalist>
 *   - Auto-fill tracked columns on TAG match (datalist pick + blur fallback)
 *   - Divergence detection: catalog-drift CSS class + tooltip (Step 6)
 *   - Catalog mode toggle (Step 7)
 *   - Save to catalog (Step 8)
 *
 * Called by ToolkitHost as: Catalog.init(ctx, decl)
 * Requires Grid Toolkit to be initialized first (reads ctx.getToolkit('grid')).
 */
const Catalog = (() => {

    // --------------------------------------------------------
    // STATE
    // --------------------------------------------------------

    let _ctx      = null;
    let _id       = 'catalog';
    let _config   = null;
    let _tracked  = [];    // tracked column slugs from config
    let _snapshot = {};    // { [tag]: { col_slug: value, ... } } — keyed by TAG
    let _gridId   = 'grid'; // id of the Grid Toolkit instance to decorate


    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------

    function init(ctx, decl) {
        _ctx     = ctx;
        _id      = decl?.id ?? 'catalog';
        _config  = ctx.config[_id] ?? {};
        _tracked = _config.tracked_columns ?? [];
        _gridId  = _config.grid_toolkit_id ?? 'grid';

        // Catalog snapshot was pre-seeded by ToolkitHost before any init() call
        _snapshot = ctx.getState('toolkits', 'catalog') ?? {};

        if (!_tracked.length) {
            console.warn('[Catalog] no tracked_columns in config — catalog inactive');
            return {};
        }

        // Insert datalist elements into <body> once DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _buildDataLists);
        } else {
            _buildDataLists();
        }

        // Re-inject list attributes on every grid reload (virtual scroll regenerates DOM)
        document.addEventListener('grid:loaded', _onGridLoaded);

        // Event delegation — capture TAG cell blur and datalist-select input events
        document.addEventListener('focusout', _onTagFocusOut);
        document.addEventListener('input',    _onTagInput);

        // Capture data endpointBase before any catalog mode toggle
        _captureDataEndpoint();

        return { refreshSnapshot, toggleCatalogMode, saveRowsToCatalog };
    }


    // --------------------------------------------------------
    // DATALIST MANAGEMENT (D-CAT-07, Steps 4 & 5)
    // --------------------------------------------------------

    function _buildDataLists() {
        _buildTagDataList();
        _buildTrackedDataLists();
    }

    function _buildTagDataList() {
        const id = 'catalog-tag-list';
        let dl = document.getElementById(id);
        if (!dl) {
            dl = document.createElement('datalist');
            dl.id = id;
            document.body.appendChild(dl);
        }
        dl.innerHTML = Object.keys(_snapshot)
            .sort()
            .map(tag => `<option value="${Utils.escAttr(tag)}">`)
            .join('');
    }

    function _buildTrackedDataLists() {
        for (const col of _tracked) {
            const id = `catalog-col-${col}-list`;
            let dl = document.getElementById(id);
            if (!dl) {
                dl = document.createElement('datalist');
                dl.id = id;
                document.body.appendChild(dl);
            }
            const values = [...new Set(
                Object.values(_snapshot)
                    .map(entry => entry[col])
                    .filter(v => v != null && v !== '')
            )].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
            dl.innerHTML = values
                .map(v => `<option value="${Utils.escAttr(String(v))}">`)
                .join('');
        }
    }

    function _injectListAttributes() {
        // TAG column
        document.querySelectorAll('input[data-field="tag"][data-editable="true"]').forEach(inp => {
            if (!inp.getAttribute('list')) inp.setAttribute('list', 'catalog-tag-list');
        });
        // Tracked columns
        for (const col of _tracked) {
            document.querySelectorAll(`input[data-field="${col}"][data-editable="true"]`).forEach(inp => {
                if (!inp.getAttribute('list')) inp.setAttribute('list', `catalog-col-${col}-list`);
            });
        }
    }


    // --------------------------------------------------------
    // GRID EVENT HANDLERS
    // --------------------------------------------------------

    function _onGridLoaded() {
        _injectListAttributes();
        _applyDivergenceMarkers();
    }


    // --------------------------------------------------------
    // PULL TRIGGERS (D-CAT-08, Step 4)
    // --------------------------------------------------------

    function _onTagInput(e) {
        const inp = e.target;
        if (!inp.matches('input[data-field="tag"][data-editable="true"]')) return;
        // Detect datalist selection: Chromium sets inputType='insertReplacementText'
        // Only fill immediately on confirmed datalist pick to avoid fills mid-typing.
        if (e.inputType !== 'insertReplacementText') return;
        const tag = inp.value.trim();
        if (tag && _snapshot[tag]) _fillFromCatalog(tag, inp.dataset.rowId);
    }

    function _onTagFocusOut(e) {
        const inp = e.target;
        if (!inp.matches('input[data-field="tag"][data-editable="true"]')) return;
        const tag = inp.value.trim();
        if (!tag || !_snapshot[tag]) return;

        const rowId = inp.dataset.rowId;
        // Blur guard: only fill if at least one tracked col differs (D-CAT-08)
        if (!_rowDiffersFromCatalog(rowId, tag)) return;
        _fillFromCatalog(tag, rowId);
    }

    function _rowDiffersFromCatalog(rowId, tag) {
        const entry = _snapshot[tag];
        if (!entry) return false;
        const gridTk = _ctx.getToolkit(_gridId);
        if (!gridTk) return false;
        const row = gridTk.getAllRows().find(r => String(r.id) === String(rowId));
        if (!row) return false;
        return _tracked.some(col => entry[col] != null && String(row[col] ?? '') !== String(entry[col]));
    }


    // --------------------------------------------------------
    // CATALOG FILL (D-CAT-05, D-CAT-08)
    // --------------------------------------------------------

    async function _fillFromCatalog(tag, rowId) {
        const entry = _snapshot[tag];
        if (!entry) return;

        const gridTk = _ctx.getToolkit(_gridId);
        if (!gridTk || typeof gridTk.saveCellValue !== 'function') {
            console.warn('[Catalog] Grid Toolkit missing saveCellValue() — cannot fill');
            return;
        }

        const saves = _tracked
            .filter(col => entry[col] != null)
            .map(col => gridTk.saveCellValue(rowId, col, entry[col]));

        try {
            await Promise.all(saves);
            await gridTk.reload();
        } catch (err) {
            console.error('[Catalog] fill error:', err);
        }
    }


    // --------------------------------------------------------
    // DIVERGENCE DETECTION (D-CAT-09, Step 6 stub)
    // --------------------------------------------------------

    function _applyDivergenceMarkers() {
        const gridTk = _ctx?.getToolkit(_gridId);
        if (!gridTk) return;
        const rows = gridTk.getAllRows();

        for (const row of rows) {
            const tag = row.tag;
            if (!tag || !_snapshot[tag]) continue;
            const entry = _snapshot[tag];
            for (const col of _tracked) {
                const td = document.querySelector(
                    `input[data-row-id="${row.id}"][data-field="${col}"]`
                )?.closest('td');
                if (!td) continue;
                const catalogVal = entry[col];
                const rowVal     = row[col];
                const drifted    = catalogVal != null && String(rowVal ?? '') !== String(catalogVal);
                td.classList.toggle('catalog-drift', drifted);
                if (drifted) {
                    td.dataset.catalogTooltip = `Catalog: ${catalogVal}`;
                } else {
                    delete td.dataset.catalogTooltip;
                }
            }
        }
    }


    // --------------------------------------------------------
    // CATALOG MODE TOGGLE (D-CAT-10, Step 7)
    // --------------------------------------------------------

    let _catalogMode = false;
    let _dataEndpointBase = null;  // saved on first switch; restored on toggle back

    // Switches the grid between data mode and catalog mode (dataset switch only).
    // engine.json must declare: { "catalog_endpoint": "..." } in the catalog toolkit config.
    function toggleCatalogMode() {
        const gridTk = _ctx.getToolkit(_gridId);
        if (!gridTk) return;

        if (!_catalogMode) {
            // Store current endpointBase before switching
            const catalogEndpoint = _config.catalog_endpoint;
            if (!catalogEndpoint) {
                console.warn('[Catalog] catalog_endpoint not configured — cannot toggle catalog mode');
                return;
            }
            _catalogMode = true;
            _ctx.setState('ui', 'catalogMode', true);
            gridTk.setEndpointBase(catalogEndpoint);
        } else {
            if (!_dataEndpointBase) return;
            _catalogMode = false;
            _ctx.setState('ui', 'catalogMode', false);
            gridTk.setEndpointBase(_dataEndpointBase);
        }
    }

    // Capture the data endpointBase on first grid:endpointChanged event before any toggle
    function _captureDataEndpoint() {
        _ctx.on('grid:endpointChanged', ({ endpointBase }) => {
            if (!_catalogMode) _dataEndpointBase = endpointBase;
        });
    }


    // --------------------------------------------------------
    // SAVE TO CATALOG (D-CAT-11, Step 8)
    // --------------------------------------------------------

    // Saves selected rows to the catalog. `rows` is an array of row objects.
    // Skips rows with empty TAG. Shows confirmation dialog for existing TAGs.
    async function saveRowsToCatalog(rows) {
        const engine = _ctx.engine;
        const { slug, toolInstanceId: toolId } = engine;
        const db = _getDb();

        const toSave = rows.filter(r => r.tag);
        if (!toSave.length) return;

        for (const row of toSave) {
            const data = {};
            for (const col of _tracked) {
                if (row[col] != null) data[col] = row[col];
            }
            const res = await fetch(
                `/api/engines/${slug}/tools/${toolId}/catalog/entry?db=${encodeURIComponent(db)}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tag: row.tag, data, force: false }) }
            ).then(r => r.json());

            if (!res.ok && res.conflict) {
                const confirmed = confirm(`TAG "${row.tag}" already in catalog — overwrite?`);
                if (!confirmed) continue;
                await fetch(
                    `/api/engines/${slug}/tools/${toolId}/catalog/entry?db=${encodeURIComponent(db)}`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ tag: row.tag, data, force: true }) }
                );
            }

            // Update local snapshot
            _snapshot[row.tag] = data;
        }

        refreshSnapshot(_snapshot);
    }

    function _getDb() {
        // Recover db path from the URL query string (set by the engine page template)
        return new URLSearchParams(window.location.search).get('db') ?? '';
    }


    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    // Called externally (e.g. after "Save to catalog") to update the local snapshot.
    function refreshSnapshot(newSnapshot) {
        _snapshot = newSnapshot ?? {};
        _ctx.setState('toolkits', 'catalog', _snapshot);
        _buildDataLists();
        _applyDivergenceMarkers();
    }

    return { init };

})();
