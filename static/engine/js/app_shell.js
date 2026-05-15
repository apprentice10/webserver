// app_shell.js
// Manages: theme, accent, density, sidebar state, topbar tool-pill inline edit,
// REV chip inline edit, settings modal (appearance + language + backup tabs).
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
    const _DENSITY_TABLE = {
        9:  { rowH: '21px', padY: '3px', padX: '5px' },
        10: { rowH: '23px', padY: '4px', padX: '6px' },
        11: { rowH: '25px', padY: '4px', padX: '6px' },
        12: { rowH: '27px', padY: '4px', padX: '7px' },
        13: { rowH: '30px', padY: '5px', padX: '7px' },
        14: { rowH: '32px', padY: '5px', padX: '8px' },
        15: { rowH: '34px', padY: '5px', padX: '9px' },
        16: { rowH: '37px', padY: '6px', padX: '9px' },
    };

    function setTheme(theme) {
        document.documentElement.dataset.theme = theme;
        _savePrefs({ theme });
    }

    function setAccent(accent) {
        document.documentElement.dataset.accent = accent;
        _savePrefs({ accent });
    }

    function setDensity(px) {
        const n     = parseInt(px, 10) || 12;
        const entry = _DENSITY_TABLE[n] || _DENSITY_TABLE[12];
        const root  = document.documentElement;
        root.style.setProperty('--row-h',       entry.rowH);
        root.style.setProperty('--cell-pad-y',  entry.padY);
        root.style.setProperty('--cell-pad-x',  entry.padX);
        root.style.fontSize = n + 'px';
        _savePrefs({ density: n });
        const slider = document.getElementById('density-slider');
        if (slider) { slider.value = n; }
        const label = document.getElementById('density-label');
        if (label)  { label.textContent = n + 'px'; }
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
        const lang    = I18n.getLang();
        let densityNum = prefs.density || 12;
        if (densityNum === 'dense')       densityNum = 12;
        if (densityNum === 'comfortable') densityNum = 14;
        densityNum = parseInt(densityNum, 10) || 12;

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
      <button class="settings-tab" data-tab="backup">Backup</button>
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
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="density-slider" min="9" max="16" step="1" value="${densityNum}"
                   style="width:140px" oninput="AppShell.setDensity(this.value)">
            <span id="density-label" style="font-size:12px;min-width:28px">${densityNum}px</span>
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
      <!-- Backup tab -->
      <div class="settings-tab-pane" data-pane="backup" style="display:none">
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="backup-on-open" ${(prefs.backup?.onOpen) ? 'checked' : ''}>
            Backup on project open
          </label>
          <p style="font-size:12px;color:var(--ink-muted);margin-top:4px">Creates a timestamped copy each time a project is opened.</p>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <label style="margin:0;white-space:nowrap;font-size:13px">Min between on-open backups</label>
            <input type="number" id="backup-on-open-cooldown" class="form-control" min="1" step="1"
                   value="${prefs.backup?.onOpenCooldown ?? 1440}" style="width:100px">
          </div>
        </div>
        <div class="form-group">
          <label>Auto-backup interval (minutes, 0 = disabled)</label>
          <input type="number" id="backup-interval" class="form-control" min="0" step="1"
                 value="${prefs.backup?.interval ?? 0}" style="width:100px">
        </div>
        <div class="form-group">
          <label>Backups to keep</label>
          <input type="number" id="backup-keep" class="form-control" min="1" step="1"
                 value="${prefs.backup?.keep ?? 10}" style="width:100px">
        </div>
        <div class="form-group">
          <label>Backup subfolder name</label>
          <input type="text" id="backup-subfolder" class="form-control"
                 value="${Utils.escAttr(prefs.backup?.subfolder ?? '_backups')}" style="max-width:220px">
          <p style="font-size:12px;color:var(--ink-muted);margin-top:4px">Subfolder created next to each project file.</p>
        </div>
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
        document.getElementById('btn-settings-save').addEventListener('click', () => {
            const onOpen         = overlay.querySelector('#backup-on-open')?.checked ?? false;
            const onOpenCooldown = parseInt(overlay.querySelector('#backup-on-open-cooldown')?.value, 10) || 1440;
            const interval       = parseInt(overlay.querySelector('#backup-interval')?.value, 10) || 0;
            const keep           = parseInt(overlay.querySelector('#backup-keep')?.value, 10) || 10;
            const subfolder      = overlay.querySelector('#backup-subfolder')?.value.trim() || '_backups';
            _savePrefs({ backup: { onOpen, onOpenCooldown, interval, keep, subfolder } });
            doClose();
        });
        overlay.addEventListener('click', e => { if (e.target === overlay) doClose(); });

        // Escape key
        const onKey = e => { if (e.key === 'Escape') { doClose(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    // ── Tool pill popover (topbar inline edit) ───────────────────
    function _initToolPill() {
        const pill = document.getElementById('topbar-engine-pill');
        if (!pill) return;

        pill.addEventListener('click', e => {
            e.stopPropagation();
            if (document.getElementById('popover-tool')) { _closeToolPopover(); return; }
            _openToolPopover(pill);
        });
    }

    // opts: { name, icon } override initial values (used when called from sidebar)
    function _openToolPopover(anchor, opts = {}) {
        const name = opts.name !== undefined ? opts.name : (anchor.querySelector('.pill-name')?.textContent || '');
        const icon = opts.icon !== undefined ? opts.icon : (anchor.querySelector('.tool-icon')?.textContent || '');
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
                // Update topbar pill if present
                const pill = document.getElementById('topbar-engine-pill');
                if (pill) {
                    const pillName = pill.querySelector('.pill-name');
                    const pillIcon = pill.querySelector('.tool-icon');
                    if (pillName) pillName.textContent = newName;
                    if (pillIcon) pillIcon.textContent = newIcon;
                }
                // Update active sidebar item
                const activeLabel = document.querySelector('.side-item.active .si-label');
                if (activeLabel) activeLabel.textContent = newName;
                const activeIcon = document.querySelector('.side-item.active .si-icon');
                if (activeIcon) activeIcon.textContent = newIcon;
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

    // ── Public init ──────────────────────────────────────────────
    function init() {
        const prefs = _loadPrefs();

        if (prefs.theme)  document.documentElement.dataset.theme  = prefs.theme;
        if (prefs.accent) document.documentElement.dataset.accent = prefs.accent;

        // Migrate legacy string density values; apply numeric px density
        let density = prefs.density || 12;
        if (density === 'dense')       density = 12;
        if (density === 'comfortable') density = 14;
        setDensity(density);

        _initToolPill();
        I18n.applyLocale();
    }

    return { init, openSettings, setTheme, setAccent, setDensity, openToolPopover: _openToolPopover };
})();

document.addEventListener('DOMContentLoaded', () => AppShell.init());
