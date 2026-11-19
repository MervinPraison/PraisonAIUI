/**
 * MCP Manager View — list, connect, and disconnect Model Context Protocol servers.
 * API: GET /api/mcp/servers, POST /api/mcp/connect, POST /api/mcp/disconnect/{name}
 */
import { showToast, showConfirm } from '../toast.js';
import { inAppShell, glyph, statusChip, humanize, emptyState, shellButton, esc } from '/plugins/views/_helpers.js';

const STATUS_STYLE = {
  connected: 'background:rgba(34,197,94,0.15);color:#22c55e',
  connecting: 'background:rgba(234,179,8,0.15);color:#eab308',
  error: 'background:rgba(239,68,68,0.15);color:#ef4444',
  disconnected: 'background:rgba(113,113,122,0.2);color:var(--db-text-dim)',
};

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let servers = [];
  let loadError = null;
  try {
    const r = await fetch('/api/mcp/servers');
    const d = await r.json();
    servers = d.servers || [];
    if (d.error) loadError = d.error;
  } catch (e) {
    loadError = e.message;
  }

  const connected = servers.filter((s) => s.status === 'connected').length;
  const totalTools = servers.reduce((n, s) => n + ((s.tools && s.tools.length) || 0), 0);
  // Shell: auto-fit stats, no health % without servers, chips, the designed empty state.
  const shell = inAppShell();
  const toneOf = { connected: 'success', connecting: 'warning', error: 'danger' };

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:${shell ? 'repeat(auto-fit,minmax(160px,1fr))' : 'repeat(3,1fr)'};margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Servers</div><div class="db-card-value">${servers.length}</div><div class="db-card-footer">${connected} connected</div></div>
      <div class="db-card"><div class="db-card-title">Tools</div><div class="db-card-value">${totalTools}</div></div>
      <div class="db-card"><div class="db-card-title">Health</div><div class="db-card-value">${shell && !servers.length ? '—' : `${servers.length ? Math.round((connected / servers.length) * 100) : 0}%`}</div>${shell && !servers.length ? '<div class="db-card-footer">No servers yet</div>' : ''}</div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="margin:0;font-size:15px;font-weight:600">${shell ? 'MCP servers' : 'MCP Servers'}</h3>
      <button id="mcp-add" class="db-btn db-btn-primary">${shell ? '+ Connect server' : '+ Connect Server'}</button>
    </div>
    ${loadError ? `<div class="db-alert db-alert-warning"><span>${glyph('⚠️', 'info')}</span><span>${esc(loadError)}</span></div>` : ''}
    <div id="mcp-list"></div>
    <div id="mcp-form-host"></div>
  `;

  const list = container.querySelector('#mcp-list');
  servers.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'db-card';
    card.style.cssText = 'margin-bottom:10px;padding:16px 20px';
    const isConnected = s.status === 'connected';
    const statusStyle = STATUS_STYLE[s.status] || STATUS_STYLE.disconnected;
    const tools = s.tools || [];
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <span style="font-size:20px">${glyph('🔌', 'plug')}</span>
          <div style="min-width:0">
            <div style="font-weight:500;font-size:14px">${esc(s.name)}</div>
            <div style="font-size:12px;color:var(--db-text-dim)">${esc(s.transport || '')} · ${tools.length} tool${tools.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${shell ? statusChip(humanize(s.status || 'unknown'), toneOf[s.status] || 'neutral') : `<span style="font-size:11px;padding:3px 10px;border-radius:12px;${statusStyle}">${esc(s.status || 'unknown')}</span>`}
          ${isConnected ? `<button class="mcp-disconnect db-btn db-btn-destructive" data-name="${esc(s.name)}" style="padding:4px 12px;font-size:11px">Disconnect</button>` : ''}
        </div>
      </div>
      ${s.last_error ? `<div style="font-size:12px;color:${shell ? 'var(--db-error)' : '#ef4444'};margin-top:8px">${esc(s.last_error)}</div>` : ''}
      ${tools.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--db-text-dim)">Tools (${tools.length})</summary><div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${tools
        .map(
          (t) =>
            `<div style="font-size:12px"><code style="color:var(--db-text)">${esc(t.name)}</code>${t.description ? ` <span style="color:var(--db-text-dim)">— ${esc(t.description)}</span>` : ''}</div>`
        )
        .join('')}</div></details>` : ''}
    `;
    list.appendChild(card);
  });
  if (servers.length === 0 && !loadError && shell) {
    list.innerHTML = emptyState({ iconName: 'plug', title: 'No MCP servers yet', body: 'Connect a Model Context Protocol server to give your agents its tools.', actionHtml: shellButton('Connect server', 'data-mcp-empty-add') });
    list.querySelector('[data-mcp-empty-add]').addEventListener('click', () => container.querySelector('#mcp-add')?.click());
  } else if (servers.length === 0 && !loadError) {
    list.innerHTML = '<div class="db-viewer"><pre>No MCP servers connected. Click "Connect Server" to add one.</pre></div>';
  }

  container.querySelectorAll('.mcp-disconnect').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = b.dataset.name;
      if (!(await showConfirm('Disconnect MCP Server', `Disconnect "${name}"?`))) return;
      try {
        const r = await fetch(`/api/mcp/disconnect/${encodeURIComponent(name)}`, { method: 'POST' });
        const d = await r.json();
        if (r.ok && d.success) {
          showToast(`Disconnected from ${name}`, 'success');
          render(container);
        } else {
          showToast(d.error || 'Disconnect failed', 'error');
        }
      } catch (e) {
        showToast(e.message, 'error');
      }
    })
  );

  const addBtn = container.querySelector('#mcp-add');
  const formHost = container.querySelector('#mcp-form-host');
  addBtn.addEventListener('click', () => openConnectForm(formHost, container));
}

function openConnectForm(host, container) {
  host.innerHTML = `
    <div class="db-card" style="margin-top:16px;padding:20px">
      <h3 style="margin:0 0 16px;font-size:14px;font-weight:600">Connect MCP Server</h3>
      <div class="db-form-group">
        <label class="db-form-label">Name</label>
        <input id="mcp-f-name" class="db-form-input" placeholder="my-server">
      </div>
      <div class="db-form-group">
        <label class="db-form-label">Transport</label>
        <select id="mcp-f-transport" class="db-form-select">
          <option value="streamable-http">Streamable HTTP (url)</option>
          <option value="sse">SSE (url)</option>
          <option value="stdio">stdio (command)</option>
        </select>
      </div>
      <div id="mcp-f-stdio" style="display:none">
        <div class="db-form-group">
          <label class="db-form-label">Command</label>
          <input id="mcp-f-command" class="db-form-input" value="npx" placeholder="npx" required>
        </div>
        <div class="db-form-group">
          <label class="db-form-label">Arguments (space-separated)</label>
          <input id="mcp-f-args" class="db-form-input" value="-y @modelcontextprotocol/server-everything" placeholder="-y @modelcontextprotocol/server-everything">
        </div>
      </div>
      <div id="mcp-f-url">
        <div class="db-form-group">
          <label class="db-form-label">URL</label>
          <input id="mcp-f-urlval" class="db-form-input" placeholder="https://example.com/mcp">
        </div>
      </div>
      <div class="db-button-group" style="margin:0">
        <button id="mcp-f-submit" class="db-btn db-btn-primary">Connect</button>
        <button id="mcp-f-cancel" class="db-btn">Cancel</button>
      </div>
    </div>
  `;

  const transportSel = host.querySelector('#mcp-f-transport');
  const stdioBlock = host.querySelector('#mcp-f-stdio');
  const urlBlock = host.querySelector('#mcp-f-url');
  transportSel.addEventListener('change', () => {
    const isStdio = transportSel.value === 'stdio';
    stdioBlock.style.display = isStdio ? '' : 'none';
    urlBlock.style.display = isStdio ? 'none' : '';
  });

  host.querySelector('#mcp-f-cancel').addEventListener('click', () => {
    host.innerHTML = '';
  });

  host.querySelector('#mcp-f-submit').addEventListener('click', async () => {
    const name = host.querySelector('#mcp-f-name').value.trim();
    if (!name) {
      showToast('Name is required', 'error');
      return;
    }
    const body = { name };
    if (transportSel.value === 'stdio') {
      const command = host.querySelector('#mcp-f-command').value.trim();
      if (!command) {
        showToast('Command is required for stdio', 'error');
        return;
      }
      body.command = command;
      const argsRaw = host.querySelector('#mcp-f-args').value.trim();
      body.args = argsRaw ? argsRaw.split(/\s+/) : [];
    } else {
      const url = host.querySelector('#mcp-f-urlval').value.trim();
      if (!url) {
        showToast('URL is required', 'error');
        return;
      }
      body.url = url;
      if (transportSel.value === 'sse') body.transport = 'sse'; // else: Streamable HTTP, SSE as a fallback
    }

    const submitBtn = host.querySelector('#mcp-f-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connecting…';
    try {
      const r = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d.server && d.server.status === 'connected') {
        showToast(`Connected to ${d.server.name}`, 'success');
        host.innerHTML = '';
        render(container);
      } else {
        showToast((d.server && d.server.last_error) || d.error || d.hint || 'Connection failed', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect';
      }
    } catch (e) {
      showToast(e.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Connect';
    }
  });
}
