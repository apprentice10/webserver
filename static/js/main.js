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

// Cached tool list for the active project (used for duplicate-name check)
let _currentTools = [];

// Drag state for engine reordering
let _draggedToolId = null;


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

let _pendingProjectData = null;
let _pendingUpdateUrl   = false;

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

    if (project.engine_missing && project.engine_missing.length > 0) {
        closeModal('modal-open-project');
        _showEngineMissingModal(project.engine_missing);
        return project;
    }
    if (project.engine_version_mismatch && project.engine_version_mismatch.length > 0) {
        closeModal('modal-open-project');
        _showEngineMismatchModal(project, updateUrl);
        return project;
    }

    _finalizeProjectOpen(project, updateUrl);
    return project;
}

function _finalizeProjectOpen(project, updateUrl) {
    _addRecent(project);
    setActiveProject(project);
    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('db', project.path);
        window.history.pushState({}, '', url);
    }
}

function _showEngineMissingModal(missing) {
    const list = document.getElementById('engine-missing-list');
    if (list) {
        list.innerHTML = missing.map(m =>
            `<li><strong>${escapeHtml(m.slug)}</strong> — requires v${escapeHtml(m.required_version)}</li>`
        ).join('');
    }
    openModal('modal-engine-missing');
}

function _showEngineMismatchModal(project, updateUrl) {
    _pendingProjectData = project;
    _pendingUpdateUrl   = updateUrl;
    const list = document.getElementById('engine-mismatch-list');
    if (list) {
        list.innerHTML = project.engine_version_mismatch.map(m =>
            `<li><strong>${escapeHtml(m.name || m.slug)}</strong>: installed v${escapeHtml(m.installed_version)}, project requires v${escapeHtml(m.required_version)}</li>`
        ).join('');
    }
    openModal('modal-engine-mismatch');
}

function _cancelMismatchModal() {
    _pendingProjectData = null;
    closeModal('modal-engine-mismatch');
}

function _confirmMismatchModal() {
    const project   = _pendingProjectData;
    const updateUrl = _pendingUpdateUrl;
    _pendingProjectData = null;
    closeModal('modal-engine-mismatch');
    if (project) _finalizeProjectOpen(project, updateUrl);
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
    const btn = document.getElementById('btn-new-engine');
    if (btn) btn.classList.add('disabled');
    const grpBtn = document.getElementById('btn-new-group');
    if (grpBtn) grpBtn.classList.add('disabled');
    const etlDesignBtn = document.getElementById('btn-side-etl-design');
    if (etlDesignBtn) etlDesignBtn.style.display = 'none';
}

async function _applyProjectToUI(project) {
    const nameEl = document.getElementById('project-name');
    if (nameEl) nameEl.textContent = project.name;

    const btn = document.getElementById('btn-new-engine');
    if (btn) btn.classList.remove('disabled');
    const grpBtn = document.getElementById('btn-new-group');
    if (grpBtn) grpBtn.classList.remove('disabled');

    const etlDesignBtn = document.getElementById('btn-side-etl-design');
    if (etlDesignBtn) {
        etlDesignBtn.href = `/etl-design?db=${encodeURIComponent(project.path)}`;
        etlDesignBtn.style.display = '';
    }

    await _loadSidebarGroups(project.path);
    if (project.tools) {
        _renderSidebarTools(project.tools, project.path);
    } else {
        try {
            const tools = await fetch(`/api/engines/project?db=${encodeURIComponent(project.path)}`).then(r => r.json());
            _renderSidebarTools(tools, project.path);
        } catch (_) {}
    }
    _renderTrashSection(project.path);

    // Run on-open backup if configured
    _runOnOpenBackup(project.path);
    _startBackupTimer(project.path);
}

let _sidebarGroups = [];

async function _loadSidebarGroups(dbPath) {
    try {
        _sidebarGroups = await fetch(`/api/engines/groups?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
    } catch (_) {
        _sidebarGroups = [];
    }
}

function _renderSidebarTools(tools, dbPath) {
    _currentTools = tools;
    const nav = document.getElementById('tools-nav');
    if (!nav) return;

    const params = new URLSearchParams(window.location.search);
    const currentToolId = params.has('tool') ? parseInt(params.get('tool')) : null;

    if (!tools.length && !_sidebarGroups.length) {
        nav.innerHTML = '<div class="side-empty">No engines — create one!</div>';
        return;
    }

    let html = '';
    let globalIdx = 0;

    // Ungrouped engines first (no group_id)
    const ungrouped = tools.filter(t => !t.group_id);
    ungrouped.forEach(tool => {
        html += _renderSidebarTool(tool, globalIdx++, dbPath, currentToolId);
    });

    // Groups
    const groupMap = {};
    tools.forEach(t => { if (t.group_id) { (groupMap[t.group_id] = groupMap[t.group_id] || []).push(t); } });

    _sidebarGroups.forEach(group => {
        const members = groupMap[group.id] || [];
        const collapsed = group.is_collapsed;
        html += `<div class="side-group" data-group-id="${group.id}"
                draggable="true"
                ondragstart="SidebarGroups.onGroupDragStart(event, ${group.id})"
                ondragover="SidebarGroups.onGroupDragOver(event)"
                ondrop="SidebarGroups.onGroupDrop(event, ${group.id}, '${escapeAttr(dbPath)}', () => _refreshSidebarTools('${escapeAttr(dbPath)}'))">
            <div class="side-group-header"
                 ondragover="SidebarGroups.onGroupDragOver(event)"
                 ondrop="SidebarGroups.onEngineDropToGroup(event, ${group.id}, '${escapeAttr(dbPath)}', () => _refreshSidebarTools('${escapeAttr(dbPath)}')); SidebarGroups.onGroupDrop(event, ${group.id}, '${escapeAttr(dbPath)}', () => _refreshSidebarTools('${escapeAttr(dbPath)}'))"
                 onclick="_toggleGroup(${group.id}, ${collapsed ? 0 : 1}, '${escapeAttr(dbPath)}')">
                <span class="side-group-icon">${escapeHtml(group.icon || '📁')}</span>
                <span class="side-group-name">${escapeHtml(group.name)}</span>
                <button class="side-group-edit" title="Edit group"
                        onclick="_editGroup(event, ${group.id}, '${escapeAttr(dbPath)}')">✏</button>
                <span class="side-group-caret">${collapsed ? '›' : '˅'}</span>
            </div>`;
        if (!collapsed) {
            members.forEach(tool => {
                html += _renderSidebarTool(tool, globalIdx++, dbPath, currentToolId, group.id);
            });
        }
        html += '</div>';
    });

    // Ungrouped drop zone — engine dropped here gets group_id removed
    html += `<div class="side-ungrouped-zone"
             ondragover="event.preventDefault(); event.dataTransfer.dropEffect='move'"
             ondrop="_onEngineDropUngrouped(event, '${escapeAttr(dbPath)}')"></div>`;

    nav.innerHTML = html;
}

async function _refreshSidebarTools(dbPath) {
    try {
        await _loadSidebarGroups(dbPath);
        const tools = await fetch(`/api/engines/project?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
        _renderSidebarTools(tools, dbPath);
    } catch (_) {}
}

async function _onEngineDropUngrouped(event, dbPath) {
    event.preventDefault();
    const engineId = event.dataTransfer.getData('text/engine-id');
    if (!engineId) return;
    _draggedToolId = null;
    try {
        await fetch(`/api/engines/${engineId}/group?db=${encodeURIComponent(dbPath)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group_id: null }),
        });
        await _refreshSidebarTools(dbPath);
    } catch (_) {}
}

function _renderSidebarTool(tool, idx, dbPath, currentToolId, inGroupId) {
    const groupAttr = inGroupId ? ` data-in-group="${inGroupId}"` : '';
    return `<div class="side-item-wrap${inGroupId ? ' side-item-wrap--grouped' : ''}"
            ondragover="_onEngineDragOver(event)"
            ondrop="_onEngineDrop(event, ${idx}, '${escapeAttr(dbPath)}')">
        <a href="#" class="side-item${tool.id === currentToolId ? ' active' : ''}"
           data-tool-id="${tool.id}" data-index="${idx}"${groupAttr}
           draggable="true"
           onclick="openToolById(${tool.id}, '${escapeAttr(dbPath)}', '${escapeAttr(tool.tool_type || '')}'); return false;"
           ondragstart="_onEngineDragStart(event, ${tool.id})">
            <span class="si-icon">${escapeHtml(tool.icon || '📄')}</span>
            <span class="si-label">${escapeHtml(tool.name)}</span>
            ${tool.is_stale ? '<span class="si-stale" title="ETL stale"></span>' : ''}
        </a>
        <button class="side-item-edit" title="Edit engine"
                onclick="_editEngine(event, ${tool.id})">✏</button>
        <button class="side-item-del" title="Delete engine"
                onclick="_deleteEngine(event, ${tool.id}, '${escapeAttr(tool.name)}', '${escapeAttr(dbPath)}')">✕</button>
    </div>`;
}

function _editEngine(event, toolId) {
    event.stopPropagation();
    event.preventDefault();
    const btn  = event.currentTarget;
    const wrap = btn.closest('.side-item-wrap');
    const item = wrap ? wrap.querySelector('.side-item') : btn;
    const icon = item ? (item.querySelector('.si-icon')?.textContent || '') : '';
    const name = item ? (item.querySelector('.si-label')?.textContent || '') : '';
    AppShell.openToolPopover(item || btn, { name, icon });
}

async function _toggleGroup(groupId, newCollapsed, dbPath) {
    try {
        await fetch(`/api/engines/groups/${groupId}?db=${encodeURIComponent(dbPath)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_collapsed: newCollapsed }),
        });
        const g = _sidebarGroups.find(g => g.id === groupId);
        if (g) g.is_collapsed = newCollapsed;
        _renderSidebarTools(_currentTools, dbPath);
    } catch (_) {}
}

function newGroup() {
    if (!_activeProject) return;
    const anchor = document.getElementById('btn-new-group') || document.body;
    SidebarGroups.openGroupPopover(anchor, {
        onSave: async (name, icon) => {
            try {
                const res = await fetch(`/api/engines/groups?db=${encodeURIComponent(_activeProject.path)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, icon }),
                });
                if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
                _sidebarGroups.push(await res.json());
                _renderSidebarTools(_currentTools, _activeProject.path);
            } catch (err) {
                alert('Error: ' + err.message);
            }
        }
    });
}

function _editGroup(event, groupId, dbPath) {
    event.stopPropagation();
    const group = _sidebarGroups.find(g => g.id === groupId);
    if (!group) return;
    SidebarGroups.openGroupPopover(event.currentTarget, {
        name: group.name,
        icon: group.icon || '📁',
        onSave: async (name, icon) => {
            try {
                const res = await fetch(`/api/engines/groups/${groupId}?db=${encodeURIComponent(dbPath)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, icon }),
                });
                if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
                const updated = await res.json();
                const g = _sidebarGroups.find(g => g.id === groupId);
                if (g) { g.name = updated.name; g.icon = updated.icon; }
                _renderSidebarTools(_currentTools, dbPath);
            } catch (err) {
                alert('Error: ' + err.message);
            }
        }
    });
}


// ── Engine drag-and-drop reorder ──────────────────────────────────────

function _onEngineDragStart(event, toolId) {
    _draggedToolId = toolId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/engine-id', String(toolId));
}

function _onEngineDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

async function _onEngineDrop(event, targetIndex, dbPath) {
    event.preventDefault();
    if (_draggedToolId === null) return;
    const draggedId = _draggedToolId;
    _draggedToolId = null;
    try {
        await fetch(`/api/engines/${draggedId}/position?db=${encodeURIComponent(dbPath)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position: targetIndex }),
        });
        const tools = await fetch(`/api/engines/project?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
        _renderSidebarTools(tools, dbPath);
    } catch (_) {}
}


// ── Engine delete / trash ─────────────────────────────────────────────

async function _deleteEngine(event, toolId, toolName, dbPath) {
    event.stopPropagation();
    event.preventDefault();
    try {
        const deps = await fetch(`/api/engines/${toolId}/dependents?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
        if (deps.length) {
            const names = deps.map(d => `• ${d.name}`).join('\n');
            alert(`Cannot delete "${toolName}" — these engines use its data:\n\n${names}\n\nRemove those ETL connections first.`);
            return;
        }
        if (!confirm(`Move "${toolName}" to trash?`)) return;
        await fetch(`/api/engines/${toolId}?db=${encodeURIComponent(dbPath)}`, { method: 'DELETE' });
        _currentTools = _currentTools.filter(t => t.id !== toolId);
        _renderSidebarTools(_currentTools, dbPath);
        _renderTrashSection(dbPath);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

let _trashCollapsed = true;

async function _renderTrashSection(dbPath) {
    const trashEl = document.getElementById('side-trash');
    if (!trashEl) return;
    try {
        const trashed = await fetch(`/api/engines/trash?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
        if (!trashed.length) {
            trashEl.innerHTML = '';
            return;
        }
        const caret = _trashCollapsed ? '›' : '˅';
        let html = `<div class="side-group" style="border-top:1px solid var(--border)">
            <div class="side-group-header" onclick="_toggleTrash('${escapeAttr(dbPath)}')">
                <span class="side-group-icon">🗑</span>
                <span class="side-group-name">Trash (${trashed.length})</span>
                <span class="side-group-caret">${caret}</span>
            </div>`;
        if (!_trashCollapsed) {
            html += trashed.map(t => `
                <div class="side-trash-item">
                    <span class="si-icon">${escapeHtml(t.icon || '📄')}</span>
                    <span class="si-label">${escapeHtml(t.name)}</span>
                    <button title="Restore" onclick="_restoreEngine(${t.id}, '${escapeAttr(dbPath)}')">↩</button>
                    <button title="Delete permanently" class="btn-danger-hover"
                            onclick="_permanentDelete(${t.id}, '${escapeAttr(t.name)}', '${escapeAttr(dbPath)}')">🗑</button>
                </div>
            `).join('');
        }
        html += '</div>';
        trashEl.innerHTML = html;
    } catch (_) {}
}

function _toggleTrash(dbPath) {
    _trashCollapsed = !_trashCollapsed;
    _renderTrashSection(dbPath);
}

async function _restoreEngine(toolId, dbPath) {
    try {
        await fetch(`/api/engines/${toolId}/restore?db=${encodeURIComponent(dbPath)}`, { method: 'POST' });
        const tools = await fetch(`/api/engines/project?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
        _renderSidebarTools(tools, dbPath);
        _renderTrashSection(dbPath);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function _permanentDelete(toolId, toolName, dbPath) {
    if (!confirm(`Permanently delete all data for "${toolName}"?\n\nThis cannot be undone.`)) return;
    try {
        await fetch(`/api/engines/${toolId}/permanent?db=${encodeURIComponent(dbPath)}`, { method: 'DELETE' });
        _renderTrashSection(dbPath);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}


// ── Navigation ────────────────────────────────────────────────────────

function openToolById(toolId, dbPath, toolType) {
    const ENGINE_PAGES = { mto: '/mto' };
    const page = ENGINE_PAGES[toolType] || '/tool';
    window.location.href = `${page}?db=${encodeURIComponent(dbPath)}&tool=${toolId}`;
}


// ── New Engine ────────────────────────────────────────────────────────

function _validateEngineName() {
    const nameInput = document.getElementById('input-engine-name');
    const warning   = document.getElementById('engine-name-warning');
    const createBtn = document.getElementById('btn-create-engine');
    if (!nameInput || !createBtn) return;
    const val = nameInput.value.trim().toLowerCase();
    const isDuplicate = !!val && _currentTools.some(t => t.name.toLowerCase() === val);
    if (warning) warning.style.display = isDuplicate ? '' : 'none';
    createBtn.disabled = isDuplicate || !val;
}

let _selectedCatalogType  = null;
let _selectedTemplateId   = null;
let _selectedEtlSql       = null;
let _catalogEntriesBySlug = {};

async function newEngine() {
    if (!_activeProject) return;
    _selectedCatalogType = null;
    _selectedTemplateId  = null;
    _selectedEtlSql      = null;

    const nameGroup = document.getElementById('engine-name-group');
    if (nameGroup) nameGroup.style.display = 'none';
    const templatesGroup = document.getElementById('engine-templates-group');
    if (templatesGroup) templatesGroup.style.display = 'none';
    const fileLoadGroup = document.getElementById('engine-file-load-group');
    if (fileLoadGroup) fileLoadGroup.style.display = 'none';
    const createBtn = document.getElementById('btn-create-engine');
    if (createBtn) createBtn.disabled = true;
    const nameInput = document.getElementById('input-engine-name');
    if (nameInput) nameInput.value = '';
    const fileNameEl = document.getElementById('file-etl-name');
    if (fileNameEl) { fileNameEl.style.display = 'none'; fileNameEl.textContent = ''; }

    openModal('modal-new-engine');
    await _loadEngineCatalog();
}

async function _loadEngineCatalog() {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    grid.innerHTML = "<p class='text-muted'>Loading…</p>";
    try {
        const types = await fetch('/api/engines/catalog').then(r => r.json());
        if (!types.length) {
            grid.innerHTML = "<p class='text-muted'>No engines found. Copy an engine folder into your <code>engines/</code> directory.</p>";
            return;
        }
        _catalogEntriesBySlug = {};
        types.forEach(t => { _catalogEntriesBySlug[t.slug] = t; });
        grid.innerHTML = types.map(t => `
            <div class="catalog-card" data-slug="${escapeHtml(t.slug)}"
                 onclick="selectEngineType('${escapeAttr(t.slug)}')">
                <div class="catalog-card-icon">${escapeHtml(t.icon || '📄')}</div>
                <div class="catalog-card-name">${escapeHtml(t.name)}</div>
                <div class="catalog-card-version" style="font-size:11px;color:var(--color-text-muted)">v${escapeHtml(t.version)}</div>
                <div class="catalog-card-desc">${escapeHtml(t.description || '')}</div>
            </div>
        `).join('');
    } catch (err) {
        grid.innerHTML = "<p class='text-error'>Error loading catalog.</p>";
    }
}

function selectEngineType(slug) {
    const entry = _catalogEntriesBySlug[slug];
    if (!entry) return;
    _selectedCatalogType = {
        typeSlug:        entry.slug,
        typeName:        entry.name,
        typeIcon:        entry.icon || '📄',
        engineVersion:   entry.version,
        supportsTemplate: !!entry.supports_template,
    };
    _selectedTemplateId = null;

    document.querySelectorAll('.catalog-card').forEach(el => {
        el.classList.toggle('selected', el.dataset.slug === slug);
    });

    const nameGroup = document.getElementById('engine-name-group');
    if (nameGroup) nameGroup.style.display = 'flex';
    const nameInput = document.getElementById('input-engine-name');
    if (nameInput && !nameInput.value) nameInput.value = entry.name;
    if (nameInput) nameInput.focus();
    _validateEngineName();

    _loadTemplatesInModal(slug);
    const templatesGroup = document.getElementById('engine-templates-group');
    if (templatesGroup) templatesGroup.style.display = 'flex';
    const fileLoadGroup = document.getElementById('engine-file-load-group');
    if (fileLoadGroup) fileLoadGroup.style.display = entry.supports_template ? 'flex' : 'none';
}

async function _loadTemplatesInModal(typeSlug) {
    const list = document.getElementById('templates-list');
    if (!list || !_activeProject) return;
    const params = new URLSearchParams({ db: _activeProject.path });
    if (typeSlug) params.set('type_slug', typeSlug);
    try {
        const templates = await fetch(`/api/engines/templates?${params}`).then(r => r.json());
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
        await fetch(`/api/engines/templates/${templateId}?db=${encodeURIComponent(_activeProject.path)}`, { method: 'DELETE' });
        await _loadTemplatesInModal(typeSlug);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function submitNewEngine() {
    if (!_selectedCatalogType || !_activeProject) return;
    const nameInput = document.getElementById('input-engine-name');
    const name = nameInput ? nameInput.value.trim() : _selectedCatalogType.typeName;
    if (!name) { alert('Tool name is required.'); return; }

    const createBtn = document.getElementById('btn-create-engine');
    if (createBtn) createBtn.disabled = true;

    try {
        const payload = {
            name,
            tool_type:      _selectedCatalogType.typeSlug,
            engine_version: _selectedCatalogType.engineVersion,
            icon:           _selectedCatalogType.typeIcon,
        };
        if (_selectedTemplateId) payload.template_id = _selectedTemplateId;
        else if (_selectedEtlSql) payload.etl_sql = _selectedEtlSql;

        const res = await fetch(`/api/engines/project?db=${encodeURIComponent(_activeProject.path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).detail || 'Tool creation failed');
        const tool = await res.json();
        const hasTemplate = _selectedTemplateId || _selectedEtlSql;
        closeModal('modal-new-engine');
        if (hasTemplate) {
            window.location.href = `/etl?db=${encodeURIComponent(_activeProject.path)}&tool=${tool.id}`;
        } else {
            window.location.href = `/tool?db=${encodeURIComponent(_activeProject.path)}&tool=${tool.id}`;
        }
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
