const EtlCanvasPanel = (() => {

    const DEST_ID = '__destination__';
    let _onChange = null;

    function _esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function close() {
        document.getElementById('ecv-panel')?.classList.remove('ecv-panel--open');
    }

    // ── HTML builders ─────────────────────────────────────────────────────────

    function _sourceHtml(node) {
        return `<div class="ecv-panel-section">
            <div class="ecv-info-row"><span>Name</span><span>${_esc(node.name)}</span></div>
            <div class="ecv-info-row"><span>Alias</span><span>${_esc(node.alias || '—')}</span></div>
            <div class="ecv-info-row"><span>Type</span><span>${_esc(node.type)}</span></div>
        </div>`;
    }

    function _destHtml(toolCols) {
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Tool columns</div>
            <ul class="ecv-dest-cols">${toolCols.map(c => `<li>${_esc(c.name || c.slug)}</li>`).join('') || '<li class="ecv-muted">No columns</li>'}</ul>
        </div>`;
    }

    function _colListHtml(cols) {
        return (cols || []).map((c, i) =>
            `<div class="ecv-col-row" data-idx="${i}">
                <input class="ecv-col-alias" value="${_esc(c.alias)}" placeholder="alias" data-field="alias" />
                <input class="ecv-col-formula ecv-mono" value="${_esc(EtlDsl.serialize(c.expr))}" placeholder="expr" data-field="formula" />
                <div class="ecv-col-err"></div>
                <button class="ecv-col-remove" title="Remove">×</button>
            </div>`).join('');
    }

    function _gbListHtml(exprs) {
        return (exprs || []).map((e, i) =>
            `<div class="ecv-gb-row" data-idx="${i}">
                <input class="ecv-col-formula ecv-mono" value="${_esc(EtlDsl.serialize(e))}" placeholder="expression" data-field="gb" />
                <button class="ecv-col-remove" title="Remove">×</button>
            </div>`).join('');
    }

    function _selectHtml(node) {
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Output Columns</div>
            <div class="ecv-col-list" id="ecv-cols">
                ${_colListHtml(node.columns)}
            </div>
            <button class="ecv-col-add" data-action="add-col">+ Column</button>
        </div>`;
    }

    function _filterHtml(node) {
        const modes = ['where', 'having'].map(m =>
            `<option value="${m}"${node.mode === m ? ' selected' : ''}>${m.toUpperCase()}</option>`).join('');
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Mode</div>
            <select class="ecv-panel-select" id="ecv-filter-mode">${modes}</select>
            <div class="ecv-panel-label" style="margin-top:8px">Condition</div>
            <textarea class="ecv-formula-bar ecv-mono" id="ecv-filter-cond" rows="3">${_esc(EtlDsl.serialize(node.condition))}</textarea>
            <div class="ecv-formula-err" id="ecv-filter-cond-err"></div>
        </div>`;
    }

    function _joinHtml(node, sourceList) {
        const types = ['INNER', 'LEFT', 'RIGHT', 'CROSS'].map(t =>
            `<option${node.join_type === t ? ' selected' : ''}>${t}</option>`).join('');
        const srcs = sourceList.map(s =>
            `<option value="${_esc(s.id)}"${node.right_source === s.id ? ' selected' : ''}>${_esc(s.label)}</option>`).join('');
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Join Type</div>
            <select class="ecv-panel-select" id="ecv-join-type">${types}</select>
            <div class="ecv-panel-label" style="margin-top:8px">Right Source</div>
            <select class="ecv-panel-select" id="ecv-join-right">${srcs}</select>
            <div class="ecv-panel-label" style="margin-top:8px">Condition</div>
            <textarea class="ecv-formula-bar ecv-mono" id="ecv-join-cond" rows="3">${_esc(EtlDsl.serialize(node.condition))}</textarea>
            <div class="ecv-formula-err" id="ecv-join-cond-err"></div>
            <div class="ecv-panel-label" style="margin-top:8px">Projection</div>
            <div class="ecv-col-list" id="ecv-cols">
                ${_colListHtml(node.columns)}
            </div>
            <button class="ecv-col-add" data-action="add-col">+ Column</button>
        </div>`;
    }

    function _aggregateHtml(node) {
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Group By</div>
            <div class="ecv-col-list" id="ecv-gb">${_gbListHtml(node.group_by)}</div>
            <button class="ecv-col-add" data-action="add-gb">+ Expression</button>
        </div>
        <div class="ecv-panel-section">
            <div class="ecv-panel-label">Aggregations</div>
            <div class="ecv-col-list" id="ecv-agg">${_colListHtml(node.aggregations)}</div>
            <button class="ecv-col-add" data-action="add-agg">+ Column</button>
        </div>`;
    }

    function _computeColHtml(node) {
        const col = node.column || { alias: '', expr: { type: 'literal', value: null } };
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">New Column</div>
            <input class="ecv-col-alias" id="ecv-compute-alias" value="${_esc(col.alias)}" placeholder="alias" style="width:100%;box-sizing:border-box;margin-bottom:6px" />
            <textarea class="ecv-formula-bar ecv-mono" id="ecv-compute-expr" rows="3">${_esc(EtlDsl.serialize(col.expr))}</textarea>
            <div class="ecv-formula-err" id="ecv-compute-expr-err"></div>
        </div>`;
    }

    function _genSeriesHtml(node) {
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Alias</div>
            <input class="ecv-col-alias" id="ecv-gs-alias" value="${_esc(node.alias || '')}" placeholder="alias" style="width:100%;box-sizing:border-box;margin-bottom:6px" />
            <div class="ecv-panel-label">Start (integer)</div>
            <input type="number" class="ecv-col-alias" id="ecv-gs-start" value="${_esc(node.start ?? 1)}" style="width:100%;box-sizing:border-box;margin-bottom:6px" />
            <div class="ecv-panel-label">End Expression</div>
            <textarea class="ecv-formula-bar ecv-mono" id="ecv-gs-end" rows="2">${_esc(EtlDsl.serialize(node.end_expr))}</textarea>
            <div class="ecv-formula-err" id="ecv-gs-end-err"></div>
        </div>`;
    }

    function _cteHtml(node) {
        return `<div class="ecv-panel-section">
            <div class="ecv-panel-label">Name</div>
            <input class="ecv-col-alias" id="ecv-cte-name" value="${_esc(node.name || '')}" placeholder="cte_name" style="width:100%;box-sizing:border-box;margin-bottom:6px" />
            <div class="ecv-panel-label">Alias</div>
            <input class="ecv-col-alias" id="ecv-cte-alias" value="${_esc(node.alias || '')}" placeholder="alias" style="width:100%;box-sizing:border-box;margin-bottom:6px" />
            <div class="ecv-panel-label">SQL</div>
            <textarea class="ecv-formula-bar ecv-mono" id="ecv-cte-sql" rows="5">${_esc(node.sql || '')}</textarea>
        </div>`;
    }


    // ── Event binding ─────────────────────────────────────────────────────────

    function _bindFormulaBar(id, onSave) {
        const el  = document.getElementById(id);
        const err = document.getElementById(id + '-err');
        if (!el) return;
        el.addEventListener('blur', () => {
            const { ast, error } = EtlDsl.tryParse(el.value);
            if (error) { if (err) err.textContent = error; el.classList.add('ecv-formula-bar--error'); return; }
            if (err) err.textContent = '';
            el.classList.remove('ecv-formula-bar--error');
            onSave(ast);
        });
    }

    function _bindColList(node) {
        const cols   = document.getElementById('ecv-cols');
        const addBtn = document.querySelector('[data-action="add-col"]');
        if (!cols) return;

        cols.addEventListener('blur', e => {
            const row = e.target.closest('.ecv-col-row');
            if (!row) return;
            const i = Number(row.dataset.idx);
            if (e.target.dataset.field === 'alias') {
                node.columns[i].alias = e.target.value;
                _onChange();
            } else if (e.target.dataset.field === 'formula') {
                const { ast, error } = EtlDsl.tryParse(e.target.value);
                const err = row.querySelector('.ecv-col-err');
                if (error) { err.textContent = error; e.target.classList.add('ecv-formula-bar--error'); return; }
                err.textContent = ''; e.target.classList.remove('ecv-formula-bar--error');
                node.columns[i].expr = ast;
                _onChange();
            }
        }, true);

        cols.addEventListener('click', e => {
            if (!e.target.classList.contains('ecv-col-remove')) return;
            const i = Number(e.target.closest('.ecv-col-row').dataset.idx);
            node.columns.splice(i, 1);
            cols.innerHTML = _colListHtml(node.columns);
            _onChange();
        });

        addBtn?.addEventListener('click', () => {
            if (!node.columns) node.columns = [];
            node.columns.push({ id: `c_${Date.now()}`, alias: '', expr: { type: 'literal', value: null } });
            cols.innerHTML = _colListHtml(node.columns);
            _onChange();
        });
    }

    function _bindGbList(node) {
        const gb = document.getElementById('ecv-gb');
        if (!gb) return;
        gb.addEventListener('blur', e => {
            const row = e.target.closest('.ecv-gb-row');
            if (!row || e.target.dataset.field !== 'gb') return;
            const i = Number(row.dataset.idx);
            const { ast, error } = EtlDsl.tryParse(e.target.value);
            if (error) { e.target.classList.add('ecv-formula-bar--error'); return; }
            e.target.classList.remove('ecv-formula-bar--error');
            node.group_by[i] = ast;
            _onChange();
        }, true);
        gb.addEventListener('click', e => {
            if (!e.target.classList.contains('ecv-col-remove')) return;
            const i = Number(e.target.closest('.ecv-gb-row').dataset.idx);
            node.group_by.splice(i, 1);
            gb.innerHTML = _gbListHtml(node.group_by);
            _onChange();
        });
        document.querySelector('[data-action="add-gb"]')?.addEventListener('click', () => {
            node.group_by.push({ type: 'literal', value: null });
            gb.innerHTML = _gbListHtml(node.group_by);
            _onChange();
        });
    }

    function _bindAggColList(node) {
        const agg    = document.getElementById('ecv-agg');
        const addBtn = document.querySelector('[data-action="add-agg"]');
        if (!agg) return;
        agg.addEventListener('blur', e => {
            const row = e.target.closest('.ecv-col-row');
            if (!row) return;
            const i = Number(row.dataset.idx);
            if (e.target.dataset.field === 'alias') {
                node.aggregations[i].alias = e.target.value;
                _onChange();
            } else if (e.target.dataset.field === 'formula') {
                const { ast, error } = EtlDsl.tryParse(e.target.value);
                const err = row.querySelector('.ecv-col-err');
                if (error) { err.textContent = error; e.target.classList.add('ecv-formula-bar--error'); return; }
                err.textContent = ''; e.target.classList.remove('ecv-formula-bar--error');
                node.aggregations[i].expr = ast;
                _onChange();
            }
        }, true);
        agg.addEventListener('click', e => {
            if (!e.target.classList.contains('ecv-col-remove')) return;
            const i = Number(e.target.closest('.ecv-col-row').dataset.idx);
            node.aggregations.splice(i, 1);
            agg.innerHTML = _colListHtml(node.aggregations);
            _onChange();
        });
        addBtn?.addEventListener('click', () => {
            node.aggregations.push({ id: `c_${Date.now()}`, alias: '', expr: { type: 'literal', value: null } });
            agg.innerHTML = _colListHtml(node.aggregations);
            _onChange();
        });
    }

    function _bindPanel(node, sourceList) {
        // Filter
        document.getElementById('ecv-filter-mode')?.addEventListener('change', e => { node.mode = e.target.value; _onChange(); });
        _bindFormulaBar('ecv-filter-cond', ast => { node.condition = ast; _onChange(); });
        // Join
        document.getElementById('ecv-join-type')?.addEventListener('change', e => { node.join_type = e.target.value; _onChange(); });
        document.getElementById('ecv-join-right')?.addEventListener('change', e => {
            node.right_source = e.target.value;
            if (node.inputs?.length >= 2) node.inputs[1] = e.target.value;
            _onChange();
        });
        _bindFormulaBar('ecv-join-cond', ast => { node.condition = ast; _onChange(); });
        // Type-specific lists
        if (node.type === 'select' || node.type === 'join') {
            _bindColList(node);
        } else if (node.type === 'aggregate') {
            _bindGbList(node);
            _bindAggColList(node);
        } else if (node.type === 'compute_column') {
            document.getElementById('ecv-compute-alias')?.addEventListener('blur', e => { node.column.alias = e.target.value; _onChange(); });
            _bindFormulaBar('ecv-compute-expr', ast => { node.column.expr = ast; _onChange(); });
        } else if (node.type === 'generate_series') {
            document.getElementById('ecv-gs-alias')?.addEventListener('blur', e => { node.alias = e.target.value; _onChange(); });
            document.getElementById('ecv-gs-start')?.addEventListener('blur', e => { node.start = parseInt(e.target.value, 10) || 1; _onChange(); });
            _bindFormulaBar('ecv-gs-end', ast => { node.end_expr = ast; _onChange(); });
        } else if (node.type === 'cte') {
            document.getElementById('ecv-cte-name')?.addEventListener('blur',  e => { node.name  = e.target.value; _onChange(); });
            document.getElementById('ecv-cte-alias')?.addEventListener('blur', e => { node.alias = e.target.value; _onChange(); });
            document.getElementById('ecv-cte-sql')?.addEventListener('blur',   e => { node.sql   = e.target.value; _onChange(); });
        }
    }


    // ── Open ──────────────────────────────────────────────────────────────────

    function open(nodeId, model, sourceList, toolCols, onChange) {
        _onChange = onChange;
        const panel = document.getElementById('ecv-panel');
        const title = document.getElementById('ecv-panel-title');
        const body  = document.getElementById('ecv-panel-body');
        if (!panel || !title || !body) return;

        if (nodeId === DEST_ID) {
            title.textContent = 'Destination';
            body.innerHTML    = _destHtml(toolCols);
            panel.classList.add('ecv-panel--open');
            return;
        }

        const node = [...(model.sources || []), ...(model.transformations || [])].find(n => n.id === nodeId);
        if (!node) return;

        title.textContent = `${node.type} · ${node.id}`;

        if      (node.type === 'table')           body.innerHTML = _sourceHtml(node);
        else if (node.type === 'cte')             body.innerHTML = _cteHtml(node);
        else if (node.type === 'generate_series') body.innerHTML = _genSeriesHtml(node);
        else if (node.type === 'select')          body.innerHTML = _selectHtml(node);
        else if (node.type === 'filter')          body.innerHTML = _filterHtml(node);
        else if (node.type === 'join')            body.innerHTML = _joinHtml(node, sourceList);
        else if (node.type === 'aggregate')       body.innerHTML = _aggregateHtml(node);
        else if (node.type === 'compute_column')  body.innerHTML = _computeColHtml(node);
        else body.innerHTML = `<pre class="ecv-panel-json">${_esc(JSON.stringify(node, null, 2))}</pre>`;

        panel.classList.add('ecv-panel--open');
        if (node.type !== 'table') _bindPanel(node, sourceList);
    }


    return { open, close };

})();
