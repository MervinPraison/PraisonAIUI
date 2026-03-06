/**
 * Usage View — token/cost analytics with charts
 * API: /api/usage
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let summary = {}, models = {}, timeseries = [], agents = {};
  try { const r = await fetch('/api/usage/summary'); summary = (await r.json()).usage || await r.json(); } catch(e) {}
  try { const r = await fetch('/api/usage/models'); models = (await r.json()).models || await r.json(); } catch(e) {}
  try { const r = await fetch('/api/usage/timeseries'); timeseries = (await r.json()).data || []; } catch(e) {}
  try { const r = await fetch('/api/usage/agents'); agents = (await r.json()).agents || await r.json(); } catch(e) {}

  const totalCost = summary.total_cost || 0;
  const totalInput = summary.total_input_tokens || 0;
  const totalOutput = summary.total_output_tokens || 0;
  const totalReqs = summary.total_requests || 0;
  const modelData = summary.by_model || models || {};

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(4,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Total Cost</div><div class="db-card-value">$${totalCost.toFixed(4)}</div></div>
      <div class="db-card"><div class="db-card-title">Requests</div><div class="db-card-value">${totalReqs.toLocaleString()}</div></div>
      <div class="db-card"><div class="db-card-title">Input Tokens</div><div class="db-card-value">${formatNum(totalInput)}</div></div>
      <div class="db-card"><div class="db-card-title">Output Tokens</div><div class="db-card-value">${formatNum(totalOutput)}</div></div>
    </div>

    <div class="db-columns" style="grid-template-columns:1fr 1fr;margin-bottom:24px">
      <div class="db-card">
        <div class="db-card-title">Cost by Model</div>
        <div id="usage-model-chart" style="margin-top:12px"></div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Tokens Over Time</div>
        <div id="usage-time-chart" style="margin-top:12px"></div>
      </div>
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Per-Model Breakdown</h3>
    <div class="db-viewer" style="margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Model</th><th style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Requests</th><th style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Input</th><th style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Output</th><th style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Cost</th></tr>
        ${Object.entries(modelData).map(([m, d]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid var(--db-border)">${m}</td><td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${(d.requests || d.count || 0).toLocaleString()}</td><td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${formatNum(d.input_tokens || 0)}</td><td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${formatNum(d.output_tokens || 0)}</td><td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">$${(d.cost || 0).toFixed(4)}</td></tr>`).join('') || '<tr><td colspan="5" style="padding:8px 12px;color:var(--db-text-dim)">No usage data</td></tr>'}
      </table>
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Per-Agent Usage</h3>
    <div class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
      ${Object.entries(typeof agents === 'object' ? agents : {}).map(([name, d]) => `
        <div class="db-card" style="padding:14px 18px">
          <div style="font-weight:500;font-size:13px">🤖 ${name}</div>
          <div style="font-size:24px;font-weight:700;margin:8px 0">$${(d.cost || 0).toFixed(4)}</div>
          <div style="font-size:11px;color:var(--db-text-dim)">${(d.requests || d.count || 0)} requests</div>
        </div>
      `).join('') || '<div class="db-viewer"><pre>No agent usage data</pre></div>'}
    </div>
  `;

  // Simple bar chart for models
  renderBarChart(container.querySelector('#usage-model-chart'), modelData, 'cost');
  // Simple line chart for timeseries
  renderTimeSeries(container.querySelector('#usage-time-chart'), timeseries);
}

function formatNum(n) { return n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n); }

function renderBarChart(el, data, field) {
  if (!el || !data) return;
  const entries = Object.entries(data);
  if (entries.length === 0) { el.innerHTML = '<div style="font-size:12px;color:var(--db-text-dim)">No data</div>'; return; }
  const maxVal = Math.max(...entries.map(([,d]) => d[field] || 0)) || 1;
  el.innerHTML = entries.map(([m, d]) => {
    const val = d[field] || 0;
    const pct = (val / maxVal * 100).toFixed(0);
    return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${m}</span><span>$${val.toFixed(4)}</span></div><div style="height:6px;background:var(--db-border);border-radius:3px"><div style="height:100%;width:${pct}%;background:var(--db-accent);border-radius:3px"></div></div></div>`;
  }).join('');
}

function renderTimeSeries(el, data) {
  if (!el || !data || data.length === 0) { if(el) el.innerHTML = '<div style="font-size:12px;color:var(--db-text-dim)">No time series data</div>'; return; }
  const maxTokens = Math.max(...data.map(d => (d.input_tokens || 0) + (d.output_tokens || 0))) || 1;
  el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:2px;height:80px">${data.slice(-24).map(d => {
    const total = (d.input_tokens || 0) + (d.output_tokens || 0);
    const pct = (total / maxTokens * 100).toFixed(0);
    return `<div title="${d.hour || d.time || ''}: ${total} tokens" style="flex:1;height:${pct}%;min-height:2px;background:var(--db-accent);border-radius:2px 2px 0 0;opacity:0.8"></div>`;
  }).join('')}</div>`;
}
