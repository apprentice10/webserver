// app_shell.js
// Manages: theme, accent, density, sidebar state, topbar tool-pill inline edit,
// REV chip inline edit, settings modal (appearance + language tabs).
// Depends on: I18n, ApiClient (for tool name/icon/rev persistence)
const AppShell = (() => {
    const PREFS_KEY = 'im.prefs';

    // ── Preferences ─────────────────────────────────────────────
    function _loadPrefs() {
        try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (_) { return {}; }
    }

    function _savePrefs(patch) {
        const prefs = { ..._loadPrefs(), ...patch };
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }

    // ── Theme / Accent / Density ─────────────────────────────────
    function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
        _savePrefs({ theme });
    }

    function setAccent(accent) {
        document.documentElement.dataset.accent = accent;
        _savePrefs({ accent });
    }

    function setDensity(density) {
        document.documentElement.dataset.density = density;
        _savePrefs({ density });
        // Keep density segmented control in toolbar in sync
        document.querySelectorAll('.segmented-density button').forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.value === density ? 'true' : 'false');
        });
    }

    // ── Settings modal ────────────────────────────────────────────
    let _settingsOpen = false;

    function openSettings() {
        if (_settingsOpen) return;
        _settingsOpen = true;
        _renderSettingsModal();
    }

    function closeSettings() {
        const overlay = document.getElementById('modal-app-settings');
        if (overlay) overlay.remove();
        _settingsOpen = false;
    }

    function _renderSettingsModal() {
        const t = I18n.t.bind(I18n);
        const prefs = _loadPrefs();
        const theme   = prefs.theme   || 'dark';
        const accent  = prefs.accent  || 'crimson';
        const density = prefs.density || 'dense';
        const lang    = I18n.getLang();

        const ACCENTS = [
            { id: 'cobalt',  name: t('accent.cobalt'),  color: 'oklch(60% 0.14 250)' },
            { id: 'crimson', name: t('accent.crimson'), color: 'oklch(60% 0.14 25)'  },
            { id: 'pine',    name: t('accent.pine'),    color: 'oklch(58% 0.13 155)' },
            { id: 'amber',   name: t('accent.amber'),   color: 'oklch(70% 0.14 75)'  },
        ];

        const html = `
<div class="modal-overlay active" id="modal-app-settings">
  <div class="modal modal-settings" style="max-width:560px">
    <div class="modal-header">
      <h2>⚙ ${t('settings.title')}</h2>
      <button class="modal-close" id="btn-settings-close">✕</button>
    </div>
    <div class="settings-tabs">
      <button class="settings-tab active" data-tab="appearance">${t('settings.tab.appearance')}</button>
      <button class="settings-tab" data-tab="language">${t('settings.tab.language')}</button>
    </div>
    <div class="modal-body settings-body">
      <!-- Appearance tab -->
      <div class="settings-tab-pane active" data-pane="appearance">
        <div class="form-group">
          <label>${t('settings.theme')}</label>
          <div class="segmented" style="align-self:flex-start">
            <button data-action="theme" data-value="light" aria-pressed="${theme === 'light'}" style="gap:5px">
              ☀ ${t('theme.light')}
            </button>
            <button data-action="theme" data-value="dark" aria-pressed="${theme === 'dark'}" style="gap:5px">
              ☾ ${t('theme.dark')}
            </button>
          </div>
        </div>
        <div class="form-group">
          <label>${t('settings.accent')}</label>
          <div class="accent-swatches">
            ${ACCENTS.map(a => `
              <button class="accent-swatch${accent === a.id ? ' selected' : ''}" data-action="accent" data-value="${a.id}"
                      style="--swatch-color:${a.color}" title="${a.name}">
                <span class="swatch-dot"></span>
                <span class="swatch-name">${a.name}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="form-group">
          <label>${t('settings.density')}</label>
          <div class="segmented" style="align-self:flex-start">
            <button data-action="density" data-value="dense" aria-pressed="${density === 'dense'}">${t('toolbar.dense')}</button>
            <button data-action="density" data-value="comfortable" aria-pressed="${density === 'comfortable'}">${t('toolbar.comfortable')}</button>
          </div>
        </div>
      </div>
      <!-- Language tab -->
      <div class="settings-tab-pane" data-pane="language" style="display:none">
        <div class="form-group">
          <label>${t('settings.lang.title')}</label>
          <p style="font-size:12px;color:var(--ink-muted);margin-bottom:8px">${t('settings.lang.sub')}</p>
          <div class="lang-options">
            <button class="lang-card${lang === 'it' ? ' selected' : ''}" data-action="lang" data-value="it">
              <span style="font-size:24px">🇮🇹</span>
              <div>
                <div style="font-size:14px;font-weight:600">Italiano</div>
                <div style="font-size:11px;color:var(--ink-muted)">Italian</div>
              </div>
            </button>
            <button class="lang-card${lang === 'en' ? ' selected' : ''}" data-action="lang" data-value="en">
              <span style="font-size:24px">🇬🇧</span>
              <div>
                <div style="font-size:14px;font-weight:600">English</div>
                <div style="font-size:11px;color:var(--ink-muted)">Inglese</div>
              </div>
            </button>
          </div>
        </div>
        <p class="settings-hint">💡 ${t('settings.hint')}</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="btn-settings-cancel">${t('settings.cancel')}</button>
      <button class="btn btn-primary" id="btn-settings-save">${t('settings.save')}</button>
    </div>
  </div>
</div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        const overlay = document.getElementById('modal-app-settings');

        // Tab switching
        overlay.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                overlay.querySelectorAll('.settings-tab-pane').forEach(p => p.style.display = 'none');
                tab.classList.add('active');
                overlay.querySelector(`.settings-tab-pane[data-pane="${tab.dataset.tab}"]`).style.display = '';
            });
        });

        // Control actions
        overlay.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const { action, value } = btn.dataset;
            if (action === 'theme') {
                setTheme(value);
                overlay.querySelectorAll('[data-action="theme"]').forEach(b =>
                    b.setAttribute('aria-pressed', b.dataset.value === value ? 'true' : 'false'));
            } else if (action === 'accent') {
                setAccent(value);
                overlay.querySelectorAll('[data-action="accent"]').forEach(b =>
                    b.classList.toggle('selected', b.dataset.value === value));
            } else if (action === 'density') {
                setDensity(value);
                overlay.querySelectorAll('[data-action="density"]').forEach(b =>
                    b.setAttribute('aria-pressed', b.dataset.value === value ? 'true' : 'false'));
            } else if (action === 'lang') {
                I18n.setLang(value);
                overlay.querySelectorAll('[data-action="lang"]').forEach(b =>
                    b.classList.toggle('selected', b.dataset.value === value));
            }
        });

        // Close handlers
        const doClose = () => closeSettings();
        document.getElementById('btn-settings-close').addEventListener('click', doClose);
        document.getElementById('btn-settings-cancel').addEventListener('click', doClose);
        document.getElementById('btn-settings-save').addEventListener('click', doClose);
        overlay.addEventListener('click', e => { if (e.target === overlay) doClose(); });

        // Escape key
        const onKey = e => { if (e.key === 'Escape') { doClose(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    // ── Tool pill popover (topbar inline edit) ───────────────────
    function _initToolPill() {
        const pill = document.getElementById('topbar-tool-pill');
        if (!pill) return;

        pill.addEventListener('click', e => {
            e.stopPropagation();
            if (document.getElementById('popover-tool')) { _closeToolPopover(); return; }
            _openToolPopover(pill);
        });
    }

    function _openToolPopover(anchor) {
        const name = anchor.querySelector('.pill-name')?.textContent || '';
        const icon = anchor.querySelector('.tool-icon')?.textContent || '';
        const ICONS = ['📋','🔌','🔁','🔄','⚙','📊','🧪','💧','🔥','⚡','📐','🔧','🛠','🧯','📈','🗂','📁','📂'];
        const t = I18n.t.bind(I18n);

        const pop = document.createElement('div');
        pop.id = 'popover-tool';
        pop.className = 'popover';
        pop.style.cssText = 'position:fixed;z-index:500';
        pop.innerHTML = `
          <div class="popover-head">${t('tool.edit.title')}</div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="field-label">${t('tool.edit.name')}</label>
            <input id="popover-tool-name" class="popover-input" value="${Utils.escAttr(name)}" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="field-label">${t('tool.edit.icon')}</label>
            <div class="icon-grid">
              ${ICONS.map(ic => `<button class="icon-cell${ic === icon ? ' selected' : ''}" data-icon="${ic}">${ic}</button>`).join('')}
            </div>
          </div>
          <div class="popover-foot">
            <button class="btn btn-primary btn-sm" id="popover-tool-save">${t('settings.save')}</button>
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

        pop.querySelector('.icon-grid').addEventListener('click', e => {
            const cell = e.target.closest('.icon-cell');
            if (!cell) return;
            pop.querySelectorAll('.icon-cell').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
        });

        pop.querySelector('#popover-tool-save').addEventListener('click', async () => {
            const newName = pop.querySelector('#popover-tool-name').value.trim();
            const selected = pop.querySelector('.icon-cell.selected');
            const newIcon = selected ? selected.dataset.icon : icon;
            if (newName) {
                anchor.querySelector('.pill-name').textContent = newName;
                anchor.querySelector('.tool-icon').textContent = newIcon;
                const activeLabel = document.querySelector('.side-item.active .si-label');
                if (activeLabel) activeLabel.textContent = newName;
                try {
                    await ApiClient.updateToolSettings({ name: newName, icon: newIcon });
                } catch (_) { /* non-critical */ }
            }
            _closeToolPopover();
        });

        setTimeout(() => {
            const dismiss = e => {
                if (!pop.contains(e.target) && !anchor.contains(e.target)) {
                    _closeToolPopover();
                    document.removeEventListener('mousedown', dismiss);
                }
            };
            document.addEventListener('mousedown', dismiss);
        }, 0);
    }

    function _closeToolPopover() {
        document.getElementById('popover-tool')?.remove();
    }

    // ── REV chip popover ─────────────────────────────────────────
    function _initRevChip() {
        const chip = document.getElementById('chip-rev-btn');
        if (!chip) return;

        chip.addEventListener('click', e => {
            e.stopPropagation();
            if (document.getElementById('popover-rev')) { _closeRevPopover(); return; }
            _openRevPopover(chip);
        });
    }

    function _openRevPopover(anchor) {
        const currentRev = anchor.textContent.replace('REV', '').trim();
        const t = I18n.t.bind(I18n);

        const pop = document.createElement('div');
        pop.id = 'popover-rev';
        pop.className = 'popover popover-rev';
        pop.style.cssText = 'position:fixed;z-index:500';
        pop.innerHTML = `
          <div class="popover-head">${t('rev.edit.title')}</div>
          <p class="popover-sub">${t('rev.edit.sub')}</p>
          <div class="rev-row">
            <span class="rev-prefix">REV</span>
            <input class="rev-input" id="popover-rev-input" value="${Utils.escAttr(currentRev)}" maxlength="3" autocomplete="off">
          </div>
          <div class="rev-quick">
            ${['A','B','C','D'].map(r => `<button class="rev-chip${currentRev === r ? ' selected' : ''}" data-rev="${r}">${r}</button>`).join('')}
          </div>
          <div class="popover-foot">
            <button class="btn btn-primary btn-sm" id="popover-rev-save">${t('settings.save')}</button>
          </div>`;

        document.body.appendChild(pop);

        const rect = anchor.getBoundingClientRect();
        pop.style.top  = (rect.bottom + 6) + 'px';
        pop.style.left = rect.left + 'px';
        requestAnimationFrame(() => {
            const pr = pop.getBoundingClientRect();
            if (pr.right > window.innerWidth - 8)
                pop.style.left = (window.innerWidth - pr.width - 8) + 'px';
        });

        const input = pop.querySelector('#popover-rev-input');
        input.focus();
        input.select();

        pop.querySelectorAll('.rev-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                input.value = chip.dataset.rev;
                pop.querySelectorAll('.rev-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
            });
        });

        const doSave = async () => {
            const val = (input.value.toUpperCase().trim() || 'A').slice(0, 3);
            anchor.textContent = 'REV ' + val;
            try { await ApiClient.updateToolSettings({ rev: val }); } catch (_) { /* non-critical */ }
            _closeRevPopover();
        };

        pop.querySelector('#popover-rev-save').addEventListener('click', doSave);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); });

        setTimeout(() => {
            const dismiss = e => {
                if (!pop.contains(e.target) && !anchor.contains(e.target)) {
                    _closeRevPopover();
                    document.removeEventListener('mousedown', dismiss);
                }
            };
            document.addEventListener('mousedown', dismiss);
        }, 0);
    }

    function _closeRevPopover() {
        document.getElementById('popover-rev')?.remove();
    }

    // ── Public init ──────────────────────────────────────────────
    function init() {
        const prefs = _loadPrefs();

        // Apply persisted preferences to <html>
        if (prefs.theme)  document.documentElement.dataset.theme  = prefs.theme;
        if (prefs.accent) document.documentElement.dataset.accent = prefs.accent;

        // setDensity syncs the segmented-density buttons as well as the html attribute
        const density = prefs.density || 'dense';
        document.documentElement.dataset.density = density;
        document.querySelectorAll('.segmented-density button').forEach(btn => {
            btn.setAttribute('aria-pressed', btn.dataset.value === density ? 'true' : 'false');
        });

        // Settings button in topbar
        const settingsBtn = document.getElementById('btn-settings');
        if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

        _initToolPill();
        _initRevChip();
        I18n.applyLocale();
    }

    return { init, openSettings, setTheme, setAccent, setDensity };
})();

document.addEventListener('DOMContentLoaded', () => AppShell.init());
