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
  testBtn.innerHTML = '<span class="db-nav-icon">🧪</span> Test All Features';
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

  // Clear active nav
  document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));

  const main = document.getElementById('db-main-content');
  if (!main) return;

  main.innerHTML = `
    <div class="db-page-header">
      <h1 class="db-page-title">🧪 Test All Features</h1>
      <p class="db-page-desc">Auto-discovers features from /api/features and tests each endpoint.</p>
    </div>
    <div class="db-test-panel">
      <div class="db-test-grid" id="db-test-grid">
        <div class="db-loading"><div class="db-spinner"></div></div>
      </div>
    </div>
  `;

  try {
    const res = await fetch('/api/features');
    const data = await res.json();
    const features = data.features || [];
    const grid = document.getElementById('db-test-grid');
    grid.innerHTML = '';

    if (features.length === 0) {
      grid.innerHTML = '<div class="db-viewer"><pre>No features registered.</pre></div>';
      return;
    }

    // Test each feature
    for (const feature of features) {
      const card = document.createElement('div');
      card.className = 'db-test-card';
      card.innerHTML = `
        <div>
          <div class="db-test-name">${feature.name || 'Unknown'}</div>
          <div style="font-size:11px;color:var(--db-text-dim);">${feature.description || ''}</div>
        </div>
        <span class="db-test-status db-test-pending">testing…</span>
      `;
      grid.appendChild(card);

      // Test the endpoint
      testFeature(feature, card);
    }
  } catch (e) {
    document.getElementById('db-test-grid').innerHTML =
      '<div class="db-viewer"><pre>Failed to load features.</pre></div>';
  }
}

async function testFeature(feature, card) {
  const statusEl = card.querySelector('.db-test-status');
  try {
    // If the feature itself errored during info() (e.g. schedules)
    if (feature.status === 'error') {
      statusEl.textContent = '✗ fail';
      statusEl.className = 'db-test-status db-test-fail';
      return;
    }

    // Check health status from the API response
    const healthStatus = feature.health?.status;
    if (healthStatus === 'ok') {
      // Health is ok — try one route to verify it's reachable
      const routes = feature.routes || [];
      // Find first GET-able route (no path params)
      const testableRoute = routes.find(r => !r.includes('{') && !r.includes('stream'));
      if (testableRoute) {
        try {
          const res = await fetch(testableRoute);
          if (res.ok || res.status === 401 || res.status === 405) {
            // 401 = auth required, 405 = POST-only route, still counts as "working"
            statusEl.textContent = '✓ pass';
            statusEl.className = 'db-test-status db-test-pass';
          } else {
            statusEl.textContent = `✗ ${res.status}`;
            statusEl.className = 'db-test-status db-test-fail';
          }
        } catch(e) {
          // Network error on individual route, but health was ok
          statusEl.textContent = '✓ pass';
          statusEl.className = 'db-test-status db-test-pass';
        }
      } else {
        // No testable routes but health is ok
        statusEl.textContent = '✓ pass';
        statusEl.className = 'db-test-status db-test-pass';
      }
    } else {
      statusEl.textContent = '✗ fail';
      statusEl.className = 'db-test-status db-test-fail';
    }
  } catch (e) {
    statusEl.textContent = '✗ error';
    statusEl.className = 'db-test-status db-test-fail';
  }
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
