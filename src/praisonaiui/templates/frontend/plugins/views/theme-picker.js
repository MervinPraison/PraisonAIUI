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

function applyThemeToDOM(state) {
  const root = document.documentElement;
  const vars = state.variables;
  if (!vars) return;
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val);
  }
  // Also save to localStorage
  localStorage.setItem('aiui-theme-preset', state.preset);
  localStorage.setItem('aiui-theme-mode', state.mode);
  localStorage.setItem('aiui-theme-radius', state.radius);
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
  render();
}

async function applyMode(mode) {
  const r = await fetch('/api/theme', {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ mode }),
  });
  _state = await r.json();
  applyThemeToDOM(_state);
  render();
}

async function applyRadius(radius) {
  const r = await fetch('/api/theme', {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ radius }),
  });
  _state = await r.json();
  applyThemeToDOM(_state);
  render();
}

async function registerCustomTheme(name, accent) {
  const r = await fetch('/api/theme/register', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name, accent }),
  });
  _state = await r.json();
  render();
}

async function deleteCustomTheme(name) {
  const r = await fetch('/api/theme/' + encodeURIComponent(name), {
    method: 'DELETE',
  });
  _state = await r.json();
  render();
}

function render() {
  const container = document.getElementById('theme-picker-root');
  if (!container || !_state) return;

  const presets = _state.presets || {};
  const currentPreset = _state.preset || 'indigo';
  const currentMode = _state.mode || 'dark';
  const currentRadius = _state.radius || 'md';
  const modes = _state.modes || ['dark', 'light'];
  const radii = _state.radii || ['none', 'sm', 'md', 'lg', 'xl'];
  const vars = _state.variables || {};

  // Identify custom themes (not built-in)
  const builtinPresets = [
    'zinc','slate','stone','gray','neutral','red','orange','amber','yellow',
    'lime','green','emerald','teal','cyan','sky','blue','indigo','violet',
    'purple','fuchsia','pink','rose'
  ];
  const customPresets = Object.keys(presets).filter(n => !builtinPresets.includes(n));

  container.innerHTML = `
    <h2>🎨 Theme Picker</h2>
    <p class="tp-subtitle">Protocol-driven theme system — choose a preset, mode, and radius. Custom themes supported via API or SDK.</p>

    <!-- Preview -->
    <div class="tp-preview">
      <div class="tp-preview-chip" style="background:${vars['--db-accent'] || '#6366f1'}"></div>
      <div class="tp-preview-info">
        <strong>${currentPreset}</strong> · ${currentMode} mode · ${currentRadius} radius<br>
        <span style="font-family:monospace; font-size:11px">${vars['--db-accent'] || ''}</span>
      </div>
    </div>

    <!-- Color Presets -->
    <div class="tp-section">
      <h3>Color Presets</h3>
      <div class="tp-swatches">
        ${Object.entries(presets).map(([name, p]) => `
          <div style="text-align:center">
            <div class="tp-swatch ${name === currentPreset ? 'active' : ''}"
                 style="background:${p.accent}" data-preset="${name}" title="${name}">
              <span class="tp-check">✓</span>
            </div>
            <div class="tp-swatch-label">${name}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Mode Toggle -->
    <div class="tp-section">
      <h3>Mode</h3>
      <div class="tp-mode-group">
        ${modes.map(m => `
          <button class="tp-mode-btn ${m === currentMode ? 'active' : ''}" data-mode="${m}">
            ${m === 'dark' ? '🌙' : '☀️'} ${m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Radius Selector -->
    <div class="tp-section">
      <h3>Border Radius</h3>
      <div class="tp-radius-group">
        ${radii.map(r => `
          <button class="tp-radius-btn ${r === currentRadius ? 'active' : ''}" data-radius="${r}">
            ${r}
          </button>
        `).join('')}
      </div>
    </div>

    <!-- Custom Theme Registration -->
    <div class="tp-section">
      <h3>Register Custom Theme</h3>
      <div class="tp-custom-form">
        <div>
          <label>Theme Name</label>
          <input type="text" id="tp-custom-name" placeholder="e.g. ocean">
        </div>
        <div>
          <label>Accent Color</label>
          <input type="color" id="tp-custom-color" value="#0077b6">
        </div>
        <button class="tp-add-btn" id="tp-register-btn">+ Add Theme</button>
      </div>
      ${customPresets.length > 0 ? `
        <div class="tp-custom-list">
          ${customPresets.map(name => `
            <span class="tp-custom-tag">
              <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${presets[name].accent}"></span>
              ${name}
              <button class="tp-delete-btn" data-delete="${name}" title="Delete">×</button>
            </span>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <!-- API Reference -->
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
    </div>
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

  const regBtn = document.getElementById('tp-register-btn');
  if (regBtn) {
    regBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('tp-custom-name');
      const colorInput = document.getElementById('tp-custom-color');
      const name = nameInput.value.trim();
      if (name) {
        registerCustomTheme(name, colorInput.value);
        nameInput.value = '';
      }
    });
  }
}

// ── Public init (called by dashboard plugin system) ──────────────

export async function render(el) {
  // Inject styles
  if (!document.getElementById('theme-picker-style')) {
    const style = document.createElement('style');
    style.id = 'theme-picker-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  el.innerHTML = '<div id="theme-picker-root" class="theme-picker"></div>';

  // Restore saved theme from localStorage
  const savedPreset = localStorage.getItem('aiui-theme-preset');
  const savedMode = localStorage.getItem('aiui-theme-mode');
  const savedRadius = localStorage.getItem('aiui-theme-radius');

  await fetchState();

  // If saved state differs from server, apply saved state
  if (_state && savedPreset && savedPreset !== _state.preset) {
    await applyPreset(savedPreset);
  }
  if (_state && savedMode && savedMode !== _state.mode) {
    await applyMode(savedMode);
  }
  if (_state && savedRadius && savedRadius !== _state.radius) {
    await applyRadius(savedRadius);
  }

  render();
}
