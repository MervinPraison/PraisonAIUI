/**
 * Dashboard Plugin — reads /api/pages, builds sidebar + page containers.
 *
 * Protocol-driven: all data comes from API endpoints.
 * Extensible: register custom views via window.aiui.registerView(pageId, renderFn)
 * Feature views auto-bind to [data-page="xxx"] containers.
 */

// Record load time for overview stats
window.__aiuiLoadTime = window.__aiuiLoadTime || Date.now();

// ── Extensible View Registry ─────────────────────────────────────────
// Maps page IDs to view modules. Each module exports render(container).
// Built-in views are loaded via dynamic import from ./views/
const VIEW_REGISTRY = {};
let _activeCleanup = null; // cleanup function for the active view

// Built-in page-to-module mapping (protocol-first: page IDs come from /api/pages)
// Paths are relative to /plugins/ where dashboard.js is served from
const BUILTIN_VIEWS = {
  chat:           '/plugins/views/chat.js',
  overview:       '/plugins/views/overview.js',
  agents:         '/plugins/views/agents.js',
  sessions:       '/plugins/views/sessions.js',
  logs:           '/plugins/views/logs.js',
  schedules:      '/plugins/views/schedules.js',
  cron:           '/plugins/views/schedules.js',
  config:         '/plugins/views/config.js',
  config_runtime: '/plugins/views/config.js',
  approvals:      '/plugins/views/approvals.js',
  usage:          '/plugins/views/usage.js',
  channels:       '/plugins/views/channels.js',
  skills:         '/plugins/views/skills.js',
  tools:          '/plugins/views/skills.js',
  nodes:          '/plugins/views/nodes.js',
  instances:      '/plugins/views/nodes.js',
  explorer:       '/plugins/views/explorer.js',
  debug:          '/plugins/views/debug.js',
};

// Public API for extending the dashboard (protocol-first, extendable)
window.aiui = window.aiui || {};
window.aiui.registerView = function(pageId, renderFn, cleanupFn) {
  VIEW_REGISTRY[pageId] = { render: renderFn, cleanup: cleanupFn || null };
};
window.aiui.views = VIEW_REGISTRY;

const DASHBOARD_STYLE = `
  /* ── Dashboard layout ───────────────────────────────────── */
  :root {
    --db-sidebar-w: 260px;
    --db-bg: #0a0a0f;
    --db-sidebar-bg: #111118;
    --db-border: rgba(255,255,255,0.06);
    --db-text: #e4e4e7;
    --db-text-dim: #71717a;
    --db-accent: #6366f1;
    --db-accent-glow: rgba(99,102,241,0.15);
    --db-card-bg: rgba(255,255,255,0.03);
    --db-hover: rgba(255,255,255,0.05);
    --db-radius: 10px;
    --db-transition: 0.2s cubic-bezier(0.4,0,0.2,1);
  }

  body { margin: 0; background: var(--db-bg); color: var(--db-text); font-family: system-ui, -apple-system, sans-serif; }

  /* Root becomes the flex container */
  #root { display: flex; min-height: 100vh; }

  /* Sidebar */
  .db-sidebar {
    width: var(--db-sidebar-w); min-width: var(--db-sidebar-w);
    background: var(--db-sidebar-bg); border-right: 1px solid var(--db-border);
    display: flex; flex-direction: column; overflow-y: auto;
    position: sticky; top: 0; height: 100vh;
  }
  .db-sidebar-header {
    padding: 20px; font-size: 15px; font-weight: 600;
    letter-spacing: -0.01em; border-bottom: 1px solid var(--db-border);
    display: flex; align-items: center; gap: 10px;
  }
  .db-sidebar-header .logo { font-size: 20px; }
  .db-group-label {
    padding: 18px 20px 6px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--db-text-dim);
  }
  .db-nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 20px; cursor: pointer; font-size: 13.5px;
    color: var(--db-text-dim); transition: all var(--db-transition);
    border-left: 3px solid transparent;
    text-decoration: none;
  }
  .db-nav-item:hover { background: var(--db-hover); color: var(--db-text); }
  .db-nav-item.active {
    color: var(--db-accent); background: var(--db-accent-glow);
    border-left-color: var(--db-accent); font-weight: 500;
  }
  .db-nav-icon { font-size: 16px; width: 22px; text-align: center; }

  /* Main content area */
  .db-main { flex: 1; padding: 32px 40px; overflow-y: auto; min-width: 0; }
  .db-page-header { margin-bottom: 28px; }
  .db-page-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .db-page-desc { color: var(--db-text-dim); font-size: 14px; margin: 0; }

  /* Generic data viewer */
  .db-viewer { background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: var(--db-radius); padding: 20px; }
  .db-viewer pre { margin: 0; font-size: 13px; line-height: 1.6; color: var(--db-text-dim); white-space: pre-wrap; word-break: break-word; }

  /* Component layout helpers */
  .db-columns { display: grid; gap: 16px; }
  .db-card {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 20px;
    transition: border-color var(--db-transition);
  }
  .db-card:hover { border-color: rgba(255,255,255,0.12); }
  .db-card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--db-text-dim); margin: 0 0 8px; }
  .db-card-value { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .db-card-footer { font-size: 12px; color: var(--db-text-dim); margin-top: 8px; }

  /* Test panel */
  .db-test-panel { margin-top: 32px; }
  .db-test-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .db-test-card {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .db-test-name { font-size: 13px; font-weight: 500; }
  .db-test-status { font-size: 12px; padding: 3px 10px; border-radius: 20px; }
  .db-test-pass { background: rgba(34,197,94,0.15); color: #22c55e; }
  .db-test-fail { background: rgba(239,68,68,0.15); color: #ef4444; }
  .db-test-pending { background: rgba(234,179,8,0.15); color: #eab308; }

  /* Loading spinner */
  .db-loading { text-align: center; padding: 60px; color: var(--db-text-dim); }
  @keyframes db-spin { to { transform: rotate(360deg); } }
  .db-spinner { display: inline-block; width: 24px; height: 24px; border: 2px solid var(--db-border); border-top-color: var(--db-accent); border-radius: 50%; animation: db-spin 0.8s linear infinite; }

  /* Hide React docs layout when dashboard is active */
  .db-active .sidebar:not(.db-sidebar), .db-active .topnav, .db-active .toc-sidebar,
  .db-active > .main-content, .db-active > nav:not(.db-sidebar) { display: none !important; }
`;

let activePageId = null;
let pagesData = [];

function init() {
  // Inject styles
  const style = document.createElement('style');
  style.textContent = DASHBOARD_STYLE;
  document.head.appendChild(style);

  // Build the dashboard
  buildDashboard();
}

async function buildDashboard() {
  const root = document.getElementById('root');
  if (!root) return;

  // Mark as dashboard active (hides React docs layout)
  root.classList.add('db-active');

  // Show loading
  root.innerHTML = '<div class="db-loading"><div class="db-spinner"></div><p style="margin-top:16px">Loading dashboard…</p></div>';

  // Fetch pages from protocol endpoint
  try {
    const res = await fetch('/api/pages');
    const data = await res.json();
    pagesData = data.pages || [];
  } catch (e) {
    root.innerHTML = '<div class="db-loading"><p>Failed to load pages.</p></div>';
    return;
  }

  // Build layout
  const sidebar = buildSidebar(pagesData);
  const main = document.createElement('div');
  main.className = 'db-main';
  main.id = 'db-main-content';

  root.innerHTML = '';
  root.appendChild(sidebar);
  root.appendChild(main);

  // Select first page
  if (pagesData.length > 0) {
    selectPage(pagesData[0].id);
  }
}

function buildSidebar(pages) {
  const sidebar = document.createElement('nav');
  sidebar.className = 'db-sidebar';

  // Header
  const header = document.createElement('div');
  header.className = 'db-sidebar-header';
  header.innerHTML = '<span class="logo">⚡</span> PraisonAIUI';
  sidebar.appendChild(header);

  // Group pages
  const groups = {};
  pages.forEach(p => {
    const g = p.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  // Render groups
  for (const [groupName, groupPages] of Object.entries(groups)) {
    const label = document.createElement('div');
    label.className = 'db-group-label';
    label.textContent = groupName;
    sidebar.appendChild(label);

    groupPages.forEach(page => {
      const item = document.createElement('div');
      item.className = 'db-nav-item';
      item.dataset.navId = page.id;
      item.innerHTML = `<span class="db-nav-icon">${page.icon || '📄'}</span> ${page.title}`;
      item.addEventListener('click', () => selectPage(page.id));
      sidebar.appendChild(item);
    });
  }

  // Test All button at bottom
  const spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1';
  sidebar.appendChild(spacer);

  const testBtn = document.createElement('div');
  testBtn.className = 'db-nav-item';
  testBtn.innerHTML = '<span class="db-nav-icon">🔍</span> Feature Inspector';
  testBtn.addEventListener('click', () => showTestPanel());
  testBtn.style.borderTop = '1px solid var(--db-border)';
  testBtn.style.marginTop = '8px';
  sidebar.appendChild(testBtn);

  return sidebar;
}

async function selectPage(pageId) {
  // Cleanup previous view if it has a cleanup function
  if (_activeCleanup) { try { _activeCleanup(); } catch(e) {} _activeCleanup = null; }

  activePageId = pageId;

  // Update nav active state
  document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`[data-nav-id="${pageId}"]`);
  if (active) active.classList.add('active');

  const page = pagesData.find(p => p.id === pageId);
  const main = document.getElementById('db-main-content');
  if (!main || !page) return;

  // Set page header
  main.innerHTML = `
    <div class="db-page-header">
      <h1 class="db-page-title">${page.icon || ''} ${page.title}</h1>
      ${page.description ? `<p class="db-page-desc">${page.description}</p>` : ''}
    </div>
    <div data-page="${pageId}" id="db-page-content"></div>
  `;

  const container = document.querySelector(`[data-page="${pageId}"]`);
  if (!container) return;

  // ── View Resolution (protocol-first, extensible) ──────────────
  // 1. Check custom registered views first (highest priority)
  // 2. Try dynamic import from built-in view map
  // 3. Fall back to generic JSON viewer
  let rendered = false;

  // Priority 1: Custom registered view
  if (VIEW_REGISTRY[pageId]) {
    try {
      await VIEW_REGISTRY[pageId].render(container);
      _activeCleanup = VIEW_REGISTRY[pageId].cleanup || null;
      rendered = true;
    } catch (e) { console.warn(`View '${pageId}' render error:`, e); }
  }

  // Priority 2: Built-in view module (dynamic import)
  if (!rendered && BUILTIN_VIEWS[pageId]) {
    try {
      const mod = await import(BUILTIN_VIEWS[pageId]);
      if (mod.render) {
        await mod.render(container);
        _activeCleanup = mod.cleanup || null;
        rendered = true;
        // Cache for future use
        VIEW_REGISTRY[pageId] = { render: mod.render, cleanup: mod.cleanup || null };
      }
    } catch (e) { console.warn(`Built-in view '${pageId}' import error:`, e); }
  }

  // Priority 3: Generic JSON viewer fallback
  if (!rendered) {
    loadGenericViewer(page, container);
  }

  // Dispatch event so other plugins can react
  window.dispatchEvent(new CustomEvent('aiui:page-change', { detail: { pageId, page } }));
}

async function loadGenericViewer(page, container) {
  const endpoint = page.api_endpoint || `/api/pages/${page.id}/data`;
  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    renderComponents(data, container);
  } catch (e) {
    container.innerHTML = `<div class="db-viewer"><pre>No data available for ${page.title}.</pre></div>`;
  }
}

/**
 * Render component data — supports both raw JSON and structured components.
 * Structured format: { _components: [ { type: "card", ... }, { type: "columns", ... } ] }
 */
function renderComponents(data, container) {
  if (data && data._components) {
    // Structured component rendering
    container.innerHTML = '';
    data._components.forEach(comp => {
      container.appendChild(renderComponent(comp));
    });
  } else {
    // Raw JSON viewer
    container.innerHTML = `<div class="db-viewer"><pre>${JSON.stringify(data, null, 2)}</pre></div>`;
  }
}

function renderComponent(comp) {
  switch (comp.type) {
    case 'card': return renderCard(comp);
    case 'columns': return renderColumns(comp);
    case 'chart': return renderChart(comp);
    case 'table': return renderTable(comp);
    case 'text': return renderText(comp);
    default: {
      const div = document.createElement('div');
      div.className = 'db-viewer';
      div.innerHTML = `<pre>${JSON.stringify(comp, null, 2)}</pre>`;
      return div;
    }
  }
}

function renderCard(comp) {
  const card = document.createElement('div');
  card.className = 'db-card';
  let html = '';
  if (comp.title) html += `<div class="db-card-title">${comp.title}</div>`;
  if (comp.value !== undefined) html += `<div class="db-card-value">${comp.value}</div>`;
  if (comp.footer) html += `<div class="db-card-footer">${comp.footer}</div>`;
  card.innerHTML = html;
  return card;
}

function renderColumns(comp) {
  const grid = document.createElement('div');
  grid.className = 'db-columns';
  const cols = comp.children || comp.columns || [];
  grid.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
  cols.forEach(child => grid.appendChild(renderComponent(child)));
  return grid;
}

function renderChart(comp) {
  // Simplified chart — renders as a card with data info
  const card = document.createElement('div');
  card.className = 'db-card';
  card.innerHTML = `
    <div class="db-card-title">${comp.title || 'Chart'}</div>
    <div style="color:var(--db-text-dim);font-size:13px;">
      📊 ${(comp.data || []).length} data points
    </div>
  `;
  return card;
}

function renderTable(comp) {
  const wrapper = document.createElement('div');
  wrapper.className = 'db-viewer';
  const headers = comp.headers || [];
  const rows = comp.rows || [];
  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  if (headers.length) {
    html += '<tr>' + headers.map(h => `<th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase;">${h}</th>`).join('') + '</tr>';
  }
  rows.forEach(row => {
    html += '<tr>' + row.map(cell => `<td style="padding:8px 12px;border-bottom:1px solid var(--db-border);">${cell}</td>`).join('') + '</tr>';
  });
  html += '</table>';
  wrapper.innerHTML = html;
  return wrapper;
}

function renderText(comp) {
  const div = document.createElement('div');
  div.style.cssText = 'font-size:14px;line-height:1.7;color:var(--db-text-dim);margin-bottom:16px;';
  div.textContent = comp.content || '';
  return div;
}

// ── Test All Features panel ────────────────────────────────

async function showTestPanel() {
  activePageId = '__test__';
  document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));
  const main = document.getElementById('db-main-content');
  if (!main) return;

  main.innerHTML = `
    <div class="db-page-header">
      <h1 class="db-page-title">🔍 Feature Inspector</h1>
      <p class="db-page-desc">Interactive data flow debugger — click a feature to inspect its API endpoints and see raw request/response data.</p>
    </div>
    <div id="fi-container">
      <div class="db-loading"><div class="db-spinner"></div></div>
    </div>
    <!-- Debug Modal -->
    <div id="fi-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;align-items:center;justify-content:center;backdrop-filter:blur(4px)"></div>
  `;

  try {
    const res = await fetch('/api/features');
    const data = await res.json();
    const features = data.features || [];
    const container = document.getElementById('fi-container');

    if (features.length === 0) {
      container.innerHTML = '<div class="db-viewer"><pre>No features registered.</pre></div>';
      return;
    }

    // Summary bar
    const healthy = features.filter(f => f.health?.status === 'ok').length;
    container.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Features</div><div class="db-card-value">${features.length}</div></div>
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Healthy</div><div class="db-card-value" style="color:#22c55e">${healthy}</div></div>
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Failing</div><div class="db-card-value" style="color:${features.length - healthy > 0 ? '#ef4444' : '#22c55e'}">${features.length - healthy}</div></div>
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Total Routes</div><div class="db-card-value">${features.reduce((s, f) => s + (f.routes?.length || 0), 0)}</div></div>
      </div>
      <div id="fi-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px"></div>
      <div id="fi-detail" style="display:none;margin-top:20px"></div>
    `;

    const grid = document.getElementById('fi-grid');
    for (const feature of features) {
      const routes = feature.routes || [];
      const ok = feature.health?.status === 'ok';
      const card = document.createElement('div');
      card.className = 'db-card';
      card.style.cssText = 'padding:16px 20px;cursor:pointer;transition:border-color 0.2s,box-shadow 0.2s';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div style="font-weight:600;font-size:14px">${feature.name}</div>
          <span style="font-size:11px;padding:3px 10px;border-radius:12px;${ok ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${ok ? '● healthy' : '○ error'}</span>
        </div>
        <div style="font-size:12px;color:var(--db-text-dim);margin-bottom:10px">${feature.description || ''}</div>
        <div style="display:flex;gap:16px;font-size:11px;color:var(--db-text-dim)">
          <span>📡 ${routes.length} route${routes.length !== 1 ? 's' : ''}</span>
          ${feature.health?.total_agents !== undefined ? `<span>🤖 ${feature.health.total_agents} agents</span>` : ''}
          ${feature.health?.total_jobs !== undefined ? `<span>📋 ${feature.health.total_jobs} jobs</span>` : ''}
          ${feature.health?.total_requests !== undefined ? `<span>📊 ${feature.health.total_requests} reqs</span>` : ''}
        </div>
      `;
      card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--db-accent)');
      card.addEventListener('mouseleave', () => card.style.borderColor = '');
      card.addEventListener('click', () => showFeatureDetail(feature));
      grid.appendChild(card);
    }
  } catch (e) {
    document.getElementById('fi-container').innerHTML =
      '<div class="db-viewer"><pre>Failed to load features: ' + e.message + '</pre></div>';
  }
}

async function showFeatureDetail(feature) {
  const detail = document.getElementById('fi-detail');
  const grid = document.getElementById('fi-grid');
  grid.style.display = 'none';
  detail.style.display = 'block';

  const routes = feature.routes || [];
  const ok = feature.health?.status === 'ok';

  detail.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button id="fi-back" style="background:transparent;border:1px solid var(--db-border);color:var(--db-text);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px">← Back</button>
      <h2 style="margin:0;font-size:20px;font-weight:600">${feature.name}</h2>
      <span style="font-size:11px;padding:3px 10px;border-radius:12px;${ok ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${ok ? '● healthy' : '○ error'}</span>
    </div>
    <p style="font-size:13px;color:var(--db-text-dim);margin:0 0 12px">${feature.description || ''}</p>

    <!-- Health Data -->
    <div class="db-card" style="padding:14px 18px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="db-card-title" style="margin:0">Health Status</div>
        <button class="fi-info-btn" data-json='${JSON.stringify(feature.health || {}).replace(/'/g, "&#39;")}' style="background:transparent;border:1px solid var(--db-border);color:var(--db-accent);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px" title="View raw health JSON">ℹ️ Raw</button>
      </div>
      <pre style="font-size:12px;color:var(--db-text-dim);margin:0;white-space:pre-wrap;max-height:100px;overflow-y:auto">${JSON.stringify(feature.health, null, 2)}</pre>
    </div>

    <!-- Data Flow Diagram -->
    <div class="db-card" style="padding:16px 20px;margin-bottom:20px">
      <div class="db-card-title">Data Flow</div>
      <div style="display:flex;align-items:center;gap:0;margin-top:12px;flex-wrap:wrap">
        <div style="text-align:center;padding:10px 16px;background:rgba(99,102,241,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#818cf8">🖥️ Frontend<br><span style="font-size:10px;opacity:0.7">dashboard.js</span></div>
        <div style="font-size:18px;color:var(--db-text-dim);padding:0 8px">→</div>
        <div style="text-align:center;padding:10px 16px;background:rgba(34,197,94,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#22c55e">📡 API<br><span style="font-size:10px;opacity:0.7">/api/features</span></div>
        <div style="font-size:18px;color:var(--db-text-dim);padding:0 8px">→</div>
        <div style="text-align:center;padding:10px 16px;background:rgba(251,146,60,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#fb923c">⚙️ Backend<br><span style="font-size:10px;opacity:0.7">${feature.name}.py</span></div>
        <div style="font-size:18px;color:var(--db-text-dim);padding:0 8px">→</div>
        <div style="text-align:center;padding:10px 16px;background:rgba(168,85,247,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#a855f7">📦 Response<br><span style="font-size:10px;opacity:0.7">JSON</span></div>
      </div>
    </div>

    <!-- Endpoints -->
    <h3 style="font-size:15px;margin:0 0 12px;font-weight:600">Endpoints (${routes.length})</h3>
    <div style="font-size:11px;color:var(--db-text-dim);margin-bottom:12px">Click ▶ to test an endpoint live. Click ℹ️ to see raw request/response JSON.</div>
    <div id="fi-endpoints"></div>
  `;

  // Back button
  detail.querySelector('#fi-back').addEventListener('click', () => {
    detail.style.display = 'none';
    grid.style.display = 'grid';
  });

  // Info button for health
  detail.querySelectorAll('.fi-info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDebugModal('Health Status', {}, JSON.parse(btn.dataset.json.replace(/&#39;/g, "'")));
    });
  });

  // Render endpoints
  const endpointsEl = detail.querySelector('#fi-endpoints');
  if (routes.length === 0) {
    endpointsEl.innerHTML = '<div style="font-size:13px;color:var(--db-text-dim)">No routes registered for this feature.</div>';
    return;
  }

  routes.forEach((route, i) => {
    const hasParam = route.includes('{');
    const row = document.createElement('div');
    row.className = 'db-card';
    row.style.cssText = 'padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <code style="font-size:13px;font-weight:500;color:var(--db-text)">${route}</code>
        ${hasParam ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(251,146,60,0.15);color:#fb923c">param</span>' : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span id="fi-status-${i}" style="font-size:11px;color:var(--db-text-dim)"></span>
        <span id="fi-time-${i}" style="font-size:10px;color:var(--db-text-dim)"></span>
        ${!hasParam ? `<button class="fi-test-btn" data-route="${route}" data-idx="${i}" style="background:transparent;border:1px solid var(--db-border);color:#22c55e;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px" title="Test this endpoint">▶</button>` : ''}
        <button class="fi-debug-btn" data-route="${route}" data-idx="${i}" style="background:transparent;border:1px solid var(--db-border);color:var(--db-accent);padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px" title="Debug: view raw data">ℹ️</button>
      </div>
    `;
    endpointsEl.appendChild(row);
  });

  // Wire test buttons
  endpointsEl.querySelectorAll('.fi-test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const route = btn.dataset.route;
      const idx = btn.dataset.idx;
      const statusEl = detail.querySelector(`#fi-status-${idx}`);
      const timeEl = detail.querySelector(`#fi-time-${idx}`);
      statusEl.textContent = '⏳';
      statusEl.style.color = 'var(--db-text-dim)';
      const start = performance.now();
      try {
        const res = await fetch(route);
        const ms = Math.round(performance.now() - start);
        timeEl.textContent = `${ms}ms`;
        if (res.ok) {
          statusEl.textContent = `✓ ${res.status}`;
          statusEl.style.color = '#22c55e';
        } else if (res.status === 401 || res.status === 405) {
          statusEl.textContent = `✓ ${res.status}`;
          statusEl.style.color = '#fb923c';
        } else {
          statusEl.textContent = `✗ ${res.status}`;
          statusEl.style.color = '#ef4444';
        }
        // Store response for debug
        try { btn._lastResponse = await res.clone().json(); } catch(e) { btn._lastResponse = await res.clone().text(); }
        btn._lastStatus = res.status;
        btn._lastMs = ms;
      } catch(err) {
        statusEl.textContent = '✗ error';
        statusEl.style.color = '#ef4444';
        btn._lastResponse = { error: err.message };
        btn._lastStatus = 0;
      }
    });
  });

  // Wire debug buttons
  endpointsEl.querySelectorAll('.fi-debug-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const route = btn.dataset.route;
      const idx = btn.dataset.idx;
      const hasParam = route.includes('{');

      if (hasParam) {
        showDebugModal(`${route}`, { method: 'GET', note: 'Route has path parameters — provide an ID to test' }, { info: 'This route requires path parameters. Test it manually or via curl.' });
        return;
      }

      // Fetch live data
      const statusEl = detail.querySelector(`#fi-status-${idx}`);
      const timeEl = detail.querySelector(`#fi-time-${idx}`);
      statusEl.textContent = '⏳';
      const start = performance.now();
      try {
        const res = await fetch(route);
        const ms = Math.round(performance.now() - start);
        timeEl.textContent = `${ms}ms`;
        let body;
        try { body = await res.json(); } catch(e) { body = await res.text(); }
        statusEl.textContent = res.ok ? `✓ ${res.status}` : `${res.status}`;
        statusEl.style.color = res.ok ? '#22c55e' : (res.status === 401 || res.status === 405 ? '#fb923c' : '#ef4444');
        showDebugModal(route, { method: 'GET', url: route, headers: { accept: 'application/json' } }, body, res.status, ms);
      } catch(err) {
        statusEl.textContent = '✗ error';
        statusEl.style.color = '#ef4444';
        showDebugModal(route, { method: 'GET', url: route }, { error: err.message }, 0, 0);
      }
    });
  });
}

function showDebugModal(title, request, response, status, ms) {
  const modal = document.getElementById('fi-modal');
  modal.style.display = 'flex';

  const statusColor = status >= 200 && status < 300 ? '#22c55e' : (status === 401 || status === 405 ? '#fb923c' : '#ef4444');
  const responseStr = typeof response === 'string' ? response : JSON.stringify(response, null, 2);
  const requestStr = typeof request === 'string' ? request : JSON.stringify(request, null, 2);

  modal.innerHTML = `
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:14px;padding:24px;width:680px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:600">ℹ️ Debug Inspector</h3>
          <code style="font-size:12px;color:var(--db-text-dim)">${title}</code>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${status ? `<span style="font-size:12px;padding:3px 10px;border-radius:6px;background:${statusColor}22;color:${statusColor};font-weight:600">${status}</span>` : ''}
          ${ms ? `<span style="font-size:11px;color:var(--db-text-dim)">${ms}ms</span>` : ''}
          <button id="fi-modal-close" style="background:transparent;border:none;color:var(--db-text-dim);font-size:18px;cursor:pointer;padding:4px 8px">✕</button>
        </div>
      </div>

      <div style="flex:1;overflow-y:auto">
        <!-- Flow Diagram -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;flex-wrap:wrap;font-size:11px">
          <span style="padding:4px 10px;background:rgba(99,102,241,0.15);color:#818cf8;border-radius:6px">🖥️ Browser</span>
          <span style="color:var(--db-text-dim)">→ fetch("${title}")</span>
          <span style="color:var(--db-text-dim)">→</span>
          <span style="padding:4px 10px;background:rgba(34,197,94,0.15);color:#22c55e;border-radius:6px">📡 Starlette</span>
          <span style="color:var(--db-text-dim)">→</span>
          <span style="padding:4px 10px;background:rgba(251,146,60,0.15);color:#fb923c;border-radius:6px">⚙️ Handler</span>
          <span style="color:var(--db-text-dim)">→</span>
          <span style="padding:4px 10px;background:${statusColor}22;color:${statusColor};border-radius:6px">${status ? status : '?'}</span>
        </div>

        <!-- Request -->
        <div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--db-text-dim);margin-bottom:6px">Request</div>
          <pre style="background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;padding:12px;font-size:12px;color:var(--db-text);margin:0;white-space:pre-wrap;overflow-x:auto;max-height:120px">${requestStr}</pre>
        </div>

        <!-- Response -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--db-text-dim)">Response</div>
            <button id="fi-copy" style="font-size:10px;padding:2px 8px;background:transparent;border:1px solid var(--db-border);color:var(--db-text-dim);border-radius:4px;cursor:pointer">📋 Copy</button>
          </div>
          <pre id="fi-response-pre" style="background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;padding:12px;font-size:12px;color:var(--db-text);margin:0;white-space:pre-wrap;overflow-x:auto;max-height:350px;overflow-y:auto">${responseStr}</pre>
        </div>
      </div>
    </div>
  `;

  modal.querySelector('#fi-modal-close').addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  modal.querySelector('#fi-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(responseStr).then(() => {
      const btn = modal.querySelector('#fi-copy');
      btn.textContent = '✓ Copied';
      setTimeout(() => btn.textContent = '📋 Copy', 1500);
    });
  });
}

function onContentChange(root) {
  // If dashboard is active and page container exists, re-check for plugins
  if (activePageId && activePageId !== '__test__') {
    const container = root.querySelector(`[data-page="${activePageId}"]`);
    if (container && container.children.length === 0) {
      const page = pagesData.find(p => p.id === activePageId);
      if (page) loadGenericViewer(page, container);
    }
  }
}

export { init, onContentChange };
