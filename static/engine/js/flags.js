const FlagsManager = (() => {

    let _hiddenIds   = new Set();
    let _hiddenNames = new Set();
    let _flags = [];

    function _storageKey() {
        return `hiddenFlags:${PROJECT_ID}:${TOOL_ID}`;
    }

    function _loadHidden() {
        try {
            const raw = localStorage.getItem(_storageKey());
            if (!raw) return;
            JSON.parse(raw).forEach(entry => {
                _hiddenIds.add(entry.id);
                if (entry.name) _hiddenNames.add(entry.name);
            });
        } catch (_) {}
    }

    function _saveHidden() {
        try {
            const data = [..._hiddenIds].map(id => {
                const flag = _flags.find(f => f.id === id);
                return { id, name: flag ? flag.name : null };
            });
            localStorage.setItem(_storageKey(), JSON.stringify(data));
        } catch (_) {}
    }

    _loadHidden();

    // --------------------------------------------------------
    // RENDER
    // --------------------------------------------------------

    function _flagItemHtml(flag) {
        const isSystem = flag.is_system === 1 || flag.is_system === true;
        const systemBadge = isSystem
            ? `<span class="sidebar-flag-system-badge">system</span>`
            : '';
        const editNameAttr = isSystem ? 'disabled' : '';
        const isHidden = _hiddenIds.has(flag.id);
        const eyeBtn = `<button class="sidebar-flag-action-btn sidebar-flag-eye-btn${isHidden ? ' flag-hidden' : ''}"
                                title="${isHidden ? 'Show flag' : 'Hide flag'}"
                                onclick="FlagsManager.toggleHide(${flag.id})">👁</button>`;
        const deleteBtn = isSystem
            ? ''
            : `<button class="sidebar-flag-action-btn" title="Delete flag"
                       onclick="FlagsManager.confirmDelete(${flag.id}, '${flag.name.replace(/'/g, "\\'")}')">✕</button>`;

        return `
        <div class="sidebar-flag-item" data-flag-id="${flag.id}">
            <input type="color" class="sidebar-flag-swatch"
                   value="${flag.color}"
                   title="Change color"
                   onchange="FlagsManager.saveColor(${flag.id}, this.value)">
            <input type="text" class="sidebar-flag-name-input" value="${Utils.escAttr(flag.name)}"
                   ${editNameAttr}
                   onblur="FlagsManager.saveName(${flag.id}, this.value)"
                   onkeydown="if(event.key==='Enter')this.blur()">
            ${systemBadge}
            ${eyeBtn}${deleteBtn}
        </div>`;
    }

    function _render(flags) {
        if (!flags.length) {
            return '<p class="sidebar-empty">No flags defined.</p>';
        }
        return `<div class="sidebar-flag-list">${flags.map(_flagItemHtml).join('')}</div>`;
    }

    function _addFormHtml() {
        return `
        <div class="sidebar-flag-form" id="sidebar-flag-form">
            <input type="color"  id="new-flag-color" class="sidebar-flag-swatch" value="#4A90D9" title="Flag color">
            <input type="text"   id="new-flag-name"  class="sidebar-flag-name-input" placeholder="Flag name..."
                   onkeydown="if(event.key==='Enter')FlagsManager.submitCreate()">
            <button class="btn btn-primary btn-sm" onclick="FlagsManager.submitCreate()">Add</button>
        </div>`;
    }

    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    async function show() {
        SidebarManager.open('Flags');
        SidebarManager.setContent('<p class="sidebar-empty">Loading...</p>');
        try {
            _flags = await ApiClient.listFlags();
            const html = _render(_flags) + _addFormHtml();
            SidebarManager.setTitle('FLAG MANAGER');
            SidebarManager.setContent(html);
        } catch (err) {
            SidebarManager.setContent(`<p class="sidebar-empty">Error: ${Utils.escHtml(err.message)}</p>`);
        }
    }

    async function submitCreate() {
        const nameEl  = document.getElementById('new-flag-name');
        const colorEl = document.getElementById('new-flag-color');
        if (!nameEl) return;
        const name = nameEl.value.trim();
        if (!name) { nameEl.focus(); return; }
        try {
            await ApiClient.createFlag(name, colorEl ? colorEl.value : '#888888');
            await show();
        } catch (err) {
            Utils.showToast(err.message, 'error');
        }
    }

    async function saveColor(flagId, color) {
        try {
            await ApiClient.updateFlag(flagId, { color });
        } catch (err) {
            Utils.showToast(err.message, 'error');
            await show();
        }
    }

    async function saveName(flagId, name) {
        const trimmed = name.trim();
        if (!trimmed) { await show(); return; }
        try {
            await ApiClient.updateFlag(flagId, { name: trimmed });
        } catch (err) {
            Utils.showToast(err.message, 'error');
            await show();
        }
    }

    async function confirmDelete(flagId, flagName) {
        if (!confirm(`Delete flag "${flagName}"?`)) return;
        try {
            await ApiClient.deleteFlag(flagId);
            const deleted = _flags.find(f => f.id === flagId);
            _hiddenIds.delete(flagId);
            if (deleted) _hiddenNames.delete(deleted.name);
            _saveHidden();
            GridManager.removeFlagFromCells(flagId);
            await show();
        } catch (err) {
            Utils.showToast(err.message, 'error');
        }
    }

    function toggleHide(flagId) {
        const flag = _flags.find(f => f.id === flagId);
        if (_hiddenIds.has(flagId)) {
            _hiddenIds.delete(flagId);
            if (flag) _hiddenNames.delete(flag.name);
        } else {
            _hiddenIds.add(flagId);
            if (flag) _hiddenNames.add(flag.name);
        }
        _saveHidden();
        const btn = document.querySelector(`.sidebar-flag-item[data-flag-id="${flagId}"] .sidebar-flag-eye-btn`);
        if (btn) {
            const nowHidden = _hiddenIds.has(flagId);
            btn.classList.toggle('flag-hidden', nowHidden);
            btn.title = nowHidden ? 'Show flag' : 'Hide flag';
        }
        GridManager.render();
    }

    function getHiddenIds() {
        return _hiddenIds;
    }

    function isHiddenByName(name) {
        if (_hiddenNames.has(name)) return true;
        const flag = _flags.find(f => f.name === name);
        return flag ? _hiddenIds.has(flag.id) : false;
    }

    return { show, submitCreate, saveColor, saveName, confirmDelete, toggleHide, getHiddenIds, isHiddenByName };

})();
