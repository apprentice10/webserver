/**
 * revision-picker.js — Engine
 * ----------------------------
 * chip-rev button popover: list, create, delete, and switch project revisions.
 * Owns read-only mode: switches grid to snapshot data, shows amber banner,
 * disables ETL, and enforces back-to-current / revert flow.
 *
 * Depends on: ApiClient, Utils, GridManager, ToolbarManager
 */

const RevisionPicker = (() => {

    let _revisions       = [];
    let _current         = 0;
    let _popover         = null;
    let _creating        = false;
    let _viewingRevision = null;   // null = live; integer = snapshot number


    // ── Init ──────────────────────────────────────────────────

    async function init() {
        const btn = document.getElementById('chip-rev-btn');
        if (!btn) return;

        btn.addEventListener('click', () => {
            if (_popover) { _close(); return; }
            _open(btn);
        });

        document.addEventListener('mousedown', e => {
            if (_popover && !_popover.contains(e.target) && e.target !== btn) _close();
        });

        await _load();
    }


    // ── Data ──────────────────────────────────────────────────

    async function _load() {
        try {
            const data = await ApiClient.getRevisions();
            _revisions = data.revisions || [];
            _current   = data.current  ?? 0;
            _updateChip();
            if (_popover) _renderInto(_popover);
        } catch (err) {
            Utils.showToast('Could not load revisions: ' + err.message, 'error');
        }
    }

    function _updateChip() {
        const btn = document.getElementById('chip-rev-btn');
        if (!btn) return;
        btn.textContent = _viewingRevision !== null
            ? `Rev ${_viewingRevision} (viewing)`
            : `Rev ${_current}`;
    }


    // ── Popover lifecycle ─────────────────────────────────────

    function _open(anchor) {
        _creating = false;
        _popover  = document.createElement('div');
        _popover.className = 'rev-picker';
        document.body.appendChild(_popover);
        _position(anchor);
        _renderInto(_popover);
    }

    function _position(anchor) {
        const rect = anchor.getBoundingClientRect();
        _popover.style.top  = (rect.bottom + 6 + window.scrollY) + 'px';
        _popover.style.left = rect.left + 'px';
    }

    function _close() {
        _popover?.remove();
        _popover  = null;
        _creating = false;
    }


    // ── Render ────────────────────────────────────────────────

    function _renderInto(el) {
        const latestNum = _revisions.length ? _revisions[_revisions.length - 1].number : -1;

        const items = [..._revisions].reverse().map(r => {
            const isLatest  = r.number === latestNum;
            const isViewing = r.number === _viewingRevision;
            const date      = (r.created_at || '').slice(0, 16).replace('T', ' ');
            const author    = r.author      ? Utils.escHtml(r.author)      : '—';
            const desc      = r.description ? Utils.escHtml(r.description) : '';
            const canDel    = isLatest && _revisions.length > 1;
            const activeClass = (isViewing || (r.number === _current && _viewingRevision === null))
                ? 'rev-item-active' : '';
            const clickClass  = (!isLatest || _viewingRevision !== null) ? ' rev-item-clickable' : '';

            return `<div class="rev-item ${activeClass}${clickClass}" data-rev="${r.number}">
                <div class="rev-item-row">
                    <span class="rev-item-num">Rev ${r.number}</span>
                    ${isLatest ? '<span class="rev-item-badge">latest</span>' : ''}
                    ${isViewing ? '<span class="rev-item-badge rev-item-badge-viewing">viewing</span>' : ''}
                    ${canDel ? `<button class="rev-item-del" data-del="${r.number}" title="Delete — merge into Rev ${r.number - 1}">✕</button>` : ''}
                </div>
                <div class="rev-item-meta">${Utils.escHtml(date)} · ${author}</div>
                ${desc ? `<div class="rev-item-desc">${desc}</div>` : ''}
            </div>`;
        }).join('') || '<div class="rev-empty">No revisions found.</div>';

        const form = _creating
            ? `<div class="rev-create-form">
                <input class="rev-create-input" id="rp-desc"   placeholder="Description (optional)">
                <input class="rev-create-input" id="rp-author" placeholder="Author (optional)">
                <div class="rev-create-btns">
                    <button class="btn btn-ghost btn-sm" id="rp-cancel">Cancel</button>
                    <button class="btn btn-sm"           id="rp-confirm">Create Rev ${latestNum + 1}</button>
                </div>
               </div>`
            : `<button class="rev-new-btn" id="rp-new">＋ Create new revision…</button>`;

        el.innerHTML = `<div class="rev-picker-title">Revisions</div>${form}<div class="rev-list">${items}</div>`;
        _bindEvents(el, latestNum);
    }

    function _bindEvents(el, latestNum) {
        el.querySelector('#rp-new')?.addEventListener('click', () => {
            _creating = true;
            _renderInto(el);
            el.querySelector('#rp-desc')?.focus();
        });

        el.querySelector('#rp-cancel')?.addEventListener('click', () => {
            _creating = false;
            _renderInto(el);
        });

        el.querySelector('#rp-confirm')?.addEventListener('click', async () => {
            const desc   = (el.querySelector('#rp-desc')?.value   || '').trim();
            const author = (el.querySelector('#rp-author')?.value || '').trim();
            await _doCreate(desc, author, el, latestNum);
        });

        el.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const num = parseInt(btn.dataset.del, 10);
                if (!confirm(`Delete Rev ${num}? Its changes will be merged into Rev ${num - 1}.`)) return;
                await _doDelete(num);
            });
        });

        el.querySelectorAll('.rev-item[data-rev]').forEach(item => {
            item.addEventListener('click', async e => {
                if (e.target.closest('[data-del]')) return;
                const num = parseInt(item.dataset.rev, 10);
                if (num === latestNum && _viewingRevision === null) return;
                if (num === latestNum && _viewingRevision !== null) {
                    _close();
                    await _backToCurrent();
                } else if (num !== latestNum) {
                    _close();
                    await _switchToRevision(num);
                }
            });
        });
    }


    // ── Actions ───────────────────────────────────────────────

    async function _doCreate(description, author, el, latestNum) {
        const confirmBtn = el?.querySelector('#rp-confirm');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Creating…'; }
        try {
            await ApiClient.createRevision(description, author);
            await _load();
            Utils.showToast(`Rev ${_current} created`, 'success');
        } catch (err) {
            Utils.showToast(err.message || 'Create failed', 'error');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = `Create Rev ${latestNum + 1}`;
            }
        }
    }

    async function _doDelete(number) {
        try {
            await ApiClient.deleteRevision(number);
            await _load();
            Utils.showToast(`Rev ${number} deleted`, 'success');
        } catch (err) {
            Utils.showToast(err.message || 'Delete failed', 'error');
        }
    }

    async function _switchToRevision(number) {
        const toolSlug = ToolbarManager.getToolSlug();
        if (!toolSlug) {
            Utils.showToast('Tool not loaded — try again', 'error');
            return;
        }
        try {
            const data = await ApiClient.getRevisionSnapshot(number, toolSlug);
            _viewingRevision = number;
            _updateChip();
            GridManager.loadSnapshotData(data.columns, data.rows);
            GridManager.setReadOnly(true);
            _showBanner(number);
            _setEtlDisabled(true);
            document.dispatchEvent(new CustomEvent('revision:switched'));
        } catch (err) {
            Utils.showToast('Could not load revision: ' + err.message, 'error');
        }
    }

    async function _backToCurrent() {
        _viewingRevision = null;
        _updateChip();
        _hideBanner();
        _setEtlDisabled(false);
        GridManager.setReadOnly(false);
        document.dispatchEvent(new CustomEvent('revision:switched'));
        try {
            await GridManager.reloadData();
            await _load();
        } catch (err) {
            Utils.showToast('Could not reload live data: ' + err.message, 'error');
        }
    }

    async function _doRevert(number) {
        if (!confirm(
            `Revert to revision ${number}?\n\n` +
            `This is destructive — all changes since revision ${number} will be permanently removed.\n` +
            `A safety backup will be created first.`
        )) return;
        try {
            await ApiClient.revertRevision(number);
            Utils.showToast(`Reverted to revision ${number} — reloading…`, 'success');
            setTimeout(() => location.reload(), 800);
        } catch (err) {
            Utils.showToast(err.message || 'Revert failed', 'error');
        }
    }


    // ── Banner ────────────────────────────────────────────────

    function _showBanner(number) {
        const banner = document.getElementById('readonly-banner');
        const msg    = document.getElementById('readonly-banner-msg');
        if (banner) banner.style.display = '';
        if (msg)    msg.textContent = `Viewing revision ${number} — read only`;
        const revertBtn = document.getElementById('btn-revert-revision');
        if (revertBtn) revertBtn.dataset.revNum = number;
    }

    function _hideBanner() {
        const banner = document.getElementById('readonly-banner');
        if (banner) banner.style.display = 'none';
    }


    // ── ETL toggle ────────────────────────────────────────────

    function _setEtlDisabled(disabled) {
        const runBtn    = document.getElementById('btn-run-etl');
        const editorBtn = document.getElementById('btn-etl-editor');
        if (runBtn) {
            runBtn.disabled = disabled;
            runBtn.title    = disabled ? 'ETL disabled when viewing old revision' : '';
        }
        if (editorBtn) {
            editorBtn.style.pointerEvents = disabled ? 'none' : '';
            editorBtn.style.opacity       = disabled ? '0.4' : '';
            editorBtn.title               = disabled ? 'ETL disabled when viewing old revision' : '';
        }
    }


    // ── Public API ────────────────────────────────────────────

    function getCurrent()          { return _current; }
    function getViewingRevision()  { return _viewingRevision; }
    async function backToCurrent() { await _backToCurrent(); }
    function revertCurrent()       {
        const num = _viewingRevision;
        if (num !== null) _doRevert(num);
    }

    return { init, getCurrent, getViewingRevision, backToCurrent, revertCurrent };

})();
