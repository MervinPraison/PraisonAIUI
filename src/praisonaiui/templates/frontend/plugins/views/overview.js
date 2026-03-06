/**
 * Overview View — system stats, uptime, feature health
 * Renders into [data-page="overview"]
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';
  
  let features = [], startTime = Date.now();
  try {
    const res = await fetch('/api/features');
    const data = await res.json();
    features = data.features || [];
  } catch(e) { /* ignore */ }

  const healthy = features.filter(f => f.status === 'active').length;
  const total = features.length;
  const uptimeMs = Date.now() - (window.__aiuiLoadTime || Date.now());
  const uptime = uptimeMs < 60000 ? `${Math.round(uptimeMs/1000)}s` : `${Math.round(uptimeMs/60000)}m`;

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(4,1fr)">
      <div class="db-card">
        <div class="db-card-title">Status</div>
        <div class="db-card-value" style="color:#22c55e">● Online</div>
        <div class="db-card-footer">Uptime: ${uptime}</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Features</div>
        <div class="db-card-value">${total}</div>
        <div class="db-card-footer">${healthy} active</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Health</div>
        <div class="db-card-value">${total > 0 ? Math.round(healthy/total*100) : 0}%</div>
        <div class="db-card-footer">${total - healthy} degraded</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">API Latency</div>
        <div class="db-card-value">${Date.now() - startTime}ms</div>
        <div class="db-card-footer">/api/features</div>
      </div>
    </div>

    <h3 style="margin:28px 0 16px;font-size:15px;font-weight:600">Feature Health</h3>
    <div class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      ${features.map(f => `
        <div class="db-card" style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:13px;font-weight:500">${f.name || 'unknown'}</div>
            <div style="font-size:11px;color:var(--db-text-dim)">${f.description || ''}</div>
          </div>
          <span style="font-size:12px;padding:3px 10px;border-radius:20px;${f.status === 'active' 
            ? 'background:rgba(34,197,94,0.15);color:#22c55e' 
            : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${f.status === 'active' ? '● active' : '○ inactive'}</span>
        </div>
      `).join('')}
    </div>
  `;
}
