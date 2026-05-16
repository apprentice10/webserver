const FlagsManager = (() => {

    let _hiddenIds   = new Set();
    let _hiddenNames = new Set();
    let _flags = [];

    function _storageKey() {
        const proj = (typeof DB_PATH !== 'undefined') ? DB_PATH : 'global';
        return `hiddenFlags:${proj}:${TOOL_ID}`;
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
    // CONDITIONAL RULES
    // --------------------------------------------------------

    let _rules  = [];

    function _ruleItemHtml(rule) {
        const opLabel = { contains: "contains", equals: "equals", is_empty: "is empty",
                          starts_with: "starts with", matches_wildcard: "matches" }[rule.operator] || rule.operator;
        const valPart = rule.operator === "is_empty" ? "" : ` "${Utils.escHtml(rule.value)}"`;
        return `<div class="sidebar-rule-item">
            <span class="sidebar-rule-text">
                <b>${Utils.escHtml(rule.col_slug)}</b> ${opLabel}${valPart}
                → <span style="color:${Utils.escAttr(rule.flag_color)}">${Utils.escHtml(rule.flag_name)}</span>
            </span>
            <button class="sidebar-flag-action-btn" title="Delete rule"
                    onclick="FlagsManager.deleteRule(${rule.id})">✕</button>
        </div>`;
    }

    function _rulesHtml(rules) {
        if (!rules.length) return '<p class="sidebar-empty" style="font-size:11px">No conditional rules.</p>';
        return `<div class="sidebar-rules-list">${rules.map(_ruleItemHtml).join("")}</div>`;
    }

    function _ruleFormHtml(flags, columns) {
        const userFlags = flags.filter(f => !f.is_system);
        const userCols  = columns.filter(c => !c.is_system);
        const colOpts   = userCols.map(c =>
            `<option value="${Utils.escAttr(c.slug)}">${Utils.escHtml(c.name)}</option>`).join("");
        const flagOpts  = userFlags.map(f =>
            `<option value="${f.id}">${Utils.escHtml(f.name)}</option>`).join("");
        return `
        <div class="sidebar-rule-form" id="sidebar-rule-form">
            <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;font-size:12px">
                <select id="rule-col">${colOpts}</select>
                <select id="rule-op" onchange="FlagsManager._toggleRuleValue()">
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                    <option value="starts_with">starts with</option>
                    <option value="matches_wildcard">matches wildcard</option>
                    <option value="is_empty">is empty</option>
                </select>
                <input type="text" id="rule-val" placeholder="value" style="width:80px">
                <span>→</span>
                <select id="rule-flag">${flagOpts}</select>
                <button class="btn btn-primary btn-sm" onclick="FlagsManager.addRule()">Add</button>
            </div>
            <div id="rule-match-count" style="font-size:11px;color:var(--color-text-muted);margin-top:2px"></div>
        </div>`;
    }

    function _previewCount(colSlug, operator, value) {
        const rows = (typeof GridManager !== "undefined") ? GridManager.getAllRows() : [];
        const active = rows.filter(r => !r.is_deleted);
        let count = 0;
        for (const row of active) {
            const v = String(row[colSlug] ?? "");
            if (operator === "equals"           && v === value)                          count++;
            else if (operator === "contains"    && value && v.toLowerCase().includes(value.toLowerCase())) count++;
            else if (operator === "is_empty"    && v.trim() === "")                      count++;
            else if (operator === "starts_with" && value && v.toLowerCase().startsWith(value.toLowerCase())) count++;
            else if (operator === "matches_wildcard" && value) {
                const re = new RegExp("^" + value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
                if (re.test(v)) count++;
            }
        }
        return count;
    }

    function _toggleRuleValue() {
        const op  = document.getElementById("rule-op")?.value;
        const val = document.getElementById("rule-val");
        if (val) val.style.display = op === "is_empty" ? "none" : "";
        _updatePreviewCount();
    }

    function _updatePreviewCount() {
        const colEl  = document.getElementById("rule-col");
        const opEl   = document.getElementById("rule-op");
        const valEl  = document.getElementById("rule-val");
        const cntEl  = document.getElementById("rule-match-count");
        if (!colEl || !opEl || !cntEl) return;
        const count = _previewCount(colEl.value, opEl.value, valEl?.value ?? "");
        cntEl.textContent = `${count} row${count !== 1 ? "s" : ""} match`;
    }

    // --------------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------------

    async function show() {
        SidebarManager.open('Flags');
        SidebarManager.setContent('<p class="sidebar-empty">Loading...</p>');
        try {
            const [flags, rules] = await Promise.all([ApiClient.listFlags(), ApiClient.listFlagRules()]);
            _flags = flags;
            _rules = rules;
            const columns = (typeof ColumnsManager !== "undefined") ? ColumnsManager.getColumns() : [];
            const html = _render(_flags) + _addFormHtml() +
                         `<hr style="margin:8px 0;border-color:var(--color-border)">` +
                         `<div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--color-text-muted);padding:0 4px 4px">Conditional Rules</div>` +
                         _rulesHtml(_rules) + _ruleFormHtml(_flags, columns);
            SidebarManager.setTitle('FLAG MANAGER');
            SidebarManager.setContent(html);
            _toggleRuleValue();
            document.getElementById("rule-val")?.addEventListener("input", _updatePreviewCount);
            document.getElementById("rule-op")?.addEventListener("change", _updatePreviewCount);
            document.getElementById("rule-col")?.addEventListener("change", _updatePreviewCount);
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

    async function addRule() {
        const colSlug = document.getElementById("rule-col")?.value;
        const operator = document.getElementById("rule-op")?.value;
        const value   = operator === "is_empty" ? "" : (document.getElementById("rule-val")?.value ?? "");
        const flagId  = parseInt(document.getElementById("rule-flag")?.value, 10);
        if (!colSlug || !operator || isNaN(flagId)) return;
        try {
            await ApiClient.createFlagRule({ col_slug: colSlug, flag_id: flagId, operator, value });
            await show();
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    async function deleteRule(ruleId) {
        if (!confirm("Delete this conditional rule?")) return;
        try {
            await ApiClient.deleteFlagRule(ruleId);
            await show();
        } catch (err) {
            Utils.showToast(err.message, "error");
        }
    }

    return { show, submitCreate, saveColor, saveName, confirmDelete, toggleHide, getHiddenIds, isHiddenByName,
             addRule, deleteRule, _toggleRuleValue };

})();
