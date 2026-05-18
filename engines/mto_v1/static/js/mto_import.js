/* MTO import panel — slide-in drawer for importing typicals from an external project DB. */
const MtoImport = (() => {
    let _panel = null;
    let _toolId = null;
    let _db = null;

    function _dbParam() { return `db=${encodeURIComponent(_db)}`; }

    function _esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Panel DOM ────────────────────────────────────────────────────────

    function _buildPanel() {
        const el = document.createElement('div');
        el.className = 'mto-import-panel';
        el.innerHTML =
            '<div class="mto-import-header">' +
                '<span class="mto-import-title">Import Typical</span>' +
                '<button class="mto-import-close" title="Close">&#x2715;</button>' +
            '</div>' +
            '<div class="mto-import-db-row">' +
                '<input type="text" class="mto-import-path-input" placeholder="Path to source .db file…">' +
                '<button class="mto-import-load btn btn-sm btn-ghost">Load</button>' +
            '</div>' +
            '<div class="mto-import-list"></div>';

        el.querySelector('.mto-import-close').addEventListener('click', close);
        el.querySelector('.mto-import-load').addEventListener('click', _loadTypicals);
        el.querySelector('.mto-import-path-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') _loadTypicals();
        });
        document.body.appendChild(el);
        return el;
    }

    // ── Load typicals from source DB ────────────────────────────────────

    async function _loadTypicals() {
        const input = _panel.querySelector('.mto-import-path-input');
        const dbPath = input.value.trim();
        if (!dbPath) return;
        const listEl = _panel.querySelector('.mto-import-list');
        listEl.innerHTML = '<p class="mto-import-msg">Loading…</p>';
        try {
            const res = await fetch(
                `/api/engines/mto/import/list?db_path=${encodeURIComponent(dbPath)}`
            );
            const data = await res.json();
            if (!res.ok) {
                listEl.innerHTML =
                    `<p class="mto-import-error">${_esc(data.detail || 'Error loading source DB')}</p>`;
                return;
            }
            _renderList(listEl, data.typicals, dbPath);
        } catch (err) {
            listEl.innerHTML = `<p class="mto-import-error">${_esc(err.message)}</p>`;
        }
    }

    // ── Render typical cards ────────────────────────────────────────────

    function _renderList(listEl, typicals, dbPath) {
        if (!typicals.length) {
            listEl.innerHTML = '<p class="mto-import-msg">No typicals found in source DB.</p>';
            return;
        }
        listEl.innerHTML = '';
        typicals.forEach(t => {
            const card = document.createElement('div');
            card.className = 'mto-import-card';

            let imgHtml = '';
            if (t.image_format === 'svg') {
                const src = `/api/engines/mto/import/image?db_path=${encodeURIComponent(dbPath)}&typical_id=${t.id}`;
                imgHtml = `<img class="mto-import-thumb" src="${src}" alt="" loading="lazy">`;
            } else if (t.has_image) {
                imgHtml =
                    `<div class="mto-import-thumb-badge">${_esc((t.image_format || '').toUpperCase())}</div>`;
            }

            const matLabel = t.material_count === 1 ? '1 material' : `${t.material_count} materials`;
            const descHtml = t.description
                ? `<div class="mto-import-card-desc">${_esc(t.description)}</div>`
                : '';

            card.innerHTML =
                '<div class="mto-import-card-body">' +
                    imgHtml +
                    '<div class="mto-import-card-info">' +
                        `<div class="mto-import-card-name">${_esc(t.name)}</div>` +
                        descHtml +
                        `<div class="mto-import-card-meta">${_esc(matLabel)}</div>` +
                    '</div>' +
                '</div>' +
                '<button class="mto-import-btn btn btn-sm">Import</button>';

            card.querySelector('.mto-import-btn').addEventListener('click', () =>
                _doImport(card, dbPath, t)
            );
            listEl.appendChild(card);
        });
    }

    // ── Import one typical ───────────────────────────────────────────────

    async function _doImport(card, dbPath, t) {
        const btn = card.querySelector('.mto-import-btn');
        btn.disabled = true;
        btn.textContent = 'Importing…';
        try {
            const res = await fetch(
                `/api/engines/mto/${_toolId}/import?${_dbParam()}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source_db_path: dbPath,
                        source_typical_id: t.id,
                        target_typical_name: t.name,
                    }),
                }
            );
            const data = await res.json();
            if (!res.ok) {
                btn.disabled = false;
                btn.textContent = 'Import';
                const msg = data.detail || 'Import failed';
                if (typeof Utils !== 'undefined') Utils.showToast(msg, 'error');
                else alert(msg);
                return;
            }
            btn.textContent = '✓ Imported';
            if (typeof Utils !== 'undefined') Utils.showToast(`Imported "${t.name}"`, 'success');
            MtoShell.reloadTabs();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Import';
            const msg = 'Import error: ' + err.message;
            if (typeof Utils !== 'undefined') Utils.showToast(msg, 'error');
            else alert(msg);
        }
    }

    // ── Public API ───────────────────────────────────────────────────────

    function open() {
        _toolId = window.MTO_TOOL;
        _db = window.MTO_DB;
        if (!_panel) _panel = _buildPanel();
        _panel.classList.add('open');
    }

    function close() {
        if (_panel) _panel.classList.remove('open');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('btn-import-typical');
        if (btn) btn.addEventListener('click', open);
    });

    return { open, close };
})();
