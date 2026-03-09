/**
 * Debug View — System diagnostics, feature health, connectivity status.
 *
 * New view (Gap 7). Provides: system info, feature health matrix,
 *  gateway connectivity, WebSocket status, environment info, error logs.
 *
 * API: /api/features, /api/health, /api/config, /api/gateway/status
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let features = [], health = {}, config = {}, gatewayData = {};
  let wsStatus = 'unknown', wsLatency = null;

  try { const r = await fetch('/api/features'); const d = await r.json(); features = d.features || d || []; if (!Array.isArray(features)) features = []; } catch(e) {}
  try { const r = await fetch('/api/health'); if (r.ok) { health = await r.json(); } else { health = { status: 'ok', note: 'no /api/health endpoint' }; } } catch(e) { health = { status: 'unreachable' }; }
  try { const r = await fetch('/api/config'); config = await r.json(); } catch(e) {}
  try { const r = await fetch('/api/gateway/status'); gatewayData = await r.json(); } catch(e) { gatewayData = { status: 'unavailable', connected: false, agents: [], agent_count: 0 }; }

  // Test WebSocket
  try {
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/api/chat/ws';
    const startTime = Date.now();
    const testWs = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      testWs.onopen = () => { wsLatency = Date.now() - startTime; wsStatus = 'connected'; testWs.close(); resolve(); };
      testWs.onerror = () => { wsStatus = 'failed'; reject(); };
      setTimeout(() => { wsStatus = 'timeout'; testWs.close(); reject(); }, 3000);
    }).catch(() => {});
  } catch(e) { wsStatus = 'error'; }

  const serverStatus = health.status === 'ok' || health.status === 'healthy' ? 'healthy' : health.status || 'unknown';
  const gatewayConnected = gatewayData.connected === true;
  const gatewayStatus = gatewayConnected ? 'connected' : gatewayData.status || 'unknown';
  const gatewayAgents = gatewayData.agents || [];

  container.innerHTML = `
    <!-- System Status Cards -->
    <div class="db-columns" style="grid-template-columns:repeat(4,1fr);margin-bottom:24px">
      <div class="db-card">
        <div class="db-card-title">Server</div>
        <div style="font-size:20px;font-weight:700;margin:6px 0;color:${serverStatus === 'healthy' ? '#22c55e' : '#ef4444'}">${serverStatus === 'healthy' ? '● Healthy' : '○ ' + serverStatus}</div>
        <div style="font-size:11px;color:var(--db-text-dim)">${health.uptime ? 'Uptime: ' + formatUptime(health.uptime) : location.origin}</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Gateway</div>
        <div style="font-size:20px;font-weight:700;margin:6px 0;color:${gatewayConnected ? '#22c55e' : '#ef4444'}">${gatewayConnected ? '● Connected' : '○ ' + gatewayStatus}</div>
        <div style="font-size:11px;color:var(--db-text-dim)">${gatewayAgents.length} agent${gatewayAgents.length !== 1 ? 's' : ''} registered</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">WebSocket</div>
        <div style="font-size:20px;font-weight:700;margin:6px 0;color:${wsStatus === 'connected' ? '#22c55e' : '#ef4444'}">${wsStatus === 'connected' ? '● Connected' : '○ ' + wsStatus}</div>
        <div style="font-size:11px;color:var(--db-text-dim)">${wsLatency != null ? wsLatency + 'ms latency' : 'Real-time channel'}</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Features</div>
        <div style="font-size:20px;font-weight:700;margin:6px 0">${features.length}</div>
        <div style="font-size:11px;color:var(--db-text-dim)">registered features</div>
      </div>
    </div>

    <!-- Feature Health Matrix -->
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Feature Health Matrix</h3>
    <div class="db-viewer" style="margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Feature</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Status</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Routes</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Description</th>
        </tr>
        ${features.map(f => {
          const name = typeof f === 'string' ? f : f.name || f.feature || 'unknown';
          const status = typeof f === 'object' ? (f.healthy !== false ? 'healthy' : 'unhealthy') : 'unknown';
          const routes = typeof f === 'object' ? (f.routes || f.endpoints || 0) : '?';
          const desc = typeof f === 'object' ? (f.description || '') : '';
          return `<tr style="transition:background .1s" onmouseenter="this.style.background='rgba(var(--db-accent-rgb,100,100,255),.05)'" onmouseleave="this.style.background=''">
            <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-weight:500">${name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid var(--db-border)">
              <span style="font-size:11px;padding:2px 8px;border-radius:8px;${status === 'healthy' ? 'background:rgba(34,197,94,.15);color:#22c55e' : status === 'unhealthy' ? 'background:rgba(239,68,68,.15);color:#ef4444' : 'background:rgba(234,179,8,.15);color:#eab308'}">${status}</span>
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-size:12px;color:var(--db-text-dim)">${routes}</td>
            <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-size:12px;color:var(--db-text-dim)">${desc}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="4" style="padding:8px 12px;color:var(--db-text-dim)">No features registered</td></tr>'}
      </table>
    </div>

    <!-- Environment Info -->
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Environment</h3>
    <div class="db-columns" style="grid-template-columns:1fr 1fr;margin-bottom:24px">
      <div class="db-card">
        <div class="db-card-title">Server Configuration</div>
        <div style="margin-top:8px;font-size:12px">
          ${Object.entries(config).slice(0, 15).map(([k, v]) => `
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--db-border)">
              <span style="color:var(--db-text-dim)">${k}</span>
              <span style="font-family:monospace;font-size:11px">${typeof v === 'object' ? JSON.stringify(v).substring(0,40) + '…' : String(v).substring(0,40)}</span>
            </div>
          `).join('') || '<div style="color:var(--db-text-dim)">No configuration data</div>'}
        </div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Browser Info</div>
        <div style="margin-top:8px;font-size:12px">
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--db-border)"><span style="color:var(--db-text-dim)">User Agent</span><span style="font-family:monospace;font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${navigator.userAgent.substring(0,50)}…</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--db-border)"><span style="color:var(--db-text-dim)">Protocol</span><span style="font-family:monospace;font-size:11px">${location.protocol}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--db-border)"><span style="color:var(--db-text-dim)">Host</span><span style="font-family:monospace;font-size:11px">${location.host}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--db-border)"><span style="color:var(--db-text-dim)">Page Load</span><span style="font-family:monospace;font-size:11px">${new Date().toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--db-text-dim)">Language</span><span style="font-family:monospace;font-size:11px">${navigator.language}</span></div>
        </div>
      </div>
    </div>

    <!-- Gateway Agents -->
    ${gatewayAgents.length > 0 ? `
      <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Gateway Agents</h3>
      <div class="db-viewer" style="margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">ID</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Name</th>
          </tr>
          ${gatewayAgents.map(a => `<tr><td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-family:monospace;font-size:12px">${a.id}</td><td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-weight:500">${a.name}</td></tr>`).join('')}
        </table>
      </div>
    ` : ''}

    <!-- Actions -->
    <div style="display:flex;gap:8px">
      <button id="debug-refresh" style="padding:6px 14px;background:var(--db-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">⟳ Refresh All</button>
      <button id="debug-copy" style="padding:6px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer;font-size:12px">📋 Copy Diagnostics</button>
    </div>
  `;

  // Event listeners
  container.querySelector('#debug-refresh')?.addEventListener('click', () => render(container));
  container.querySelector('#debug-copy')?.addEventListener('click', () => {
    const report = {
      timestamp: new Date().toISOString(),
      server: { status: serverStatus, uptime: health.uptime },
      gateway: { status: gatewayStatus, connected: gatewayConnected, agents: gatewayAgents.length },
      websocket: { status: wsStatus, latency: wsLatency },
      features: features.length,
      featureList: features.map(f => typeof f === 'string' ? f : f.name || f.feature),
      browser: { userAgent: navigator.userAgent, host: location.host, protocol: location.protocol },
    };
    navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      alert('Diagnostics copied to clipboard!');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = JSON.stringify(report, null, 2);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      alert('Diagnostics copied!');
    });
  });
}

function formatUptime(seconds) {
  if (!seconds) return 'unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}
