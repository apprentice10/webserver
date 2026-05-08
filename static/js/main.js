/**
 * main.js
 * --------
 * Project management, navigation, sidebar, modals.
 * Projects are tracked in localStorage — the server is stateless.
 */

// ── Recents (localStorage) ────────────────────────────────────────────

const RECENTS_KEY = 'im_recent_projects';
const MAX_RECENTS = 10;

function _getRecents() {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; }
    catch (_) { return []; }
}

function _saveRecents(list) {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

function _addRecent(project) {
    let list = _getRecents().filter(p => p.path !== project.path);
    list.unshift({ path: project.path, name: project.name, client: project.client || '', last_opened: new Date().toISOString() });
    if (list.length > MAX_RECENTS) list = list.slice(0, MAX_RECENTS);
    _saveRecents(list);
}

function _removeRecent(path) {
    _saveRecents(_getRecents().filter(p => p.path !== path));
}

// Current active project (in-memory only — URL is the ground truth)
let _activeProject = null;


// ── Sidebar / layout state ────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const appEl    = document.getElementById('app');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');

    if (appEl && localStorage.getItem('sidebarCollapsed') === '1') {
        appEl.dataset.sidebar = 'collapsed';
        if (toggleBtn) toggleBtn.textContent = '›';
    } else if (appEl) {
        appEl.dataset.sidebar = 'expanded';
        if (toggleBtn) toggleBtn.textContent = '‹';
    }
    if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);

    // Auto-open project from URL ?db=...
    const params = new URLSearchParams(window.location.search);
    const db = params.get('db');
    if (db) {
        await _openProjectFromPath(db, { updateUrl: false });
    } else {
        _renderWelcomeRecents();
    }
});


// ── Sidebar toggle ────────────────────────────────────────────────────

function toggleSidebar() {
    const appEl    = document.getElementById('app');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    if (!appEl) return;
    const collapsed = appEl.dataset.sidebar !== 'collapsed';
    appEl.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
    if (toggleBtn) toggleBtn.textContent = collapsed ? '›' : '‹';
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}


// ── Modal helpers ─────────────────────────────────────────────────────

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

document.addEventListener('click', function (e) {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.classList.remove('active');
    }
});

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active')
            .forEach(m => m.classList.remove('active'));
    }
});


// ── Welcome screen (recents list) ─────────────────────────────────────

function _renderWelcomeRecents() {
    const container = document.getElementById('welcome-recents');
    if (!container) return;
    const recents = _getRecents();
    if (!recents.length) {
        container.innerHTML = '<p class="text-muted" style="text-align:center;padding:16px 0">No recent projects. Create one or browse for a file.</p>';
        return;
    }
    container.innerHTML = recents.map(p => `
        <div class="recent-item" data-path="${escapeHtml(p.path)}">
            <div class="recent-item-info" onclick="selectRecentProject('${escapeAttr(p.path)}')">
                <span class="recent-name">${escapeHtml(p.name)}</span>
                <span class="recent-client">${p.client ? escapeHtml(p.client) : ''}</span>
                <span class="recent-path">${escapeHtml(p.path)}</span>
            </div>
            <div class="recent-item-actions">
                <button class="btn-icon" title="Remove from recents" onclick="removeFromRecents(event, '${escapeAttr(p.path)}')">✕</button>
                <button class="btn-icon btn-danger-hover" title="Delete file" onclick="deleteProjectFile(event, '${escapeAttr(p.path)}')">🗑</button>
            </div>
        </div>
    `).join('');
}

async function selectRecentProject(path) {
    const container = document.getElementById('welcome-recents');
    try {
        await _openProjectFromPath(path, { updateUrl: true });
    } catch (err) {
        // Mark that entry as stale
        if (container) {
            const item = container.querySelector(`[data-path="${escapeAttr(path)}"]`);
            if (item) {
                const info = item.querySelector('.recent-item-info');
                if (info) {
                    info.onclick = null;
                    info.style.cursor = 'default';
                    info.innerHTML += `<span class="recent-stale">⚠ File not found — <button class="btn-link" onclick="removeFromRecents(event,'${escapeAttr(path)}')">Remove</button></span>`;
                }
            }
        }
    }
}

function removeFromRecents(event, path) {
    event.stopPropagation();
    _removeRecent(path);
    _renderWelcomeRecents();
}

async function deleteProjectFile(event, path) {
    event.stopPropagation();
    if (!confirm(`Delete file permanently?\n\n${path}\n\nThis cannot be undone.`)) return;
    try {
        const res = await fetch(`/api/project?db=${encodeURIComponent(path)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json()).detail || 'Delete failed');
        _removeRecent(path);
        if (_activeProject && _activeProject.path === path) {
            clearActiveProject();
        }
        _renderWelcomeRecents();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}


// ── Open project from path ────────────────────────────────────────────

async function _openProjectFromPath(path, { updateUrl = true } = {}) {
    const res = await fetch('/api/project/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to open project');
    }
    const project = await res.json();
    _addRecent(project);
    setActiveProject(project);
    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('db', path);
        window.history.pushState({}, '', url);
    }
    return project;
}


// ── New Project ───────────────────────────────────────────────────────

function newProject() {
    document.getElementById('input-project-path').value = '';
    document.getElementById('input-project-name').value = '';
    document.getElementById('input-project-client').value = '';
    document.getElementById('input-project-description').value = '';
    document.getElementById('btn-create-project').disabled = true;
    openModal('modal-new-project');
}

function _validateNewProject() {
    const path = document.getElementById('input-project-path').value.trim();
    const name = document.getElementById('input-project-name').value.trim();
    document.getElementById('btn-create-project').disabled = !(path && name);
}

async function submitNewProject() {
    const path        = document.getElementById('input-project-path').value.trim();
    const name        = document.getElementById('input-project-name').value.trim();
    const client      = document.getElementById('input-project-client').value.trim();
    const description = document.getElementById('input-project-description').value.trim();

    if (!path || !name) return;

    try {
        const res = await fetch('/api/project/new', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, name, client, description })
        });
        if (!res.ok) throw new Error((await res.json()).detail || 'Creation failed');
        const project = await res.json();
        closeModal('modal-new-project');
        _addRecent(project);
        setActiveProject(project);
        const url = new URL(window.location);
        url.searchParams.set('db', project.path);
        window.history.pushState({}, '', url);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}


// ── Open Project (modal) ──────────────────────────────────────────────

function openProject() {
    openModal('modal-open-project');
    _renderOpenProjectList();
}

function _renderOpenProjectList() {
    const container = document.getElementById('projects-list');
    if (!container) return;
    const recents = _getRecents();
    if (!recents.length) {
        container.innerHTML = '<p class="text-muted">No recent projects. Use Browse to open a file.</p>';
        return;
    }
    container.innerHTML = recents.map(p => `
        <div class="project-list-item" onclick="selectProjectFromModal('${escapeAttr(p.path)}')">
            <div class="project-list-info">
                <span class="project-list-name">${escapeHtml(p.name)}</span>
                <span class="project-list-client">${p.client ? escapeHtml(p.client) : 'No client'}</span>
                <span class="project-list-path">${escapeHtml(p.path)}</span>
            </div>
            <div class="project-list-actions">
                <button class="btn-icon" title="Remove from recents"
                    onclick="event.stopPropagation(); _removeRecent('${escapeAttr(p.path)}'); _renderOpenProjectList()">✕</button>
                <button class="btn-icon" title="Delete file"
                    onclick="deleteProjectFile(event, '${escapeAttr(p.path)}')">🗑</button>
            </div>
        </div>
    `).join('');
}

async function selectProjectFromModal(path) {
    try {
        await _openProjectFromPath(path, { updateUrl: true });
        closeModal('modal-open-project');
    } catch (err) {
        alert('Cannot open: ' + err.message);
    }
}


// ── Active project UI ─────────────────────────────────────────────────

function setActiveProject(project) {
    _activeProject = project;
    _applyProjectToUI(project);
}

function clearActiveProject() {
    _activeProject = null;
    const nameEl = document.getElementById('project-name');
    if (nameEl) nameEl.textContent = 'No project open';
    const nav = document.getElementById('tools-nav');
    if (nav) nav.innerHTML = '';
    const btn = document.getElementById('btn-new-tool');
    if (btn) btn.classList.add('disabled');
    const etlDesignBtn = document.getElementById('btn-side-etl-design');
    if (etlDesignBtn) etlDesignBtn.style.display = 'none';
}

async function _applyProjectToUI(project) {
    const nameEl = document.getElementById('project-name');
    if (nameEl) nameEl.textContent = project.name;

    const btn = document.getElementById('btn-new-tool');
    if (btn) btn.classList.remove('disabled');

    const etlDesignBtn = document.getElementById('btn-side-etl-design');
    if (etlDesignBtn) {
        etlDesignBtn.href = `/etl-design?db=${encodeURIComponent(project.path)}`;
        etlDesignBtn.style.display = '';
    }

    if (project.tools) {
        _renderSidebarTools(project.tools, project.path);
    } else {
        try {
            const tools = await fetch(`/api/tools/project?db=${encodeURIComponent(project.path)}`).then(r => r.json());
            _renderSidebarTools(tools, project.path);
        } catch (_) {}
    }

    // Run on-open backup if configured
    _runOnOpenBackup(project.path);
    _startBackupTimer(project.path);
}

function _renderSidebarTools(tools, dbPath) {
    const nav = document.getElementById('tools-nav');
    if (!nav) return;
    if (!tools.length) {
        nav.innerHTML = '<div class="side-empty">No tools — create one!</div>';
        return;
    }
    const params = new URLSearchParams(window.location.search);
    const currentToolId = params.has('tool') ? parseInt(params.get('tool')) : null;
    nav.innerHTML = tools.map(tool => `
        <a href="#" class="side-item${tool.id === currentToolId ? ' active' : ''}"
           data-tool-id="${tool.id}"
           onclick="openToolById(${tool.id}, '${escapeAttr(dbPath)}'); return false;">
            <span class="si-icon">${escapeHtml(tool.icon || '📄')}</span>
            <span class="si-label">${escapeHtml(tool.name)}</span>
            ${tool.is_stale ? '<span class="si-stale" title="ETL stale"></span>' : ''}
        </a>
    `).join('');
}


// ── Navigation ────────────────────────────────────────────────────────

function openToolById(toolId, dbPath) {
    window.location.href = `/tool?db=${encodeURIComponent(dbPath)}&tool=${toolId}`;
}


// ── New Tool ──────────────────────────────────────────────────────────

let _selectedCatalogType = null;
let _selectedTemplateId  = null;
let _selectedEtlSql      = null;

async function newTool() {
    if (!_activeProject) return;
    _selectedCatalogType = null;
    _selectedTemplateId  = null;
    _selectedEtlSql      = null;

    const nameGroup = document.getElementById('tool-name-group');
    if (nameGroup) nameGroup.style.display = 'none';
    const templatesGroup = document.getElementById('tool-templates-group');
    if (templatesGroup) templatesGroup.style.display = 'none';
    const createBtn = document.getElementById('btn-create-tool');
    if (createBtn) createBtn.disabled = true;
    const nameInput = document.getElementById('input-tool-name');
    if (nameInput) nameInput.value = '';
    const fileNameEl = document.getElementById('file-etl-name');
    if (fileNameEl) { fileNameEl.style.display = 'none'; fileNameEl.textContent = ''; }

    openModal('modal-new-tool');
    await _loadToolCatalog();
}

async function _loadToolCatalog() {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    grid.innerHTML = "<p class='text-muted'>Loading…</p>";
    try {
        const types = await fetch('/api/tools/types').then(r => r.json());
        if (!types.length) {
            grid.innerHTML = "<p class='text-muted'>No tool types available.</p>";
            return;
        }
        grid.innerHTML = types.map(t => `
            <div class="catalog-card" data-type-slug="${escapeHtml(t.type_slug)}"
                 onclick="selectCatalogType('${escapeAttr(t.type_slug)}', '${escapeAttr(t.name)}', '${escapeAttr(t.icon)}')">
                <div class="catalog-card-icon">${escapeHtml(t.icon)}</div>
                <div class="catalog-card-name">${escapeHtml(t.name)}</div>
                <div class="catalog-card-desc">${escapeHtml(t.description)}</div>
            </div>
        `).join('');
    } catch (err) {
        grid.innerHTML = "<p class='text-error'>Error loading catalog.</p>";
    }
}

function selectCatalogType(typeSlug, typeName, typeIcon) {
    _selectedCatalogType = { typeSlug, typeName, typeIcon };
    _selectedTemplateId  = null;

    document.querySelectorAll('.catalog-card').forEach(el => {
        el.classList.toggle('selected', el.dataset.typeSlug === typeSlug);
    });

    const nameGroup = document.getElementById('tool-name-group');
    if (nameGroup) nameGroup.style.display = 'flex';
    const nameInput = document.getElementById('input-tool-name');
    if (nameInput && !nameInput.value) nameInput.value = typeName;
    if (nameInput) nameInput.focus();
    const createBtn = document.getElementById('btn-create-tool');
    if (createBtn) createBtn.disabled = false;

    _loadTemplatesInModal(typeSlug);
    const templatesGroup = document.getElementById('tool-templates-group');
    if (templatesGroup) templatesGroup.style.display = 'flex';
}

async function _loadTemplatesInModal(typeSlug) {
    const list = document.getElementById('templates-list');
    if (!list || !_activeProject) return;
    const params = new URLSearchParams({ db: _activeProject.path });
    if (typeSlug) params.set('type_slug', typeSlug);
    try {
        const templates = await fetch(`/api/tools/templates?${params}`).then(r => r.json());
        if (!templates.length) {
            list.innerHTML = '<div style="font-size:12px;color:var(--color-text-muted)">No saved templates.</div>';
            return;
        }
        list.innerHTML = templates.map(t => `
            <div class="template-item" data-template-id="${t.id}"
                 onclick="selectTemplate(${t.id}, this)">
                <span class="template-item-name">${escapeHtml(t.name)}</span>
                <button class="template-item-delete"
                        onclick="deleteTemplateFromModal(event, ${t.id}, '${escapeAttr(typeSlug)}')"
                        title="Delete template">✕</button>
            </div>
        `).join('');
    } catch (_) {
        list.innerHTML = '';
    }
}

function selectTemplate(templateId, el) {
    const alreadySelected = el.classList.contains('selected');
    document.querySelectorAll('.template-item').forEach(i => i.classList.remove('selected'));
    if (alreadySelected) {
        _selectedTemplateId = null;
    } else {
        el.classList.add('selected');
        _selectedTemplateId = templateId;
        _selectedEtlSql = null;
        const fileNameEl = document.getElementById('file-etl-name');
        if (fileNameEl) { fileNameEl.style.display = 'none'; fileNameEl.textContent = ''; }
    }
}

function importEtlFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sql,.json,.txt';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            let sql = text;
            if (file.name.endsWith('.json')) {
                const parsed = JSON.parse(text);
                sql = parsed.etl_sql || parsed.sql || text;
            }
            _selectedEtlSql = sql.trim();
            _selectedTemplateId = null;
            document.querySelectorAll('.template-item').forEach(i => i.classList.remove('selected'));
            const fileNameEl = document.getElementById('file-etl-name');
            if (fileNameEl) { fileNameEl.textContent = `✓ ${file.name}`; fileNameEl.style.display = 'inline'; }
        } catch (err) {
            alert('Error reading file: ' + err.message);
        }
    };
    input.click();
}

async function deleteTemplateFromModal(event, templateId, typeSlug) {
    event.stopPropagation();
    if (!confirm('Delete this template?')) return;
    if (!_activeProject) return;
    try {
        await fetch(`/api/tools/templates/${templateId}?db=${encodeURIComponent(_activeProject.path)}`, { method: 'DELETE' });
        await _loadTemplatesInModal(typeSlug);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function submitNewTool() {
    if (!_selectedCatalogType || !_activeProject) return;
    const nameInput = document.getElementById('input-tool-name');
    const name = nameInput ? nameInput.value.trim() : _selectedCatalogType.typeName;
    if (!name) { alert('Tool name is required.'); return; }

    const createBtn = document.getElementById('btn-create-tool');
    if (createBtn) createBtn.disabled = true;

    try {
        const payload = { name, tool_type: _selectedCatalogType.typeSlug, icon: _selectedCatalogType.typeIcon };
        if (_selectedTemplateId) payload.template_id = _selectedTemplateId;
        else if (_selectedEtlSql) payload.etl_sql = _selectedEtlSql;

        const res = await fetch(`/api/tools/project?db=${encodeURIComponent(_activeProject.path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).detail || 'Tool creation failed');
        const tool = await res.json();
        closeModal('modal-new-tool');
        window.location.href = `/tool?db=${encodeURIComponent(_activeProject.path)}&tool=${tool.id}`;
    } catch (err) {
        alert('Error: ' + err.message);
        if (createBtn) createBtn.disabled = false;
    }
}


// ── Filesystem browser ────────────────────────────────────────────────

const FsBrowser = (() => {
    let _mode    = null;  // 'folder' | 'file'
    let _current = null;
    let _resolve = null;

    async function _browse(path) {
        try {
            const res = await fetch(`/api/fs/browse?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error('Browse failed');
            const data = await res.json();
            _current = data.path;
            _render(data);
        } catch (err) {
            alert('Browse error: ' + err.message);
        }
    }

    function _render(data) {
        document.getElementById('fs-path-input').value = data.path;
        document.getElementById('fs-btn-up').disabled = !data.parent;

        const entriesEl = document.getElementById('fs-entries');
        if (!data.entries.length) {
            entriesEl.innerHTML = '<div class="fs-empty">Empty folder</div>';
        } else {
            entriesEl.innerHTML = data.entries.map(e => {
                if (e.type === 'dir') {
                    return `<div class="fs-entry fs-dir" onclick="FsBrowser._enter('${escapeAttr(data.path + '/' + e.name)}')">
                        <span class="fs-icon">📁</span><span>${escapeHtml(e.name)}</span></div>`;
                } else {
                    const kb = e.size ? Math.round(e.size / 1024) + ' KB' : '';
                    const sel = _mode === 'file'
                        ? `onclick="FsBrowser._selectFile('${escapeAttr(data.path + '/' + e.name)}')"` : '';
                    return `<div class="fs-entry fs-file${_mode === 'file' ? ' fs-selectable' : ''}" ${sel}>
                        <span class="fs-icon">🗄</span><span>${escapeHtml(e.name)}</span>
                        <span class="fs-size">${kb}</span></div>`;
                }
            }).join('');
        }

        if (_mode === 'folder') {
            const fnRow = document.getElementById('fs-filename-row');
            if (fnRow) fnRow.style.display = '';
            document.getElementById('fs-select-btn').disabled = false;
        }
    }

    function _enter(path) {
        _browse(path);
    }

    function _selectFile(path) {
        if (_mode !== 'file') return;
        closeModal('modal-fs-browser');
        if (_resolve) _resolve(path);
    }

    function goUp() {
        if (!_current) return;
        fetch(`/api/fs/browse?path=${encodeURIComponent(_current)}`).then(r => r.json()).then(d => {
            if (d.parent) _browse(d.parent);
        });
    }

    function cancel() {
        closeModal('modal-fs-browser');
        if (_resolve) _resolve(null);
    }

    function select() {
        if (_mode !== 'folder') return;
        const filename = (document.getElementById('fs-filename-input').value || '').trim();
        if (!filename) { alert('Enter a file name.'); return; }
        const name = filename.endsWith('.db') ? filename : filename + '.db';
        const path = _current.replace(/[\/\\]+$/, '') + '\\' + name;
        closeModal('modal-fs-browser');
        if (_resolve) _resolve(path);
    }

    async function _open(mode, title) {
        _mode = mode;
        document.getElementById('fs-browser-title').textContent = title;
        const fnRow = document.getElementById('fs-filename-row');
        if (fnRow) fnRow.style.display = mode === 'folder' ? '' : 'none';
        const filenameInput = document.getElementById('fs-filename-input');
        if (filenameInput) filenameInput.value = '';
        document.getElementById('fs-select-btn').disabled = mode !== 'folder';
        openModal('modal-fs-browser');

        const lastPath = localStorage.getItem('im_last_browse_path');
        const startPath = lastPath || await fetch('/api/fs/cwd').then(r => r.json()).then(d => d.path);
        await _browse(startPath);

        return new Promise(resolve => { _resolve = (path) => { if (path) localStorage.setItem('im_last_browse_path', _current); resolve(path); }; });
    }

    async function openForNew() {
        const path = await _open('folder', 'Choose save location');
        if (path) {
            document.getElementById('input-project-path').value = path;
            _validateNewProject();
        }
    }

    async function openForOpen() {
        const path = await _open('file', 'Open project file');
        if (path) {
            closeModal('modal-open-project');
            try {
                await _openProjectFromPath(path, { updateUrl: true });
            } catch (err) {
                alert('Cannot open: ' + err.message);
            }
        }
    }

    return { _enter, _selectFile, goUp, cancel, select, openForNew, openForOpen };
})();


// ── Backup helpers ────────────────────────────────────────────────────

let _backupTimer = null;

function _getBackupPrefs() {
    try { return JSON.parse(localStorage.getItem('im.prefs')) || {}; } catch (_) { return {}; }
}

function _runOnOpenBackup(dbPath) {
    const prefs = _getBackupPrefs();
    if (!prefs.backup?.onOpen) return;
    const cooldownMs = (parseInt(prefs.backup?.onOpenCooldown) || 1440) * 60 * 1000;
    const lastAt = parseInt(localStorage.getItem('im.backup.lastOnOpen') || '0');
    if (Date.now() - lastAt < cooldownMs) return;
    localStorage.setItem('im.backup.lastOnOpen', String(Date.now()));
    _doBackup(dbPath);
}

function _startBackupTimer(dbPath) {
    if (_backupTimer) clearInterval(_backupTimer);
    const prefs = _getBackupPrefs();
    const mins  = parseInt(prefs.backup?.interval) || 0;
    if (!mins) return;
    _backupTimer = setInterval(() => _doBackup(dbPath), mins * 60 * 1000);
}

async function _doBackup(dbPath) {
    const prefs = _getBackupPrefs();
    const b = prefs.backup || {};
    try {
        await fetch(`/api/project/backup?db=${encodeURIComponent(dbPath)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subfolder: b.subfolder || '_backups',
                keep:      parseInt(b.keep) || 10,
            })
        });
    } catch (_) {}
}


// ── Utility ───────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
}
