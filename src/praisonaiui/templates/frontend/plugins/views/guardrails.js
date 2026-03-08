/**
 * Guardrails View — Input/output safety monitoring dashboard.
 * Shows active guardrails, violation logs, and safety policies.
 * API: /api/guardrails, /api/guardrails/status, /api/guardrails/violations
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, guardrailsList = [], violations = [];
  try {
    const [sRes, gRes, vRes] = await Promise.all([
      fetch('/api/guardrails/status'), fetch('/api/guardrails'), fetch('/api/guardrails/violations?limit=20')
    ]);
    statusData = await sRes.json();
    guardrailsList = (await gRes.json()).guardrails || [];
    violations = (await vRes.json()).violations || [];
  } catch(e) { statusData = { status: 'error', active_guardrails: 0 }; }

  const gwBadge = statusData.gateway_connected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 20px;font-size:1.5rem">🛡️ Guardrails</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Active Guardrails</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.active_guardrails || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Total Violations</div>
          <div style="font-size:1.8rem;font-weight:700;color:#ef4444">${statusData.total_violations || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Gateway</div>
          <div style="font-size:1rem;margin-top:4px">${gwBadge}</div>
          <div style="font-size:.75rem;opacity:.5">Agents: ${statusData.gateway_agent_count || 0}</div>
        </div>
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Active Guardrails</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden;margin-bottom:24px">
        ${guardrailsList.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No guardrails configured. Register agents with guardrails via gateway.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Type</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Guardrail</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Source</th>
              </tr></thead>
              <tbody>${guardrailsList.map(g => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.85rem">${g.agent_name || g.agent_id || '-'}</td>
                  <td style="padding:10px 14px"><span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:${g.type==='input'?'rgba(59,130,246,.15)':'rgba(168,85,247,.15)'}">${g.type}</span></td>
                  <td style="padding:10px 14px;font-size:.85rem;font-family:monospace">${g.guardrail}</td>
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.5">${g.source}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Recent Violations</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden">
        ${violations.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No violations recorded.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Time</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Guardrail</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Level</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Message</th>
              </tr></thead>
              <tbody>${violations.map(v => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.6">${new Date(v.timestamp*1000).toLocaleTimeString()}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${v.agent_id}</td>
                  <td style="padding:10px 14px;font-size:.85rem;font-family:monospace">${v.guardrail}</td>
                  <td style="padding:10px 14px"><span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:${v.level==='ERROR'?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)'}">${v.level}</span></td>
                  <td style="padding:10px 14px;font-size:.8rem">${v.message}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>
    </div>`;
}
