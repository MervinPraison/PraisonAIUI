#!/usr/bin/env python3
"""Apply modular shell patches to dashboard.js (one-shot)."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/praisonaiui/templates/frontend/plugins/dashboard.js"
text = p.read_text()

# 1) Extend BUILTIN_VIEWS and registries after theme-picker line
old_views = "  'theme-picker': '/plugins/views/theme-picker.js',\n};"
new_views = """  'theme-picker': '/plugins/views/theme-picker.js',
  feedback:       '/plugins/views/feedback.js',
  jobs:           '/plugins/views/jobs.js',
  auth:           '/plugins/views/auth.js',
  api:            '/plugins/views/api.js',
};

const SLOT_REGISTRY = {};
let _dashboardPluginManifests = [];

const aiuiSdk = {
  version: '1',
  async fetchJSON(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
  el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => { if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  },
  themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback || '';
  },
  createBoard(root, opts) {
    let destroyed = false;
    const wrap = document.createElement('motion.div');
    wrap.className = 'aiui-board';
    root.appendChild(wrap);
    async function refresh() {
      if (destroyed || !opts?.fetch) return;
      try {
        const data = await opts.fetch();
        wrap.innerHTML = '';
        if (data?._components) data._components.forEach((c) => wrap.appendChild(renderComponent(c)));
        else if (data?.columns) wrap.appendChild(renderBoard({ type: 'board', columns: data.columns }));
      } catch (e) { wrap.innerHTML = `<div class="db-alert db-alert-error">${e.message}</div>`; }
    }
    refresh();
    const interval = opts?.pollMs ? setInterval(refresh, opts.pollMs) : null;
    return { refresh, destroy() { destroyed = true; if (interval) clearInterval(interval); wrap.remove(); } };
  },
};"""
if old_views not in text:
    raise SystemExit("BUILTIN_VIEWS anchor not found")
text = text.replace(old_views, new_views.replace('motion.div', 'div'))

old_api = """window.aiui.components = COMPONENT_REGISTRY;

// ── Sidebar State"""
new_api = """window.aiui.version = '1';
window.aiui.components = COMPONENT_REGISTRY;
window.aiui.registerSlot = function (name, renderFn) { SLOT_REGISTRY[name] = renderFn; };
window.aiui.slots = SLOT_REGISTRY;
window.aiui.sdk = aiuiSdk;

// ── Sidebar State"""
text = text.replace(old_api, new_api)

# 2) CSS after .db-columns
css_anchor = "  .db-columns { display: grid; gap: 16px; }\n  .db-card {"
css_insert = """  .db-columns { display: grid; gap: 16px; }
  .aiui-board-columns { display: flex; gap: 12px; align-items: start; overflow-x: auto; padding-bottom: 8px; }
  .aiui-board-column { flex: 0 0 280px; display: flex; flex-direction: column; gap: 8px;
    background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: var(--db-radius); padding: 10px; min-height: 120px; }
  .aiui-board-column-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--db-text-dim); margin: 0 0 4px; }
  .aiui-board-column-cards { display: flex; flex-direction: column; gap: 8px; }
  .aiui-board-card .db-card { margin: 0; }
  .db-slot-host { min-height: 0; }
  .db-sidebar-footer { margin-top: auto; padding: 10px 14px; border-top: 1px solid var(--db-border); font-size: 11px; color: var(--db-text-dim); }
  .db-mobile-header { display: none; position: fixed; top: 0; left: 0; right: 0; z-index: 40; min-height: 48px; align-items: center; gap: 8px; padding: 8px 12px; background: var(--db-sidebar-bg); border-bottom: 1px solid var(--db-border); }
  .db-mobile-overlay { display: none; position: fixed; inset: 0; z-index: 35; background: rgba(0,0,0,0.5); }
  @media (max-width: 1023px) {
    .db-mobile-header { display: flex; }
    .db-sidebar { position: fixed; z-index: 45; transform: translateX(-100%); transition: transform 0.2s ease; }
    .db-sidebar.db-sidebar-open { transform: translateX(0); }
    .db-mobile-overlay.db-visible { display: block; }
    .db-main { padding-top: 48px; }
  }
  .db-card {"""
text = text.replace(css_anchor, css_insert)

# 3) Helpers before init
init_anchor = "async function init() {"
helpers = '''
function renderSlot(name, parent) {
  const fn = SLOT_REGISTRY[name];
  if (!fn || !parent) return;
  const host = document.createElement('div');
  host.className = 'db-slot-host';
  host.dataset.slot = name;
  try { const node = fn(); if (node) host.appendChild(node); } catch (e) { console.warn(`[AIUI] Slot '${name}':`, e); }
  parent.appendChild(host);
}

async function loadDashboardPlugins() {
  _dashboardPluginManifests = [];
  try {
    const res = await fetch('/api/dashboard/plugins');
    if (!res.ok) return;
    _dashboardPluginManifests = (await res.json()).plugins || [];
  } catch (e) { console.warn('[AIUI] Dashboard plugins:', e); return; }
  for (const manifest of _dashboardPluginManifests) {
    if (manifest.css) {
      const href = `/dashboard-plugins/${manifest.name}/${manifest.css}`;
      if (!document.querySelector(`link[data-aiui-plugin-css="${manifest.name}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = href; link.dataset.aiuiPluginCss = manifest.name;
        document.head.appendChild(link);
      }
    }
    if (manifest.entry && !document.querySelector(`script[data-aiui-plugin="${manifest.name}"]`)) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = `/dashboard-plugins/${manifest.name}/${manifest.entry}`;
        script.async = true; script.dataset.aiuiPlugin = manifest.name;
        script.onload = script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    }
    if (manifest.page && !pagesData.find((pg) => pg.id === manifest.page.id)) pagesData.push(manifest.page);
  }
}

function setupMobileNav(root, sidebar) {
  if (!sidebar) return;
  let overlay = document.getElementById('db-mobile-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'db-mobile-overlay'; overlay.className = 'db-mobile-overlay';
    overlay.addEventListener('click', () => { sidebar.classList.remove('db-sidebar-open'); overlay.classList.remove('db-visible'); });
    root.insertBefore(overlay, root.firstChild);
  }
  if (!document.getElementById('db-mobile-header')) {
    const header = document.createElement('motion.div');
    header.id = 'db-mobile-header'; header.className = 'db-mobile-header';
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button'; menuBtn.textContent = '☰';
    menuBtn.style.cssText = 'background:transparent;border:1px solid var(--db-border);color:var(--db-text);border-radius:6px;padding:6px 10px;cursor:pointer';
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('db-sidebar-open');
      overlay.classList.toggle('db-visible', sidebar.classList.contains('db-sidebar-open'));
    });
    const title = document.createElement('span'); title.id = 'db-mobile-title'; title.style.fontWeight = '600';
    header.appendChild(menuBtn); header.appendChild(title);
    root.insertBefore(header, overlay.nextSibling);
  }
}

'''
helpers = helpers.replace('motion.div', 'motion.div').replace("createElement('motion.div')", "createElement('motion.div')")
helpers = helpers.replace('motion.div', 'div')
text = text.replace(init_anchor, helpers + init_anchor)

# 4) init awaits buildDashboard
text = text.replace(
    "  // Build the dashboard (after theme is applied)\n  buildDashboard();\n}",
    "  await buildDashboard();\n}",
)

# 5) buildDashboard plugins + mobile
text = text.replace(
    "    dashboardConfig = uiConfig.dashboard || {};\n  } catch (e) {",
    "    dashboardConfig = uiConfig.dashboard || {};\n    window.__aiuiDashboardModules = dashboardConfig.modules || [];\n    await loadDashboardPlugins();\n  } catch (e) {",
)
text = text.replace(
    """  if (showSidebar) {
    const sidebar = buildSidebar(pagesData);
    root.appendChild(sidebar);
  }

  root.appendChild(main);""",
    """  let sidebar = null;
  if (showSidebar) {
    sidebar = buildSidebar(pagesData);
    const slotFooter = document.createElement('div');
    slotFooter.className = 'db-sidebar-footer';
    renderSlot('shell:sidebar:footer', slotFooter);
    if (slotFooter.children.length) sidebar.appendChild(slotFooter);
    root.appendChild(sidebar);
    setupMobileNav(root, sidebar);
  }
  const shellHeader = document.createElement('div');
  shellHeader.id = 'db-shell-header-slot';
  renderSlot('shell:header', shellHeader);
  if (shellHeader.children.length) root.insertBefore(shellHeader, main);
  root.appendChild(main);""",
)

# 6) selectPage toolbar
old_sel = """  const headerHtml = showPageHeader ? `
    <motion.div class="db-page-header">
      <h1 class="db-page-title">${page.icon || ''} ${page.title}</h1>
      ${page.description ? `<p class="db-page-desc">${page.description}</p>` : ''}
    </motion.div>
  ` : '';
  main.innerHTML = `
    ${headerHtml}
    <motion.div data-page="${pageId}" id="db-page-content"></motion.div>
  `;

  const container = document.querySelector(`[data-page="${pageId}"]`);"""
old_sel = old_sel.replace('motion.div', 'div')
new_sel = """  const toolbarSlotId = `page:${pageId}:toolbar`;
  const headerHtml = showPageHeader ? `
    <div class="db-page-header">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h1 class="db-page-title">${page.icon || ''} ${page.title}</h1>
          ${page.description ? `<p class="db-page-desc">${page.description}</p>` : ''}
        </div>
        <div id="db-page-toolbar-slot" class="db-slot-host" data-slot="${toolbarSlotId}"></div>
      </div>
    </div>
  ` : '';
  main.innerHTML = `${headerHtml}<motion.div data-page="${pageId}" id="db-page-content"></motion.div>`;
  if (showPageHeader) {
    const toolbarHost = document.getElementById('db-page-toolbar-slot');
    if (toolbarHost && SLOT_REGISTRY[toolbarSlotId]) {
      try { const node = SLOT_REGISTRY[toolbarSlotId](); if (node) toolbarHost.appendChild(node); } catch (e) {}
    }
  }
  const mobileTitle = document.getElementById('db-mobile-title');
  if (mobileTitle) mobileTitle.textContent = page.title || '';
  const container = document.querySelector(`[data-page="${pageId}"]`);"""
new_sel = new_sel.replace('motion.div', 'div')
if old_sel not in text:
    old_sel2 = """  const headerHtml = showPageHeader ? `
    <div class="db-page-header">
      <h1 class="db-page-title">${page.icon || ''} ${page.title}</h1>
      ${page.description ? `<p class="db-page-desc">${page.description}</p>` : ''}
    </motion.div>
  ` : '';
  main.innerHTML = `
    ${headerHtml}
    <motion.div data-page="${pageId}" id="db-page-content"></motion.div>
  `;

  const container = document.querySelector(`[data-page="${pageId}"]`);""".replace('motion.div','motion.div')
    # use correct version
    old_sel2 = """  const headerHtml = showPageHeader ? `
    <div class="db-page-header">
      <h1 class="db-page-title">${page.icon || ''} ${page.title}</h1>
      ${page.description ? `<p class="db-page-desc">${page.description}</p>` : ''}
    </div>
  ` : '';
  main.innerHTML = `
    ${headerHtml}
    <div data-page="${pageId}" id="db-page-content"></div>
  `;

  const container = document.querySelector(`[data-page="${pageId}"]`);"""
    text = text.replace(old_sel2, new_sel)
else:
    text = text.replace(old_sel, new_sel)

# 7) board case + renderBoard
text = text.replace(
    "    case 'form_action': return renderFormAction(comp);\n    default: {",
    "    case 'form_action': return renderFormAction(comp);\n    case 'board': return renderBoard(comp);\n    default: {",
)
if "function renderBoard" not in text:
    text = text.replace(
        "function renderCard(comp) {",
        '''function renderBoard(comp) {
  const wrap = document.createElement('div');
  wrap.className = 'aiui-board';
  const row = document.createElement('div');
  row.className = 'aiui-board-columns';
  (comp.columns || []).forEach((col) => {
    const colEl = document.createElement('div');
    colEl.className = 'aiui-board-column';
    const title = document.createElement('div');
    title.className = 'aiui-board-column-title';
    title.textContent = col.title || col.id || 'Column';
    colEl.appendChild(title);
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'aiui-board-column-cards';
    (col.cards || []).forEach((cardComp) => {
      const cardWrap = document.createElement('div');
      cardWrap.className = 'aiui-board-card';
      const normalized = cardComp?.type ? cardComp : {
        type: 'card', title: cardComp.title || cardComp.name || 'Card',
        value: cardComp.value, footer: cardComp.footer || cardComp.assignee || cardComp.status,
      };
      cardWrap.appendChild(renderComponent(normalized));
      cardsWrap.appendChild(cardWrap);
    });
    colEl.appendChild(cardsWrap);
    row.appendChild(colEl);
  });
  wrap.appendChild(row);
  return wrap;
}

function renderCard(comp) {''',
    )

# 8) default slot before export
if "registerSlot('shell:sidebar:footer'" not in text:
    text = text.replace(
        "export { init, onContentChange };",
        """window.aiui.registerSlot('shell:sidebar:footer', () => {
  const el = document.createElement('div');
  el.innerHTML = '<span class="db-health-dot" style="color:var(--db-text-dim)">●</span> <span class="db-health-label">Checking…</span>';
  fetch('/api/health').then((r) => r.json()).then((d) => {
    const ok = d && (d.status === 'ok' || d.status === 'healthy');
    const dot = el.querySelector('.db-health-dot');
    const label = el.querySelector('.db-health-label');
    if (dot) dot.style.color = ok ? '#22c55e' : '#ef4444';
    if (label) label.textContent = ok ? 'Connected' : 'Degraded';
  }).catch(() => { const label = el.querySelector('.db-health-label'); if (label) label.textContent = 'Offline'; });
  return el;
});

export { init, onContentChange };""",
    )

p.write_text(text)
print("patched ok", len(text))
