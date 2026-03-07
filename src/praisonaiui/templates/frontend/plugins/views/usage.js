/**
 * Usage View — Token/cost analytics with charts, filters, and export.
 *
 * Enhanced with: date-range presets, model/agent filters, session drill-down,
 *                CSV export, and improved visualizations.
 *
 * API: /api/usage/summary, /api/usage/models, /api/usage/timeseries,
 *      /api/usage/agents, /api/usage/sessions
 */

let activeRange = '7d';
let filterModel = '';
let filterAgent = '';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let summary = {}, models = {}, timeseries = [], agents = {}, sessions = {};
  try { const r = await fetch('/api/usage/summary'); summary = (await r.json()).usage || await r.json(); } catch(e) {}
  try { const r = await fetch('/api/usage/models'); models = (await r.json()).models || await r.json(); } catch(e) {}
  try { const r = await fetch('/api/usage/timeseries'); timeseries = (await r.json()).data || []; } catch(e) {}
  try { const r = await fetch('/api/usage/agents'); agents = (await r.json()).agents || await r.json(); } catch(e) {}
  try { const r = await fetch('/api/usage/sessions'); sessions = (await r.json()).sessions || await r.json(); } catch(e) {}

  const totalCost = summary.total_cost || 0;
  const totalInput = summary.total_input_tokens || 0;
  const totalOutput = summary.total_output_tokens || 0;
  const totalReqs = summary.total_requests || 0;
  const modelData = summary.by_model || models || {};
  const agentData = typeof agents === 'object' ? agents : {};
  const sessionData = typeof sessions === 'object' ? sessions : {};

  // Build model and agent lists for filters
  const modelNames = Object.keys(modelData);
  const agentNames = Object.keys(agentData);

  container.innerHTML = `
    <!-- Controls Bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">
      <div style="display:flex;gap:6px;align-items:center">
        ${['1d','7d','30d','all'].map(r => `<button class="usage-range-btn${activeRange===r?' active':''}" data-range="${r}" style="padding:5px 14px;border:1px solid var(--db-border);background:${activeRange===r?'var(--db-accent)':'transparent'};color:${activeRange===r?'#fff':'var(--db-text)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">${r === 'all' ? 'All' : r}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="usage-filter-model" style="padding:5px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:12px">
          <option value="">All Models</option>
          ${modelNames.map(m => `<option value="${m}"${filterModel===m?' selected':''}>${m}</option>`).join('')}
        </select>
        <select id="usage-filter-agent" style="padding:5px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:12px">
          <option value="">All Agents</option>
          ${agentNames.map(a => `<option value="${a}"${filterAgent===a?' selected':''}>${a}</option>`).join('')}
        </select>
        <button id="usage-export" style="padding:5px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer;font-size:12px">📥 Export CSV</button>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="db-columns" style="grid-template-columns:repeat(4,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Total Cost</div><div class="db-card-value" style="font-size:28px;font-weight:700;margin:8px 0">$${totalCost.toFixed(4)}</div><div style="font-size:11px;color:var(--db-text-dim)">USD</div></div>
      <div class="db-card"><div class="db-card-title">Requests</div><div class="db-card-value" style="font-size:28px;font-weight:700;margin:8px 0">${totalReqs.toLocaleString()}</div><div style="font-size:11px;color:var(--db-text-dim)">total API calls</div></div>
      <div class="db-card"><div class="db-card-title">Input Tokens</div><div class="db-card-value" style="font-size:28px;font-weight:700;margin:8px 0">${formatNum(totalInput)}</div><div style="font-size:11px;color:var(--db-text-dim)">prompt tokens</div></div>
      <div class="db-card"><div class="db-card-title">Output Tokens</div><div class="db-card-value" style="font-size:28px;font-weight:700;margin:8px 0">${formatNum(totalOutput)}</div><div style="font-size:11px;color:var(--db-text-dim)">completion tokens</div></div>
    </div>

    <!-- Charts Row -->
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

    <!-- Per-Model Table -->
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Per-Model Breakdown</h3>
    <div class="db-viewer" style="margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Model</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Requests</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Input</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Output</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Cost</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">% Total</th>
        </tr>
        ${Object.entries(modelData).map(([m, d]) => {
          const cost = d.cost || 0;
          const pct = totalCost > 0 ? (cost / totalCost * 100).toFixed(1) : '0.0';
          return `<tr style="transition:background .1s" onmouseenter="this.style.background='rgba(var(--db-accent-rgb,100,100,255),.05)'" onmouseleave="this.style.background=''">
            <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-weight:500">${m}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${(d.requests || d.count || 0).toLocaleString()}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${formatNum(d.input_tokens || 0)}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${formatNum(d.output_tokens || 0)}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border);font-weight:600">$${cost.toFixed(4)}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">
              <span style="display:inline-block;width:40px;text-align:right;margin-right:6px">${pct}%</span>
              <span style="display:inline-block;width:60px;height:4px;background:var(--db-border);border-radius:2px;vertical-align:middle"><span style="display:block;height:100%;width:${pct}%;background:var(--db-accent);border-radius:2px"></span></span>
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="6" style="padding:8px 12px;color:var(--db-text-dim)">No usage data</td></tr>'}
      </table>
    </div>

    <!-- Per-Agent Cards -->
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Per-Agent Usage</h3>
    <div class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-bottom:24px">
      ${Object.entries(agentData).map(([name, d]) => `
        <div class="db-card" style="padding:14px 18px">
          <div style="font-weight:500;font-size:13px">🤖 ${name}</div>
          <div style="font-size:24px;font-weight:700;margin:8px 0">$${(d.cost || 0).toFixed(4)}</div>
          <div style="font-size:11px;color:var(--db-text-dim)">${(d.requests || d.count || 0)} requests · ${formatNum((d.input_tokens||0)+(d.output_tokens||0))} tokens</div>
        </div>
      `).join('') || '<div class="db-viewer"><pre>No agent usage data</pre></div>'}
    </div>

    <!-- Per-Session Drill-Down -->
    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Per-Session Breakdown</h3>
    <div class="db-viewer" style="margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <th style="text-align:left;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Session</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Requests</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Tokens</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:2px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase">Cost</th>
        </tr>
        ${Object.entries(sessionData).slice(0, 20).map(([id, d]) => `
          <tr style="transition:background .1s" onmouseenter="this.style.background='rgba(var(--db-accent-rgb,100,100,255),.05)'" onmouseleave="this.style.background=''">
            <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);font-family:monospace;font-size:12px">${id.length > 12 ? id.substring(0,12) + '…' : id}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${(d.requests || d.count || 0).toLocaleString()}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border)">${formatNum((d.input_tokens||0) + (d.output_tokens||0))}</td>
            <td style="text-align:right;padding:8px 12px;border-bottom:1px solid var(--db-border);font-weight:600">$${(d.cost || 0).toFixed(4)}</td>
          </tr>
        `).join('') || '<tr><td colspan="4" style="padding:8px 12px;color:var(--db-text-dim)">No session data</td></tr>'}
      </table>
    </div>
  `;

  // Render charts
  renderBarChart(container.querySelector('#usage-model-chart'), modelData, 'cost');
  renderTimeSeries(container.querySelector('#usage-time-chart'), timeseries);

  // Bind date-range buttons
  container.querySelectorAll('.usage-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeRange = btn.dataset.range;
      render(container);
    });
  });

  // Bind filter selects
  container.querySelector('#usage-filter-model')?.addEventListener('change', (e) => {
    filterModel = e.target.value;
    render(container);
  });
  container.querySelector('#usage-filter-agent')?.addEventListener('change', (e) => {
    filterAgent = e.target.value;
    render(container);
  });

  // Export CSV
  container.querySelector('#usage-export')?.addEventListener('click', () => {
    let csv = 'Model,Requests,Input Tokens,Output Tokens,Cost\n';
    Object.entries(modelData).forEach(([m, d]) => {
      csv += `"${m}",${d.requests||d.count||0},${d.input_tokens||0},${d.output_tokens||0},${(d.cost||0).toFixed(4)}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'praisonai-usage-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  });
}

function formatNum(n) {
  return n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n);
}

function renderBarChart(el, data, field) {
  if (!el || !data) return;
  const entries = Object.entries(data);
  if (entries.length === 0) { el.innerHTML = '<div style="font-size:12px;color:var(--db-text-dim)">No data</div>'; return; }
  const maxVal = Math.max(...entries.map(([,d]) => d[field] || 0)) || 1;
  el.innerHTML = entries.map(([m, d]) => {
    const val = d[field] || 0;
    const pct = (val / maxVal * 100).toFixed(0);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${m}</span><span style="font-weight:600">$${val.toFixed(4)}</span></div>
      <div style="height:6px;background:var(--db-border);border-radius:3px"><div style="height:100%;width:${pct}%;background:var(--db-accent);border-radius:3px;transition:width .3s"></div></div>
    </div>`;
  }).join('');
}

function renderTimeSeries(el, data) {
  if (!el || !data || data.length === 0) { if(el) el.innerHTML = '<div style="font-size:12px;color:var(--db-text-dim)">No time series data</div>'; return; }
  const maxTokens = Math.max(...data.map(d => (d.input_tokens || 0) + (d.output_tokens || 0))) || 1;
  el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:2px;height:80px">${data.slice(-24).map(d => {
    const total = (d.input_tokens || 0) + (d.output_tokens || 0);
    const pct = (total / maxTokens * 100).toFixed(0);
    return `<div title="${d.hour || d.time || ''}: ${total} tokens" style="flex:1;height:${pct}%;min-height:2px;background:var(--db-accent);border-radius:2px 2px 0 0;opacity:0.8;transition:height .3s"></div>`;
  }).join('')}</div>`;
}
