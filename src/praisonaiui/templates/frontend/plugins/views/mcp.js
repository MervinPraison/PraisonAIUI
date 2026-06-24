/**
 * MCP Manager View — list, connect, and disconnect Model Context Protocol servers.
 * API: GET /api/mcp/servers, POST /api/mcp/connect, POST /api/mcp/disconnect/{name}
 */
import { showToast, showConfirm } from '../toast.js';

const STATUS_STYLE = {
  connected: 'background:rgba(34,197,94,0.15);color:#22c55e',
  connecting: 'background:rgba(234,179,8,0.15);color:#eab308',
  error: 'background:rgba(239,68,68,0.15);color:#ef4444',
  disconnected: 'background:rgba(113,113,122,0.2);color:var(--db-text-dim)',
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

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

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Servers</div><div class="db-card-value">${servers.length}</div><div class="db-card-footer">${connected} connected</div></div>
      <div class="db-card"><div class="db-card-title">Tools</div><div class="db-card-value">${totalTools}</div></div>
      <div class="db-card"><div class="db-card-title">Health</div><div class="db-card-value">${servers.length ? Math.round((connected / servers.length) * 100) : 0}%</div></div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <h3 style="margin:0;font-size:15px;font-weight:600">MCP Servers</h3>
      <button id="mcp-add" class="db-btn db-btn-primary">+ Connect Server</button>
    </div>
    ${loadError ? `<div class="db-alert db-alert-warning"><span>⚠️</span><span>${esc(loadError)}</span></div>` : ''}
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
          <span style="font-size:20px">🔌</span>
          <div style="min-width:0">
            <div style="font-weight:500;font-size:14px">${esc(s.name)}</div>
            <div style="font-size:12px;color:var(--db-text-dim)">${esc(s.transport || '')} · ${tools.length} tool${tools.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;padding:3px 10px;border-radius:12px;${statusStyle}">${esc(s.status || 'unknown')}</span>
          ${isConnected ? `<button class="mcp-disconnect db-btn db-btn-destructive" data-name="${esc(s.name)}" style="padding:4px 12px;font-size:11px">Disconnect</button>` : ''}
        </div>
      </div>
      ${s.last_error ? `<div style="font-size:12px;color:#ef4444;margin-top:8px">${esc(s.last_error)}</div>` : ''}
      ${tools.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--db-text-dim)">Tools (${tools.length})</summary><div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${tools
        .map(
          (t) =>
            `<div style="font-size:12px"><code style="color:var(--db-text)">${esc(t.name)}</code>${t.description ? ` <span style="color:var(--db-text-dim)">— ${esc(t.description)}</span>` : ''}</div>`
        )
        .join('')}</div></details>` : ''}
    `;
    list.appendChild(card);
  });
  if (servers.length === 0 && !loadError) {
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
          <option value="stdio">stdio (command)</option>
          <option value="sse">SSE / HTTP (url)</option>
        </select>
      </div>
      <div id="mcp-f-stdio">
        <div class="db-form-group">
          <label class="db-form-label">Command</label>
          <input id="mcp-f-command" class="db-form-input" placeholder="npx">
        </div>
        <div class="db-form-group">
          <label class="db-form-label">Arguments (space-separated)</label>
          <input id="mcp-f-args" class="db-form-input" placeholder="-y @modelcontextprotocol/server-filesystem /tmp">
        </div>
      </div>
      <div id="mcp-f-url" style="display:none">
        <div class="db-form-group">
          <label class="db-form-label">URL</label>
          <input id="mcp-f-urlval" class="db-form-input" placeholder="https://example.com/sse">
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
      if (r.ok && d.server) {
        showToast(`Connected to ${d.server.name}`, 'success');
        host.innerHTML = '';
        render(container);
      } else {
        showToast(d.error || d.hint || 'Connection failed', 'error');
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
