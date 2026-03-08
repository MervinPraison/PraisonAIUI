/**
 * Telemetry View — Performance monitoring dashboard.
 * Shows LLM call latency, token throughput, profiling data.
 * API: /api/telemetry, /api/telemetry/status, /api/telemetry/metrics, /api/telemetry/performance
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, overview = {}, metrics = [];
  try {
    const [sRes, oRes, mRes] = await Promise.all([
      fetch('/api/telemetry/status'), fetch('/api/telemetry'), fetch('/api/telemetry/metrics?limit=30')
    ]);
    statusData = await sRes.json();
    overview = await oRes.json();
    metrics = (await mRes.json()).metrics || [];
  } catch(e) { statusData = { status: 'error' }; }

  const gwBadge = statusData.gateway_connected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  const agentRows = Object.entries(overview.by_agent || {});

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 20px;font-size:1.5rem">📈 Telemetry</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Total Calls</div>
          <div style="font-size:1.8rem;font-weight:700">${overview.total_calls || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Avg Latency</div>
          <div style="font-size:1.8rem;font-weight:700">${overview.avg_latency_ms !== null ? overview.avg_latency_ms?.toFixed(0) + 'ms' : '—'}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Total Tokens</div>
          <div style="font-size:1.8rem;font-weight:700">${(overview.total_tokens || 0).toLocaleString()}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Telemetry SDK</div>
          <div style="font-size:.85rem;margin-top:4px">${statusData.telemetry_available ? '✅' : '❌'} Telemetry</div>
          <div style="font-size:.85rem">${statusData.profiling_available ? '✅' : '❌'} Profiling</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Gateway</div>
          <div style="font-size:1rem;margin-top:4px">${gwBadge}</div>
        </div>
      </div>

      ${agentRows.length > 0 ? `
        <h3 style="margin:0 0 12px;font-size:1.1rem">By Agent</h3>
        <div class="db-card" style="border-radius:12px;overflow:hidden;margin-bottom:24px">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
              <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
              <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Calls</th>
              <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Avg Latency</th>
              <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Total Tokens</th>
            </tr></thead>
            <tbody>${agentRows.map(([aid, s]) => `
              <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                <td style="padding:10px 14px;font-size:.85rem">${aid}</td>
                <td style="padding:10px 14px;text-align:center">${s.calls}</td>
                <td style="padding:10px 14px;text-align:center">${s.avg_latency_ms?.toFixed(0) || 0}ms</td>
                <td style="padding:10px 14px;text-align:center">${s.total_tokens.toLocaleString()}</td>
              </tr>`).join('')}
            </tbody></table>
        </div>` : ''}

      <h3 style="margin:0 0 12px;font-size:1.1rem">Recent Metrics</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden">
        ${metrics.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No metrics recorded yet. Metrics flow in from gateway agent execution hooks.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Time</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Type</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Model</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Latency</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Tokens</th>
              </tr></thead>
              <tbody>${metrics.map(m => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.6">${new Date(m.timestamp*1000).toLocaleTimeString()}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${m.agent_id}</td>
                  <td style="padding:10px 14px;font-size:.8rem">${m.type}</td>
                  <td style="padding:10px 14px;font-size:.8rem;font-family:monospace">${m.model || '—'}</td>
                  <td style="padding:10px 14px;text-align:center">${m.latency_ms}ms</td>
                  <td style="padding:10px 14px;text-align:center">${m.tokens}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>
    </div>`;
}
