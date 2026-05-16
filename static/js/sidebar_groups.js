// sidebar_groups.js
// Group popover (create / edit) and group-level drag-drop logic.
// Depends on: Utils (escAttr), ApiClient (none directly — callers pass callbacks)
const SidebarGroups = (() => {
    const ICONS = ['📋','🔌','🔁','🔄','⚙','📊','🧪','💧','🔥','⚡','📐','🔧','🛠','🧯','📈','🗂','📁','📂'];

    // ── Group popover ────────────────────────────────────────────────────

    // opts: { name, icon, onSave(name, icon) }
    function openGroupPopover(anchor, opts = {}) {
        if (document.getElementById('popover-group')) closeGroupPopover();
        const { name = '', icon = '📁', onSave } = opts;
        const title = name ? 'Edit Group' : 'New Group';

        const pop = document.createElement('div');
        pop.id = 'popover-group';
        pop.className = 'popover';
        pop.style.cssText = 'position:fixed;z-index:500';
        pop.innerHTML = `
          <div class="popover-head">${title}</div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="field-label">Name</label>
            <input id="popover-group-name" class="popover-input"
                   value="${escapeAttr(name)}" autocomplete="off" placeholder="Group name">
          </div>
          <div class="form-group">
            <label class="field-label">Icon</label>
            <div class="icon-grid">
              ${ICONS.map(ic => `<button class="icon-cell${ic === icon ? ' selected' : ''}" data-icon="${ic}">${ic}</button>`).join('')}
            </div>
          </div>
          <div class="popover-foot">
            <button class="btn btn-primary btn-sm" id="popover-group-save">Save</button>
          </div>`;
        document.body.appendChild(pop);

        // Position below anchor, viewport-clamped
        const rect = anchor.getBoundingClientRect();
        pop.style.top  = (rect.bottom + 6) + 'px';
        pop.style.left = rect.left + 'px';
        requestAnimationFrame(() => {
            const pr = pop.getBoundingClientRect();
            if (pr.right > window.innerWidth - 8)
                pop.style.left = (window.innerWidth - pr.width - 8) + 'px';
        });

        const nameInput = pop.querySelector('#popover-group-name');
        nameInput.focus();
        nameInput.select();

        pop.querySelector('.icon-grid').addEventListener('click', e => {
            const cell = e.target.closest('.icon-cell');
            if (!cell) return;
            pop.querySelectorAll('.icon-cell').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
        });

        const doSave = () => {
            const newName = nameInput.value.trim();
            if (!newName) { nameInput.focus(); return; }
            const selected = pop.querySelector('.icon-cell.selected');
            const newIcon = selected ? selected.dataset.icon : icon;
            closeGroupPopover();
            if (onSave) onSave(newName, newIcon);
        };

        pop.querySelector('#popover-group-save').addEventListener('click', doSave);
        nameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') doSave();
            if (e.key === 'Escape') closeGroupPopover();
        });

        setTimeout(() => {
            const dismiss = e => {
                if (!pop.contains(e.target) && !anchor.contains(e.target)) {
                    closeGroupPopover();
                    document.removeEventListener('mousedown', dismiss);
                }
            };
            document.addEventListener('mousedown', dismiss);
        }, 0);
    }

    function closeGroupPopover() {
        document.getElementById('popover-group')?.remove();
    }

    // ── Group drag state ─────────────────────────────────────────────────

    let _draggedGroupId = null;

    function onGroupDragStart(event, groupId) {
        _draggedGroupId = groupId;
        event.dataTransfer.effectAllowed = 'move';
        event.stopPropagation();
    }

    function onGroupDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        event.stopPropagation();
    }

    // Drop on a group header → reorder groups
    async function onGroupDrop(event, targetGroupId, dbPath, onRefresh) {
        event.preventDefault();
        event.stopPropagation();
        if (_draggedGroupId === null || _draggedGroupId === targetGroupId) return;
        const draggedId = _draggedGroupId;
        _draggedGroupId = null;
        try {
            // Determine new position from target group's current position
            const groups = await fetch(`/api/engines/groups?db=${encodeURIComponent(dbPath)}`).then(r => r.json());
            const target = groups.find(g => g.id === targetGroupId);
            if (!target) return;
            await fetch(`/api/engines/groups/${draggedId}?db=${encodeURIComponent(dbPath)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ position: target.position }),
            });
            if (onRefresh) onRefresh();
        } catch (_) {}
    }

    // Drop on a group header → assign engine to group
    async function onEngineDropToGroup(event, groupId, dbPath, onRefresh) {
        event.preventDefault();
        event.stopPropagation();
        if (_draggedGroupId !== null) return; // it's a group being dragged, not an engine
        const engineId = event.dataTransfer.getData('text/engine-id');
        if (!engineId) return;
        try {
            await fetch(`/api/engines/${engineId}/group?db=${encodeURIComponent(dbPath)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_id: groupId }),
            });
            if (onRefresh) onRefresh();
        } catch (_) {}
    }

    return {
        openGroupPopover,
        closeGroupPopover,
        onGroupDragStart,
        onGroupDragOver,
        onGroupDrop,
        onEngineDropToGroup,
    };
})();
