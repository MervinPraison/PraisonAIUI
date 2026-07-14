/**
 * Marketplace View — browse, inspect, install, and uninstall plugins.
 * API: /api/marketplace/plugins, /api/marketplace/search,
 *      /api/marketplace/install, /api/marketplace/uninstall,
 *      /api/marketplace/plugins/{id}
 */
import { helpBanner, pageToolbar, filterChips, searchInput } from './_helpers.js';
import { showToast, showConfirm } from '../toast.js';

const CATEGORY_ICONS = { tools: '🔧', memory: '🧠', all: '📦' };

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function catIcon(cat) {
  return CATEGORY_ICONS[cat] || '🧩';
}

function permissionsFor(plugin) {
  if (Array.isArray(plugin.permissions) && plugin.permissions.length) return plugin.permissions;
  const map = {
    web_search: ['network:outbound'],
    code_executor: ['process:spawn', 'filesystem:temp'],
    file_manager: ['filesystem:read', 'filesystem:write'],
    memory_plugin: ['filesystem:read', 'filesystem:write', 'network:outbound'],
  };
  return map[plugin.id] || [];
}

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let plugins = [];
  try {
    const r = await fetch('/api/marketplace/plugins');
    const d = await r.json();
    plugins = d.plugins || [];
  } catch (e) {
    container.innerHTML = '<div class="db-viewer"><pre>Failed to load marketplace: ' + e.message + '</pre></div>';
    return;
  }

  const state = { query: '', category: 'all', tab: 'browse' };

  const categories = ['all', ...Array.from(new Set(plugins.map((p) => p.category).filter(Boolean)))];

  function dedupe(list) {
    const seen = new Map();
    list.forEach((p) => { seen.set(p.id, { ...seen.get(p.id), ...p }); });
    return Array.from(seen.values());
  }

  function filtered() {
    const all = dedupe(plugins);
    return all.filter((p) => {
      if (state.tab === 'installed' && !p.installed) return false;
      if (state.category !== 'all' && p.category !== state.category) return false;
      if (state.query) {
        const q = state.query.toLowerCase();
        return (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
      }
      return true;
    });
  }

  function cardHtml(p) {
    const installed = !!p.installed;
    const id = esc(p.id);
    return `
      <div class="db-card" data-plugin="${id}" style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;cursor:pointer">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:22px">${catIcon(p.category)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600">${esc(p.name || p.id)}</div>
            <div style="font-size:11px;color:var(--db-text-dim)">${esc(p.category || 'plugin')} · v${esc(p.version || '1.0.0')}</div>
          </div>
          ${installed ? '<span style="font-size:10px;font-weight:600;color:#22c55e;padding:2px 8px;border-radius:6px;background:rgba(34,197,94,.12)">Installed</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--db-text-dim);line-height:1.5;min-height:34px">${esc(p.description || '')}</div>
        <div style="display:flex;gap:8px">
          <button type="button" class="mkt-open" data-plugin="${id}" style="flex:1;padding:6px 10px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:7px;cursor:pointer;font-size:12px">Details</button>
          ${installed
            ? `<button type="button" class="mkt-uninstall" data-plugin="${id}" style="flex:1;padding:6px 10px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#f87171;border-radius:7px;cursor:pointer;font-size:12px">Uninstall</button>`
            : `<button type="button" class="mkt-install" data-plugin="${id}" style="flex:1;padding:6px 10px;border:1px solid var(--db-accent);background:var(--db-accent);color:#fff;border-radius:7px;cursor:pointer;font-size:12px">Install</button>`}
        </div>
      </div>`;
  }

  function paint() {
    const list = filtered();
    const installedCount = dedupe(plugins).filter((p) => p.installed).length;
    container.innerHTML = `
      ${helpBanner({
        title: 'Marketplace',
        what: 'Browse agent plugins, review the permissions they request, then install or uninstall them.',
        howToUse: 'Search or filter by category, click <strong>Details</strong> to inspect permissions, then <strong>Install</strong>. Switch to the <strong>Installed</strong> tab to manage your active plugins.',
        tip: 'The <strong>Code Executor</strong> plugin pairs with Code Studio for sandboxed execution.',
        collapsed: true,
      })}
      ${pageToolbar('Plugin Marketplace', `
        <button type="button" class="db-filter-chip mkt-tab" data-tab="browse" style="padding:5px 14px;border:1px solid var(--db-border);background:${state.tab === 'browse' ? 'var(--db-accent)' : 'transparent'};color:${state.tab === 'browse' ? '#fff' : 'var(--db-text)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">Browse</button>
        <button type="button" class="db-filter-chip mkt-tab" data-tab="installed" style="padding:5px 14px;border:1px solid var(--db-border);background:${state.tab === 'installed' ? 'var(--db-accent)' : 'transparent'};color:${state.tab === 'installed' ? '#fff' : 'var(--db-text)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">Installed (${installedCount})</button>
      `)}
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        ${searchInput('Search plugins…', 'mkt-search')}
        <div style="display:flex;gap:6px;flex-wrap:wrap">${filterChips(categories, state.category, 'data-cat')}</div>
      </div>
      <div id="mkt-grid" class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${list.map(cardHtml).join('') || '<div class="db-viewer"><pre>No plugins match your filters</pre></div>'}
      </div>
      <div id="mkt-drawer"></div>`;

    wire();
  }

  function drawerHtml(p) {
    const perms = permissionsFor(p);
    const installed = !!p.installed;
    const id = esc(p.id);
    return `
      <div class="mkt-drawer-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:120;display:flex;justify-content:flex-end">
        <div style="width:min(480px,100%);height:100%;background:var(--db-sidebar-bg);border-left:1px solid var(--db-border);overflow-y:auto;padding:24px;box-sizing:border-box">
          <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px">
            <span style="font-size:32px">${catIcon(p.category)}</span>
            <div style="flex:1">
              <div style="font-size:18px;font-weight:700">${esc(p.name || p.id)}</div>
              <div style="font-size:12px;color:var(--db-text-dim)">${esc(p.category || 'plugin')} · v${esc(p.version || '1.0.0')}</div>
            </div>
            <button type="button" class="mkt-close" style="background:transparent;border:none;color:var(--db-text-dim);font-size:22px;cursor:pointer;line-height:1">×</button>
          </div>
          <div style="font-size:13px;line-height:1.6;color:var(--db-text-dim);margin-bottom:20px">${esc(p.description || 'No description provided.')}</div>
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--db-text-dim);margin-bottom:8px">Permissions</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:24px">
            ${perms.length
              ? perms.map((perm) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--db-border);border-radius:8px;font-size:12px"><span>🔐</span><code style="font-size:12px">${esc(perm)}</code></div>`).join('')
              : '<div style="font-size:12px;color:var(--db-text-dim)">No special permissions requested.</div>'}
          </div>
          ${installed
            ? `<button type="button" class="mkt-uninstall" data-plugin="${id}" style="width:100%;padding:11px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#f87171;border-radius:9px;cursor:pointer;font-size:14px;font-weight:600">Uninstall</button>`
            : `<button type="button" class="mkt-install" data-plugin="${id}" style="width:100%;padding:11px;border:1px solid var(--db-accent);background:var(--db-accent);color:#fff;border-radius:9px;cursor:pointer;font-size:14px;font-weight:600">Install ${perms.length ? '(' + perms.length + ' permissions)' : ''}</button>`}
        </div>
      </div>`;
  }

  function openDrawer(id) {
    const p = dedupe(plugins).find((x) => x.id === id);
    if (!p) return;
    const drawer = container.querySelector('#mkt-drawer');
    drawer.innerHTML = drawerHtml(p);
    drawer.querySelector('.mkt-close').addEventListener('click', () => { drawer.innerHTML = ''; });
    drawer.querySelector('.mkt-drawer-overlay').addEventListener('click', (e) => {
      if (e.target.classList.contains('mkt-drawer-overlay')) drawer.innerHTML = '';
    });
    wireActions(drawer);
  }

  async function install(id) {
    const p = dedupe(plugins).find((x) => x.id === id);
    const perms = p ? permissionsFor(p) : [];
    const ok = await showConfirm(
      `Install ${p ? p.name || id : id}?`,
      perms.length ? 'This plugin requests: ' + perms.join(', ') : 'This plugin requests no special permissions.'
    );
    if (!ok) return;
    try {
      const r = await fetch('/api/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin_id: id }),
      });
      const d = await r.json();
      if (!r.ok || d.status !== 'installed') throw new Error(d.error || `HTTP ${r.status}`);
      plugins = plugins.map((x) => (x.id === id ? { ...x, installed: true } : x));
      showToast(`Installed ${id}`, 'success');
      paint();
    } catch (e) {
      showToast('Install failed: ' + e.message, 'error');
    }
  }

  async function uninstall(id) {
    const ok = await showConfirm(`Uninstall ${id}?`, 'This will remove the plugin from your installed set.');
    if (!ok) return;
    try {
      const r = await fetch('/api/marketplace/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin_id: id }),
      });
      const d = await r.json();
      if (!r.ok || d.status !== 'uninstalled') throw new Error(d.error || `HTTP ${r.status}`);
      plugins = plugins.map((x) => (x.id === id ? { ...x, installed: false } : x));
      showToast(`Uninstalled ${id}`, 'success');
      paint();
    } catch (e) {
      showToast('Uninstall failed: ' + e.message, 'error');
    }
  }

  function wireActions(root) {
    root.querySelectorAll('.mkt-install').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); install(b.dataset.plugin); })
    );
    root.querySelectorAll('.mkt-uninstall').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); uninstall(b.dataset.plugin); })
    );
  }

  function wire() {
    const search = container.querySelector('#mkt-search');
    if (search) {
      search.value = state.query;
      search.addEventListener('input', () => {
        state.query = search.value;
        const grid = container.querySelector('#mkt-grid');
        grid.innerHTML = filtered().map(cardHtml).join('') || '<div class="db-viewer"><pre>No plugins match your filters</pre></div>';
        wireActions(grid);
        grid.querySelectorAll('.mkt-open').forEach((b) =>
          b.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(b.dataset.plugin); })
        );
      });
    }
    container.querySelectorAll('.mkt-tab').forEach((b) =>
      b.addEventListener('click', () => { state.tab = b.dataset.tab; paint(); })
    );
    container.querySelectorAll('.db-filter-chip[data-cat]').forEach((b) =>
      b.addEventListener('click', () => { state.category = b.dataset.cat; paint(); })
    );
    container.querySelectorAll('.mkt-open').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(b.dataset.plugin); })
    );
    container.querySelectorAll('.db-card[data-plugin]').forEach((c) =>
      c.addEventListener('click', () => openDrawer(c.dataset.plugin))
    );
    wireActions(container);
  }

  paint();
}
