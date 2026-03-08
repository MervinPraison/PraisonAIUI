/**
 * Security View — Security monitoring and audit log.
 * Shows security status, audit entries, agent security config.
 * API: /api/security, /api/security/status, /api/security/audit, /api/security/config
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, overview = {}, auditData = {};
  try {
    const [sRes, oRes, aRes] = await Promise.all([
      fetch('/api/security/status'), fetch('/api/security'), fetch('/api/security/audit?limit=20')
    ]);
    statusData = await sRes.json();
    overview = await oRes.json();
    auditData = await aRes.json();
  } catch(e) { statusData = { status: 'error' }; }

  const cfg = overview.config || {};
  const agents = overview.agent_security || [];
  const entries = auditData.entries || [];

  const gwBadge = statusData.gateway_connected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 20px;font-size:1.5rem">🔒 Security</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Injection Defense</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:4px">${cfg.injection_defense ? '✅ Active' : '❌ Off'}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Audit Logging</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:4px">${cfg.audit_logging ? '✅ Active' : '❌ Off'}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Audit Entries</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.audit_entries || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Security SDK</div>
          <div style="font-size:.85rem;margin-top:4px">${statusData.security_available ? '✅ Available' : '❌ Not Found'}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Gateway</div>
          <div style="font-size:1rem;margin-top:4px">${gwBadge}</div>
          <div style="font-size:.75rem;opacity:.5">Agents: ${statusData.gateway_agent_count || 0}</div>
        </div>
      </div>

      ${agents.length > 0 ? `
        <h3 style="margin:0 0 12px;font-size:1.1rem">Agent Security</h3>
        <div class="db-card" style="border-radius:12px;overflow:hidden;margin-bottom:24px">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
              <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
              <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Guardrails</th>
              <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Tools</th>
              <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Tool Count</th>
            </tr></thead>
            <tbody>${agents.map(a => `
              <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                <td style="padding:10px 14px;font-size:.85rem">${a.name}</td>
                <td style="padding:10px 14px;text-align:center">${a.has_guardrail ? '🛡️' : '—'}</td>
                <td style="padding:10px 14px;text-align:center">${a.has_tools ? '🔧' : '—'}</td>
                <td style="padding:10px 14px;text-align:center">${a.tool_count}</td>
              </tr>`).join('')}
            </tbody></table>
        </div>` : ''}

      <h3 style="margin:0 0 12px;font-size:1.1rem">Audit Log</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden">
        ${entries.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No audit entries. Enable audit logging or connect agents via gateway.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Time</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Event</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Severity</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Data</th>
              </tr></thead>
              <tbody>${entries.map(e => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.6">${new Date(e.timestamp*1000).toLocaleTimeString()}</td>
                  <td style="padding:10px 14px;font-size:.85rem;font-family:monospace">${e.event_type}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${e.agent_id || '—'}</td>
                  <td style="padding:10px 14px"><span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:${e.severity==='error'?'rgba(239,68,68,.15)':e.severity==='warning'?'rgba(245,158,11,.15)':'rgba(59,130,246,.1)'}">${e.severity}</span></td>
                  <td style="padding:10px 14px;font-size:.75rem;font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis">${JSON.stringify(e.data).substring(0,60)}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>
    </div>`;
}
