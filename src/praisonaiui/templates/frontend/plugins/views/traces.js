/**
 * Traces View — Distributed tracing and observability.
 * Shows execution traces, spans, call trees.
 * API: /api/traces, /api/traces/status, /api/traces/spans
 */
import { helpBanner } from '/plugins/views/_helpers.js';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, traces = [], spans = [];
  try {
    const [sRes, tRes, spRes] = await Promise.all([
      fetch('/api/traces/status'), fetch('/api/traces?limit=30'), fetch('/api/traces/spans?limit=50')
    ]);
    statusData = await sRes.json();
    traces = (await tRes.json()).traces || [];
    spans = (await spRes.json()).spans || [];
  } catch(e) { statusData = { status: 'error' }; }

  const gwBadge = statusData.gateway_connected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 20px;font-size:1.5rem">🔍 Traces</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Total Traces</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.total_traces || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Total Spans</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.total_spans || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Trace SDK</div>
          <div style="font-size:.85rem;margin-top:4px">${statusData.trace_available ? '✅' : '❌'} Trace</div>
          <div style="font-size:.85rem">${statusData.obs_available ? '✅' : '❌'} Obs</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Gateway</div>
          <div style="font-size:1rem;margin-top:4px">${gwBadge}</div>
        </div>
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Recent Traces</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden;margin-bottom:24px">
        ${traces.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No traces recorded. Traces will appear when agents execute via gateway.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Trace ID</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Name</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Status</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Duration</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Spans</th>
              </tr></thead>
              <tbody>${traces.map(t => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;font-family:monospace;opacity:.7">${t.id?.substring(0,12)}…</td>
                  <td style="padding:10px 14px;font-size:.85rem">${t.agent_id}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${t.name || '—'}</td>
                  <td style="padding:10px 14px;text-align:center"><span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:${t.status==='completed'?'rgba(34,197,94,.15)':'rgba(245,158,11,.15)'}">${t.status}</span></td>
                  <td style="padding:10px 14px;text-align:center">${t.duration_ms}ms</td>
                  <td style="padding:10px 14px;text-align:center">${t.span_count || 0}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Recent Spans</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden">
        ${spans.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No spans recorded.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Time</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Name</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Kind</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Duration</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Status</th>
              </tr></thead>
              <tbody>${spans.map(s => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.6">${new Date(s.timestamp*1000).toLocaleTimeString()}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${s.agent_id}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${s.name}</td>
                  <td style="padding:10px 14px"><span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:rgba(99,102,241,.1)">${s.kind}</span></td>
                  <td style="padding:10px 14px;text-align:center">${s.duration_ms}ms</td>
                  <td style="padding:10px 14px;text-align:center">${s.status === 'ok' ? '✅' : '⚠️'}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>
      ${helpBanner({
        title: 'Traces',
        what: 'Traces show the step-by-step journey of each agent request — what happened, in what order, and how long each step took.',
        howToUse: 'Traces are recorded automatically when agents process requests. Browse recent traces in the table below and click to see detailed timing breakdowns.',
        tip: 'No traces showing? Make sure you have agents connected and have sent at least one message through chat.',
        collapsed: true,
      })}
    </div>`;
}
