/**
 * Theme Picker — protocol-driven view plugin.
 *
 * Dev/Testing tool for live-switching color themes.
 * Fetches presets from /api/theme (backend source of truth),
 * renders a swatch grid, and applies changes via PUT /api/theme.
 *
 * NOT embedded in chat.js — this is a standalone view plugin
 * that the dashboard mounts as a separate page.
 */

const STYLE = `
  .theme-picker { padding: 32px; max-width: 820px; margin: 0 auto; }
  .theme-picker h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: var(--db-text); }
  .theme-picker .tp-subtitle { color: var(--db-text-dim); font-size: 14px; margin-bottom: 28px; }

  /* Section headings */
  .tp-section { margin-bottom: 28px; }
  .tp-section h3 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--db-text-dim); margin-bottom: 12px; }

  /* Swatch grid */
  .tp-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 10px; }
  .tp-swatch { width: 48px; height: 48px; border-radius: var(--db-radius, 10px); border: 2px solid transparent;
    cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center;
    justify-content: center; position: relative; }
  .tp-swatch:hover { transform: scale(1.1); box-shadow: 0 0 16px rgba(var(--db-accent-rgb), 0.3); }
  .tp-swatch.active { border-color: var(--db-text); box-shadow: 0 0 0 2px var(--db-text); }
  .tp-swatch-label { font-size: 9px; color: var(--db-text-dim); margin-top: 4px; text-align: center;
    max-width: 54px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tp-swatch .tp-check { display: none; font-size: 16px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
  .tp-swatch.active .tp-check { display: block; }

  /* Mode toggle */
  .tp-mode-group { display: flex; gap: 8px; }
  .tp-mode-btn { padding: 8px 20px; border-radius: var(--db-radius, 10px); border: 1px solid var(--db-border);
    background: var(--db-card-bg); color: var(--db-text); cursor: pointer; font-size: 14px; transition: all 0.2s; }
  .tp-mode-btn:hover { background: var(--db-hover); }
  .tp-mode-btn.active { background: var(--db-accent); color: #fff; border-color: var(--db-accent); }

  /* Radius selector */
  .tp-radius-group { display: flex; gap: 8px; }
  .tp-radius-btn { padding: 8px 16px; border-radius: var(--db-radius, 10px); border: 1px solid var(--db-border);
    background: var(--db-card-bg); color: var(--db-text); cursor: pointer; font-size: 13px; transition: all 0.2s; }
  .tp-radius-btn:hover { background: var(--db-hover); }
  .tp-radius-btn.active { background: var(--db-accent); color: #fff; border-color: var(--db-accent); }

  /* Preview bar */
  .tp-preview { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: var(--db-radius, 10px);
    border: 1px solid var(--db-border); background: var(--db-card-bg); margin-bottom: 28px; }
  .tp-preview-chip { width: 40px; height: 40px; border-radius: 50%; }
  .tp-preview-info { font-size: 13px; color: var(--db-text-dim); }
  .tp-preview-info strong { color: var(--db-text); }

  /* Custom theme form */
  .tp-custom-form { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;
    padding: 16px; border-radius: var(--db-radius, 10px); border: 1px solid var(--db-border);
    background: var(--db-card-bg); }
  .tp-custom-form label { font-size: 12px; color: var(--db-text-dim); display: block; margin-bottom: 4px; }
  .tp-custom-form input[type="text"] { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--db-border);
    background: var(--db-bg); color: var(--db-text); font-size: 13px; width: 120px; }
  .tp-custom-form input[type="color"] { width: 40px; height: 32px; border: none; cursor: pointer;
    border-radius: 6px; background: none; }
  .tp-custom-form button { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; transition: all 0.2s; }
  .tp-custom-form .tp-add-btn { background: var(--db-accent); color: #fff; }
  .tp-custom-form .tp-add-btn:hover { opacity: 0.85; }

  /* Custom themes list */
  .tp-custom-list { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .tp-custom-tag { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px;
    background: var(--db-card-bg); border: 1px solid var(--db-border); font-size: 12px; color: var(--db-text); }
  .tp-custom-tag .tp-delete-btn { background: none; border: none; color: var(--db-text-dim); cursor: pointer;
    font-size: 14px; padding: 0; line-height: 1; }
  .tp-custom-tag .tp-delete-btn:hover { color: #ef4444; }
`;

let _state = null;
// The element the picker is mounted in (render's `el`); paint() draws there.
let _host = null;

const ROOT_HTML = '<div id="theme-picker-root" class="theme-picker"></div>';
// How often one mount re-creates its picker after another writer replaced it.
const MAX_REPAINTS = 5;

// Neutral presets are monochrome: in the React shell their accent is the ink.
const NEUTRAL_PRESETS = ['zinc', 'slate', 'stone', 'gray', 'neutral'];
// How far a colour preset's accent bleeds into fills and strokes.
const COLOR_ACCENT_MIX = '4%';
// next-themes' storage key in the React shell (and the server's bootstrap).
const SHELL_MODE_KEY = 'aiui-theme-preference';

// Accent shown when a preset's colour is missing or not a plain colour.
const DEFAULT_ACCENT = '#6366f1';

// Everything painted below comes from GET /api/theme, and preset names and
// accents are whatever POST /api/theme/register was sent (any page can send
// it). Every value spliced into the markup goes through escapeHtml().
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]
  ));
}

// A colour safe to put in a style attribute or a theme seed: a hex colour,
// or (where the browser can tell) a plain CSS colour such as rgb(...) or a
// name. Anything else (quotes, url(), var(), `;` …) yields `fallback`.
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const PLAIN_COLOR = /^[a-z]+$|^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%\s/+-]*\)$/i;
function safeColor(value, fallback = DEFAULT_ACCENT) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (HEX_COLOR.test(v)) return v;
  if (!PLAIN_COLOR.test(v)) return fallback;
  try {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', v)) return v;
  } catch (e) { /* no CSS.supports */ }
  return fallback;
}

// --db-accent-rgb is an "r,g,b" triple used inside rgba(...).
const RGB_TRIPLE = /^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/;

// Same switch as _helpers.js inAppShell(); not imported, so this module still
// loads on its own (tests import it standalone).
function inReactShell() {
  return document.documentElement.getAttribute('data-aiui-shell') === 'react';
}

// App shell copy: sentence case, no developer jargon (the dashboard keeps its own).
const SHELL_COPY = {
  'Color Presets': 'Accent colour', 'Mode': 'Mode', 'Border Radius': 'Corner radius',
  'Register Custom Theme': 'Custom accent', 'Theme Name': 'Name', 'Accent Color': 'Colour', '+ Add Theme': 'Add accent',
};

// The React shell (style `app`) derives every --db-* variable from its theme
// seeds (legacy/bridge.css). Inline --db-* values on <html> would beat that
// bridge and the user's own CSS, so the shell and the legacy pages would
// disagree after a pick. There the choice goes to the seeds and to the
// shell's mode instead.
function applyThemeToShell(state, vars, setMode) {
  const root = document.documentElement;
  // A hostile or broken custom accent must not become the shell's seed.
  const accent = safeColor(vars['--db-accent'], null);
  if (NEUTRAL_PRESETS.includes(state.preset)) {
    root.style.setProperty('--seed-accent', 'var(--seed-ink)');
    root.style.setProperty('--accent-mix', '0%');
  } else if (accent) {
    root.style.setProperty('--seed-accent', accent);
    // themes.py COLOR_PRESET_ACCENT_MIX: set it explicitly, because the
    // server's seed tag says 0% when it started on a neutral preset.
    root.style.setProperty('--accent-mix', COLOR_ACCENT_MIX);
  }
  if (RGB_TRIPLE.test(vars['--db-accent-rgb'] || '')) root.style.setProperty('--db-accent-rgb', vars['--db-accent-rgb']);
  if (vars['--db-radius']) root.style.setProperty('--radius', vars['--db-radius']);
  if (setMode) persistMode(state.mode);
}

// An explicit mode pick is the viewer's choice: stored under the key the
// shell (next-themes), the dashboard (dashboard.js applyColorMode) and the
// server's bootstrap script read, so it survives a reload. The server's mode
// (reported with every pick) is not the viewer's, which may be 'system', so
// only a pick calls this.
function persistMode(mode) {
  if (mode !== 'dark' && mode !== 'light') return;
  let previous = null;
  try {
    previous = localStorage.getItem(SHELL_MODE_KEY);
    localStorage.setItem(SHELL_MODE_KEY, mode);
  } catch (e) { /* storage unavailable */ }
  // next-themes and dashboard.js follow `storage` events for the key
  // (normally sent by other tabs), so the page switches at once.
  if (previous !== mode) {
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: SHELL_MODE_KEY, oldValue: previous, newValue: mode }));
    } catch (e) { /* StorageEvent unsupported */ }
  }
}

// The dashboard's own variables a pick sets inline: accent and radius. Light
// and dark come from the stylesheets (data-db-mode on <html>), so the
// server's mode variables are never inlined over the viewer's mode.
const DASHBOARD_PICK_VARS = ['--db-accent', '--db-accent-glow', '--db-accent-rgb', '--db-radius'];

// The viewer's explicit mode, else the one on screen ('system' resolves to it).
function shellMode() {
  let stored = null;
  try { stored = localStorage.getItem(SHELL_MODE_KEY); } catch (e) { /* storage unavailable */ }
  if (stored === 'dark' || stored === 'light') return stored;
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function applyThemeToDOM(state, { setMode = false } = {}) {
  const root = document.documentElement;
  const vars = state.variables;
  if (!vars) return;
  if (inReactShell()) {
    applyThemeToShell(state, vars, setMode);
  } else {
    for (const key of DASHBOARD_PICK_VARS) {
      if (vars[key]) root.style.setProperty(key, vars[key]);
    }
    if (setMode) persistMode(state.mode);
  }
  // Also save to localStorage
  try {
    localStorage.setItem('aiui-theme-preset', state.preset);
    localStorage.setItem('aiui-theme-mode', state.mode);
    localStorage.setItem('aiui-theme-radius', state.radius);
  } catch (e) { /* storage unavailable */ }
}

async function fetchState() {
  try {
    const r = await fetch('/api/theme');
    _state = await r.json();
    return _state;
  } catch(e) {
    console.error('[theme-picker] Failed to fetch theme state:', e);
    return null;
  }
}

async function applyPreset(preset) {
  const r = await fetch('/api/theme', {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ preset }),
  });
  _state = await r.json();
  applyThemeToDOM(_state);
  paint();
}

async function applyMode(mode) {
  const r = await fetch('/api/theme', {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ mode }),
  });
  _state = await r.json();
  applyThemeToDOM(_state, { setMode: true });
  paint();
}

async function applyRadius(radius) {
  const r = await fetch('/api/theme', {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ radius }),
  });
  _state = await r.json();
  applyThemeToDOM(_state);
  paint();
}

async function registerCustomTheme(name, accent) {
  const r = await fetch('/api/theme/register', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, accent }),
  });
  _state = await r.json();
  paint();
}

async function deleteCustomTheme(name) {
  const r = await fetch('/api/theme/' + encodeURIComponent(name), {
    method: 'DELETE',
  });
  _state = await r.json();
  paint();
}

// The picker's root inside the mounted element, re-created when something
// else replaced the element's contents. On a direct load of /theme-picker the
// legacy dashboard starts its generic data viewer while this module is still
// importing (the page container is empty then); that viewer's late
// `{"error": "Not Found"}` overwrites the container, root included. Null
// when nothing is mounted or the element has left the document.
function pickerRoot() {
  const host = _host;
  if (!host || !host.isConnected) return null;
  let root = host.querySelector('#theme-picker-root');
  if (!root) {
    host.innerHTML = ROOT_HTML;
    root = host.querySelector('#theme-picker-root');
  }
  return root;
}

// Keeps one mount's picker on screen: if another writer replaces the mounted
// element's contents while the mount is live (the generic viewer's response
// can also land after the picker is painted), the picker is painted again.
// Bounded, so it never ping-pongs with a writer that keeps clearing. Returns
// this mount's release.
function guardMount(el) {
  let released = false;
  let repaints = 0;
  let observer = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      if (released || _host !== el || !el.isConnected) return;
      if (el.querySelector('#theme-picker-root')) return;
      if (++repaints > MAX_REPAINTS) { observer.disconnect(); return; }
      if (_state) paint(); else pickerRoot();
    });
    observer.observe(el, { childList: true });
  }
  return () => {
    if (released) return;
    released = true;
    if (observer) observer.disconnect();
    if (_host === el) _host = null;
  };
}

// Repaints the picker from _state. Named paint() because the module also
// exports render(el) below; two `render` declarations are a SyntaxError
// that stopped the whole module from loading.
function paint() {
  if (!_state) return;
  const container = pickerRoot();
  if (!container) return;

  const presets = _state.presets || {};
  const currentPreset = _state.preset || 'indigo';
  // The mode on screen is the viewer's (stored choice, else the app default or
  // the OS), not the server's.
  const currentMode = shellMode();
  const currentRadius = _state.radius || 'md';
  const modes = _state.modes || ['dark', 'light'];
  const radii = _state.radii || ['none', 'sm', 'md', 'lg', 'xl'];
  const vars = _state.variables || {};
  const accent = safeColor(vars['--db-accent']);
  const esc = escapeHtml;

  // Identify custom themes (not built-in)
  const builtinPresets = [
    'zinc','slate','stone','gray','neutral','red','orange','amber','yellow',
    'lime','green','emerald','teal','cyan','sky','blue','indigo','violet',
    'purple','fuchsia','pink','rose'
  ];
  const customPresets = Object.keys(presets).filter(n => !builtinPresets.includes(n));
  const shell = inReactShell();
  const t = (label) => (shell && SHELL_COPY[label]) || label;
  const h3 = shell ? ' style="text-transform:none;letter-spacing:0;color:var(--db-text)"' : '';
  // Under the Pro tokens a neutral preset leaves the app on its own accent, so
  // the shell shows the accent actually in use rather than claim the preset.
  const proDefault = shell && document.documentElement.getAttribute('data-aiui-tokens') === 'pro'
    && NEUTRAL_PRESETS.includes(currentPreset);
  const preview = shell ? `
    <div class="tp-preview">
      <div class="tp-preview-chip" style="background-color:var(--primary)"></div>
      <div class="tp-preview-info">
        <strong>${proDefault ? 'Default accent' : esc(currentPreset.charAt(0).toUpperCase() + currentPreset.slice(1))}</strong> · ${esc(currentMode)} mode · ${esc(currentRadius)} radius
      </div>
    </div>` : '';

  container.innerHTML = `${shell ? `
    <h2>Theme</h2>
    <p class="tp-subtitle">Choose the accent colour, light or dark mode, and corner radius.</p>
    ${preview}` : `
    <h2>🎨 Theme Picker</h2>
    <p class="tp-subtitle">Protocol-driven theme system — choose a preset, mode, and radius. Custom themes supported via API or SDK.</p>

    <!-- Preview -->
    <div class="tp-preview">
      <div class="tp-preview-chip" style="background:${esc(accent)}"></div>
      <div class="tp-preview-info">
        <strong>${esc(currentPreset)}</strong> · ${esc(currentMode)} mode · ${esc(currentRadius)} radius<br>
        <span style="font-family:monospace; font-size:11px">${esc(vars['--db-accent'] || '')}</span>
      </div>
    </div>
`}
    <!-- Color Presets -->
    <div class="tp-section">
      <h3${h3}>${t('Color Presets')}</h3>
      <div class="tp-swatches">
        ${Object.entries(presets).map(([name, p]) => `
          <div style="text-align:center">
            <div class="tp-swatch ${name === currentPreset && !proDefault ? 'active' : ''}"
                 style="background:${esc(safeColor(p && p.accent))}" data-preset="${esc(name)}" title="${esc(name)}">
              <span class="tp-check">✓</span>
            </div>
            <div class="tp-swatch-label">${esc(name)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Mode Toggle -->
    <div class="tp-section">
      <h3${h3}>Mode</h3>
      <div class="tp-mode-group">
        ${modes.map(m => `
          <button class="tp-mode-btn ${m === currentMode ? 'active' : ''}" data-mode="${esc(m)}">
            ${shell ? '' : m === 'dark' ? '🌙' : '☀️'} ${esc(String(m).charAt(0).toUpperCase() + String(m).slice(1))}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Radius Selector -->
    <div class="tp-section">
      <h3${h3}>${t('Border Radius')}</h3>
      <div class="tp-radius-group">
        ${radii.map(r => `
          <button class="tp-radius-btn ${r === currentRadius ? 'active' : ''}" data-radius="${esc(r)}">
            ${esc(r)}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Custom Theme Registration -->
    <div class="tp-section">
      <h3${h3}>${t('Register Custom Theme')}</h3>
      <div class="tp-custom-form">
        <div>
          <label>${t('Theme Name')}</label>
          <input type="text" id="tp-custom-name" placeholder="e.g. ocean">
        </div>
        <div>
          <label>${t('Accent Color')}</label>
          <input type="color" id="tp-custom-color" value="#0077b6">
        </div>
        <button class="tp-add-btn" id="tp-register-btn">${t('+ Add Theme')}</button>
      </div>
      ${customPresets.length > 0 ? `
        <div class="tp-custom-list">
          ${customPresets.map(name => `
            <span class="tp-custom-tag">
              <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(safeColor(presets[name] && presets[name].accent))}"></span>
              ${esc(name)}
              <button class="tp-delete-btn" data-delete="${esc(name)}" title="Delete">×</button>
            </span>
          `).join('')}
        </div>
      ` : ''}
    </div>

    ${shell ? '' : `<!-- API Reference -->
    <div class="tp-section">
      <h3>API Reference</h3>
      <div style="font-size:12px; color:var(--db-text-dim); font-family:monospace; background:var(--db-card-bg);
        padding:12px; border-radius:var(--db-radius,10px); border:1px solid var(--db-border); line-height:1.8">
        <div><strong style="color:var(--db-text)">Python SDK</strong></div>
        <div>aiui.set_theme(preset="blue", dark_mode=True, radius="lg")</div>
        <div>aiui.register_theme("ocean", {"accent": "#0077b6"})</div>
        <div style="margin-top:8px"><strong style="color:var(--db-text)">HTTP API</strong></div>
        <div>GET  /api/theme          → current state + all presets</div>
        <div>PUT  /api/theme          → apply {preset, mode, radius}</div>
        <div>GET  /api/theme/presets   → list all presets</div>
        <div>POST /api/theme/register  → {name, accent}</div>
        <div>DELETE /api/theme/{name}  → delete custom theme</div>
      </div>
    </div>`}
  `;

  // Bind events
  container.querySelectorAll('.tp-swatch').forEach(el => {
    el.addEventListener('click', () => applyPreset(el.dataset.preset));
  });
  container.querySelectorAll('.tp-mode-btn').forEach(el => {
    el.addEventListener('click', () => applyMode(el.dataset.mode));
  });
  container.querySelectorAll('.tp-radius-btn').forEach(el => {
    el.addEventListener('click', () => applyRadius(el.dataset.radius));
  });
  container.querySelectorAll('.tp-delete-btn').forEach(el => {
    el.addEventListener('click', () => deleteCustomTheme(el.dataset.delete));
  });

  const regBtn = container.querySelector('#tp-register-btn');
  if (regBtn) {
    regBtn.addEventListener('click', () => {
      const nameInput = container.querySelector('#tp-custom-name');
      const colorInput = container.querySelector('#tp-custom-color');
      const name = nameInput.value.trim();
      if (name) {
        registerCustomTheme(name, colorInput.value);
        nameInput.value = '';
      }
    });
  }
}

// ── Public init (called by dashboard plugin system) ──────────────

// Resolves to this mount's release (the shell's mountView calls it when the
// page is left; the legacy dashboard drops the element instead, which ends
// the guard with it).
export async function render(el) {
  // Inject styles
  if (!document.getElementById('theme-picker-style')) {
    const style = document.createElement('style');
    style.id = 'theme-picker-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  _host = el;
  el.innerHTML = ROOT_HTML;
  const release = guardMount(el);

  // Restore saved theme from localStorage. Not the mode: the viewer's mode is
  // applied on load by the page itself (persistMode / applyColorMode).
  let savedPreset = null;
  let savedRadius = null;
  try {
    savedPreset = localStorage.getItem('aiui-theme-preset');
    savedRadius = localStorage.getItem('aiui-theme-radius');
  } catch (e) { /* storage unavailable */ }

  try {
    await fetchState();

    // If saved state differs from server, apply saved state
    if (_state && savedPreset && savedPreset !== _state.preset) {
      await applyPreset(savedPreset);
    }
    if (_state && savedRadius && savedRadius !== _state.radius) {
      await applyRadius(savedRadius);
    }
  } catch (err) {
    release(); // no host cleans up a render that threw
    throw err;
  }

  paint();
  return release;
}
