/**
 * MCP Manager View — Model Context Protocol server management
 * API: /api/mcp/*
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let servers = [];
  try { 
    const r = await fetch('/api/mcp/servers'); 
    const data = await r.json();
    servers = data.servers || []; 
  } catch(e) {
    container.innerHTML = '<div class="db-error">Failed to load MCP servers</div>';
    return;
  }

  const statusColors = {
    connected: '#22c55e',
    connecting: '#eab308',
    error: '#ef4444',
    disconnected: '#6b7280'
  };

  container.innerHTML = `
    <div class="db-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div>
        <h2 style="margin:0;font-size:20px;font-weight:600">MCP Manager</h2>
        <p style="margin:4px 0 0;font-size:13px;color:var(--db-text-dim)">Manage Model Context Protocol server connections</p>
      </div>
      <button id="add-mcp" class="db-btn" style="background:var(--db-primary);color:white">+ Connect Server</button>
    </div>

    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="db-card">
        <div class="db-card-title">Total Servers</div>
        <div class="db-card-value">${servers.length}</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Connected</div>
        <div class="db-card-value" style="color:#22c55e">${servers.filter(s => s.status === 'connected').length}</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Total Tools</div>
        <div class="db-card-value">${servers.reduce((sum, s) => sum + (s.tools?.length || 0), 0)}</div>
      </div>
    </div>

    <div id="mcp-servers">
      ${servers.length === 0 ? '<div class="db-card" style="text-align:center;padding:48px 24px"><p style="color:var(--db-text-dim);margin:0 0 16px">No MCP servers configured</p><button id="add-first" class="db-btn" style="background:var(--db-primary);color:white">Connect Your First Server</button></div>' : ''}
    </div>

    <div id="mcp-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999">
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--db-card-bg);border-radius:12px;padding:24px;max-width:500px;width:90%">
        <h3 style="margin:0 0 20px;font-size:18px">Connect MCP Server</h3>
        <form id="mcp-form">
          <div style="margin-bottom:16px">
            <label style="display:block;font-size:13px;margin-bottom:6px">Server Name</label>
            <input name="name" required style="width:100%;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-bg);color:var(--db-text)" placeholder="my-mcp-server">
          </div>
          <div style="margin-bottom:16px">
            <label style="display:block;font-size:13px;margin-bottom:6px">Transport Type</label>
            <select name="transport" id="transport-select" style="width:100%;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-bg);color:var(--db-text)">
              <option value="stdio">STDIO (Subprocess)</option>
              <option value="sse">SSE (Server-Sent Events)</option>
              <option value="http">HTTP (REST API)</option>
            </select>
          </div>
          <div id="stdio-fields">
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;margin-bottom:6px">Command</label>
              <input name="command" style="width:100%;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-bg);color:var(--db-text)" placeholder="npx">
            </div>
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;margin-bottom:6px">Arguments (space-separated)</label>
              <input name="args" style="width:100%;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-bg);color:var(--db-text)" placeholder="-y @modelcontextprotocol/server-filesystem">
            </div>
          </div>
          <div id="url-fields" style="display:none">
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;margin-bottom:6px">Server URL</label>
              <input name="url" style="width:100%;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-bg);color:var(--db-text)" placeholder="http://localhost:3000/sse">
            </div>
            <div style="margin-bottom:16px">
              <label style="display:block;font-size:13px;margin-bottom:6px">Headers (JSON, optional)</label>
              <input name="headers" style="width:100%;padding:8px 12px;border:1px solid var(--db-border);border-radius:6px;background:var(--db-bg);color:var(--db-text)" placeholder='{"Authorization": "Bearer token"}'>
            </div>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end">
            <button type="button" id="cancel-modal" class="db-btn" style="background:var(--db-card-bg);border:1px solid var(--db-border)">Cancel</button>
            <button type="submit" class="db-btn" style="background:var(--db-primary);color:white">Connect</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Render servers
  const serversEl = container.querySelector('#mcp-servers');
  if (servers.length > 0) {
    servers.forEach(server => {
      const card = document.createElement('div');
      card.className = 'db-card';
      card.style.cssText = 'margin-bottom:16px;padding:20px';
      
      const toolsHtml = server.tools?.length > 0 
        ? server.tools.map(t => `
            <div style="padding:8px 12px;background:var(--db-bg);border-radius:6px;margin-bottom:8px">
              <div style="font-weight:500;font-size:13px">${t.name}</div>
              <div style="font-size:12px;color:var(--db-text-dim);margin-top:2px">${t.description || 'No description'}</div>
            </div>
          `).join('')
        : '<div style="font-size:13px;color:var(--db-text-dim)">No tools available</div>';

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px">
          <div>
            <div style="font-size:16px;font-weight:600;margin-bottom:4px">${server.name}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:${statusColors[server.status]}20;color:${statusColors[server.status]};font-weight:500">${server.status.toUpperCase()}</span>
              <span style="font-size:12px;color:var(--db-text-dim)">${server.transport}</span>
            </div>
            ${server.last_error ? `<div style="color:#ef4444;font-size:12px;margin-top:4px">Error: ${server.last_error}</div>` : ''}
          </div>
          <button class="mcp-disconnect db-btn" data-name="${server.name}" style="padding:6px 12px;font-size:12px;background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2)">Disconnect</button>
        </div>
        <details>
          <summary style="cursor:pointer;font-size:13px;font-weight:500;margin-bottom:8px">Tools (${server.tools?.length || 0})</summary>
          <div style="margin-top:8px">${toolsHtml}</div>
        </details>
      `;
      serversEl.appendChild(card);
    });
  }

  // Modal handling
  const modal = container.querySelector('#mcp-modal');
  const form = container.querySelector('#mcp-form');
  const transportSelect = container.querySelector('#transport-select');
  const stdioFields = container.querySelector('#stdio-fields');
  const urlFields = container.querySelector('#url-fields');

  const showModal = () => modal.style.display = 'block';
  const hideModal = () => {
    modal.style.display = 'none';
    form.reset();
  };

  transportSelect.addEventListener('change', () => {
    if (transportSelect.value === 'stdio') {
      stdioFields.style.display = 'block';
      urlFields.style.display = 'none';
    } else {
      stdioFields.style.display = 'none';
      urlFields.style.display = 'block';
    }
  });

  container.querySelector('#add-mcp')?.addEventListener('click', showModal);
  container.querySelector('#add-first')?.addEventListener('click', showModal);
  container.querySelector('#cancel-modal').addEventListener('click', hideModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const config = { name: formData.get('name') };
    
    if (formData.get('transport') === 'stdio') {
      config.command = formData.get('command');
      const argsStr = formData.get('args');
      if (argsStr) config.args = argsStr.split(' ').filter(Boolean);
    } else {
      config.url = formData.get('url');
      const headersStr = formData.get('headers');
      if (headersStr) {
        try {
          config.headers = JSON.parse(headersStr);
        } catch {
          alert('Invalid JSON for headers');
          return;
        }
      }
    }

    try {
      const res = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (res.ok) {
        hideModal();
        render(container);
      } else {
        const error = await res.text();
        alert(`Failed to connect: ${error}`);
      }
    } catch (err) {
      alert(`Connection error: ${err.message}`);
    }
  });

  container.querySelectorAll('.mcp-disconnect').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Disconnect from ${btn.dataset.name}?`)) return;
      
      try {
        const res = await fetch('/api/mcp/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: btn.dataset.name })
        });
        
        if (res.ok) {
          render(container);
        }
      } catch (err) {
        alert(`Failed to disconnect: ${err.message}`);
      }
    });
  });
}