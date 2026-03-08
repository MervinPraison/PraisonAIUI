/**
 * Eval View — Agent evaluation and accuracy monitoring.
 * Shows evaluation scores, judge results, quality metrics.
 * API: /api/eval, /api/eval/status, /api/eval/scores, /api/eval/judges
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, scores = [], evaluations = [], judges = [];
  try {
    const [sRes, scRes, eRes, jRes] = await Promise.all([
      fetch('/api/eval/status'), fetch('/api/eval/scores'), fetch('/api/eval?limit=20'), fetch('/api/eval/judges')
    ]);
    statusData = await sRes.json();
    scores = (await scRes.json()).scores || [];
    evaluations = (await eRes.json()).evaluations || [];
    judges = (await jRes.json()).judges || [];
  } catch(e) { statusData = { status: 'error' }; }

  const gwBadge = statusData.gateway_connected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 20px;font-size:1.5rem">📊 Evaluation</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Total Evaluations</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.total_evaluations || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Active Judges</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.active_judges || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Eval SDK</div>
          <div style="font-size:1rem;margin-top:4px">${statusData.eval_available ? '✅ Available' : '❌ Not Installed'}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Gateway</div>
          <div style="font-size:1rem;margin-top:4px">${gwBadge}</div>
        </div>
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Agent Scores</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden;margin-bottom:24px">
        ${scores.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No evaluation scores yet. Run evaluations via API or gateway hooks.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Total</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Avg Score</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Passed</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Failed</th>
              </tr></thead>
              <tbody>${scores.map(s => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.85rem">${s.agent_id}</td>
                  <td style="padding:10px 14px;text-align:center">${s.total}</td>
                  <td style="padding:10px 14px;text-align:center;font-weight:600">${s.avg_score !== null ? s.avg_score.toFixed(2) : '—'}</td>
                  <td style="padding:10px 14px;text-align:center;color:#22c55e">${s.passed}</td>
                  <td style="padding:10px 14px;text-align:center;color:#ef4444">${s.failed}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Recent Evaluations</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden;margin-bottom:24px">
        ${evaluations.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No evaluations recorded yet.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Time</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Evaluator</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Score</th>
                <th style="padding:10px 14px;text-align:center;font-size:.8rem;opacity:.6">Pass</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Feedback</th>
              </tr></thead>
              <tbody>${evaluations.map(e => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.6">${new Date(e.timestamp*1000).toLocaleTimeString()}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${e.agent_id}</td>
                  <td style="padding:10px 14px;font-size:.8rem;font-family:monospace">${e.evaluator}</td>
                  <td style="padding:10px 14px;text-align:center;font-weight:600">${e.score !== null ? e.score : '—'}</td>
                  <td style="padding:10px 14px;text-align:center">${e.passed === true ? '✅' : e.passed === false ? '❌' : '—'}</td>
                  <td style="padding:10px 14px;font-size:.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${e.feedback || ''}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>

      ${judges.length > 0 ? `
        <h3 style="margin:0 0 12px;font-size:1.1rem">Judges</h3>
        <div class="db-card" style="border-radius:12px;padding:16px">
          ${judges.map(j => `<span style="display:inline-block;padding:4px 12px;margin:4px;border-radius:8px;font-size:.8rem;background:rgba(168,85,247,.1)">${j.name} (${j.type})</span>`).join('')}
        </div>` : ''}
    </div>`;
}
