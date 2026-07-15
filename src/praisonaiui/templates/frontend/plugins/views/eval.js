/**
 * Eval Quality Cockpit (STITCH-009) — regression dashboard for agent quality.
 *
 * Upgrades the read-only Evaluation table into a quality cockpit that answers:
 * are agents getting better/worse, which suite regressed, what failed, and can
 * I trigger a run — all client-derived from existing endpoints (no new backend).
 *
 * Data sources (parallel, fault-tolerant via Promise.allSettled):
 *   GET  /api/eval/status  /api/eval/scores  /api/eval?limit=200  /api/eval/judges
 *   POST /api/eval/run
 *
 * Failed rows deep-link to Run Flight Recorder (/runs?session=) when a
 * session_id is present, otherwise fall back to /traces (STITCH-007 soft dep).
 */
import { showToast } from '../toast.js';
import {
  esc, timeAgo, sparklineSVG, bucketByDay, detectRegression, trendArrow, regressionBadge,
} from '/plugins/views/_helpers.js';

const HISTORY_LIMIT = 200;
const BASELINE_ID_KEY = 'aiui_eval_baseline_id';
const BASELINE_SNAP_KEY = 'aiui_eval_baseline_snapshot';

function navigate(pageId) {
  if (window.aiui?.selectPage) window.aiui.selectPage(pageId);
}

function loadBaseline() {
  try {
    const raw = localStorage.getItem(BASELINE_SNAP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveBaseline(snapshot) {
  try {
    localStorage.setItem(BASELINE_ID_KEY, snapshot.id);
    localStorage.setItem(BASELINE_SNAP_KEY, JSON.stringify(snapshot));
  } catch (e) { /* storage disabled */ }
}

function clearBaseline() {
  try {
    localStorage.removeItem(BASELINE_ID_KEY);
    localStorage.removeItem(BASELINE_SNAP_KEY);
  } catch (e) { /* ignore */ }
}

function passRateFor(s) {
  const denom = (s.passed || 0) + (s.failed || 0);
  return denom > 0 ? (s.passed || 0) / denom : null;
}

function statusDot(rate) {
  if (rate == null) return '<span style="color:#71717a">●</span>';
  if (rate >= 0.9) return '<span style="color:#22c55e">●</span>';
  if (rate >= 0.7) return '<span style="color:#f59e0b">●</span>';
  return '<span style="color:#ef4444">●</span>';
}

function statusLabel(rate) {
  if (rate == null) return 'No data';
  if (rate >= 0.9) return 'Healthy';
  if (rate >= 0.7) return 'Watch';
  return 'Regressed';
}

function heroColor(rate) {
  if (rate == null) return undefined;
  if (rate >= 0.9) return '#22c55e';
  if (rate >= 0.7) return '#f59e0b';
  return '#ef4444';
}

export async function render(container) {
  container.setAttribute('data-page', 'eval');
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, scores = [], evaluations = [], judges = [];
  let partialError = false;
  try {
    const [sRes, scRes, eRes, jRes] = await Promise.allSettled([
      fetch('/api/eval/status'),
      fetch('/api/eval/scores'),
      fetch(`/api/eval?limit=${HISTORY_LIMIT}`),
      fetch('/api/eval/judges'),
    ]);
    if (sRes.status === 'fulfilled') statusData = await sRes.value.json(); else partialError = true;
    if (scRes.status === 'fulfilled') scores = (await scRes.value.json()).scores || []; else partialError = true;
    if (eRes.status === 'fulfilled') evaluations = (await eRes.value.json()).evaluations || []; else partialError = true;
    if (jRes.status === 'fulfilled') judges = (await jRes.value.json()).judges || []; else partialError = true;
  } catch (e) {
    statusData = { status: 'error' };
    partialError = true;
  }

  const sdkAvailable = statusData.sdk_available === true;
  const gatewayConnected = statusData.gateway_connected === true;
  const baseline = loadBaseline();

  // ── Hero aggregates ────────────────────────────────────────────
  let totalPassed = 0, totalFailed = 0, totalCases = 0, weightedScore = 0, scoredCases = 0;
  for (const s of scores) {
    totalPassed += s.passed || 0;
    totalFailed += s.failed || 0;
    totalCases += s.total || 0;
    if (s.avg_score != null && s.scored) {
      weightedScore += s.avg_score * s.scored;
      scoredCases += s.scored;
    }
  }
  const passDenom = totalPassed + totalFailed;
  const passRate = passDenom > 0 ? (totalPassed / passDenom) : null;
  const avgScore = scoredCases > 0 ? (weightedScore / scoredCases) : null;

  // ── Regression detection (per agent vs baseline snapshot) ──────
  let regressionCount = 0;
  const agentDelta = {};
  if (baseline?.agents) {
    for (const s of scores) {
      const base = baseline.agents[s.agent_id];
      if (base != null && s.avg_score != null) {
        const r = detectRegression(s.avg_score, base);
        agentDelta[s.agent_id] = r.delta;
        if (r.isRegression) regressionCount += 1;
      }
    }
  }

  const lastEval = evaluations.length ? evaluations[evaluations.length - 1] : null;
  const lastRun = lastEval ? timeAgo(lastEval.timestamp) : '—';

  const heroCard = (title, value, subtitle, color) => `
    <div class="db-card" style="padding:16px;border-radius:12px">
      <div style="font-size:.8rem;opacity:.6">${esc(title)}</div>
      <div style="font-size:1.8rem;font-weight:700${color ? `;color:${color}` : ''}">${value}</div>
      <div style="font-size:.75rem;opacity:.5;margin-top:2px">${esc(subtitle)}</div>
    </div>`;

  // ── Suite cards ────────────────────────────────────────────────
  const suiteCards = scores.map((s) => {
    const rate = passRateFor(s);
    const buckets = bucketByDay(evaluations, 7, s.agent_id);
    const series = buckets.map((b) => b.avg);
    const half = Math.max(1, Math.floor(series.length / 2));
    const recent = series.slice(-half).reduce((a, b) => a + b, 0) / half;
    const prior = series.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const arrow = series.length >= 2 ? trendArrow(recent, prior) : '';
    const badge = agentDelta[s.agent_id] != null ? regressionBadge(agentDelta[s.agent_id]) : '';
    const isReg = agentDelta[s.agent_id] != null && agentDelta[s.agent_id] <= -0.1;
    const sparkColor = isReg ? '#ef4444' : 'var(--db-accent,#a855f7)';
    return `
      <div class="db-card db-suite-card" style="padding:14px;border-radius:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-weight:600;font-size:.95rem">${esc(s.agent_id)}</span>
          <span style="font-size:.75rem;opacity:.7">${statusDot(rate)} ${statusLabel(rate)}</span>
        </div>
        <div style="font-size:.8rem;opacity:.75;margin:6px 0">Pass ${rate != null ? Math.round(rate * 100) + '%' : '—'} · Avg ${s.avg_score != null ? s.avg_score.toFixed(2) : '—'} · ${s.total || 0} cases</div>
        <div aria-label="7-day score trend for ${esc(s.agent_id)}">${sparklineSVG(series, { width: 220, height: 34, color: sparkColor })}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px">
          <span>${arrow || badge || '<span style="font-size:11px;opacity:.4">no trend</span>'}</span>
          <button class="ev-filter-btn" data-agent="${esc(s.agent_id)}" style="font-size:11px;padding:3px 10px;border:1px solid var(--db-border,#333);background:transparent;color:var(--db-text,#e0e0e0);border-radius:6px;cursor:pointer">Filter →</button>
        </div>
      </div>`;
  }).join('');

  // ── Baseline compare panel ─────────────────────────────────────
  let compareHtml;
  if (!baseline) {
    compareHtml = '<div style="padding:20px;text-align:center;opacity:.5;font-size:.85rem">No baseline pinned. Use "Pin baseline" on a history row to compare.</div>';
  } else {
    const rows = scores.map((s) => {
      const base = baseline.agents ? baseline.agents[s.agent_id] : null;
      const cur = s.avg_score;
      let delta = '—';
      if (base != null && cur != null) {
        const d = cur - base;
        const col = d >= 0 ? '#22c55e' : '#ef4444';
        delta = `<span style="color:${col}">${d >= 0 ? '+' : ''}${d.toFixed(2)}</span>`;
      }
      return `<tr style="border-bottom:1px solid rgba(128,128,128,.1)">
        <td style="padding:8px 12px;font-size:.85rem">${esc(s.agent_id)}</td>
        <td style="padding:8px 12px;text-align:center;font-size:.85rem">${base != null ? base.toFixed(2) : '—'}</td>
        <td style="padding:8px 12px;text-align:center;font-size:.85rem">${cur != null ? cur.toFixed(2) : '—'}</td>
        <td style="padding:8px 12px;text-align:center;font-weight:600">${delta}</td>
      </tr>`;
    }).join('');
    compareHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;font-size:.75rem;opacity:.6">
        <span>Baseline: ${esc(baseline.id || '')} · ${timeAgo(baseline.timestamp)}</span>
        <button id="ev-clear-baseline" style="font-size:11px;padding:3px 10px;border:1px solid var(--db-border,#333);background:transparent;color:var(--db-text-dim,#888);border-radius:6px;cursor:pointer">Clear baseline</button>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
          <th style="padding:8px 12px;text-align:left;font-size:.75rem;opacity:.6">Agent</th>
          <th style="padding:8px 12px;text-align:center;font-size:.75rem;opacity:.6">Baseline</th>
          <th style="padding:8px 12px;text-align:center;font-size:.75rem;opacity:.6">Latest</th>
          <th style="padding:8px 12px;text-align:center;font-size:.75rem;opacity:.6">Delta</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Run action bar ─────────────────────────────────────────────
  const agentOptions = scores.map((s) => `<option value="${esc(s.agent_id)}">${esc(s.agent_id)}</option>`).join('');
  const judgeOptions = judges.map((j) => `<option value="${esc(j.type || j.name)}">${esc(j.name)}${j.type ? ` (${esc(j.type)})` : ''}</option>`).join('');
  const runDisabled = !sdkAvailable;

  // ── History table rows (newest first) ──────────────────────────
  const ordered = [...evaluations].reverse();
  const historyRows = ordered.map((e, i) => {
    const scoreColor = e.score == null ? 'inherit' : (e.score >= 0.8 ? '#22c55e' : e.score >= 0.5 ? '#f59e0b' : '#ef4444');
    const passCell = e.passed === true ? '✅' : e.passed === false ? '❌' : '—';
    const rowBorder = e.passed === false ? 'border-left:3px solid #ef4444;' : '';
    let debugCta = '';
    if (e.passed === false) {
      debugCta = e.session_id
        ? `<button class="ev-debug-btn" data-session="${esc(e.session_id)}" style="font-size:11px;padding:3px 8px;border:1px solid var(--db-border,#333);background:transparent;color:var(--db-accent,#a855f7);border-radius:6px;cursor:pointer">Debug run →</button>`
        : '<span title="No session linked" style="font-size:11px;opacity:.4">Find traces</span>';
    }
    return `
      <tr class="ev-history-row" data-idx="${i}" style="border-bottom:1px solid rgba(128,128,128,.1);cursor:pointer;${rowBorder}">
        <td style="padding:8px 10px;width:28px;opacity:.5">▸</td>
        <td style="padding:8px 10px;font-size:.75rem;opacity:.7" title="${esc(new Date((e.timestamp || 0) * 1000).toLocaleString())}">${timeAgo(e.timestamp)}</td>
        <td style="padding:8px 10px;font-size:.85rem">${esc(e.agent_id)}</td>
        <td style="padding:8px 10px;font-size:.8rem;font-family:monospace">${esc(e.evaluator)}</td>
        <td style="padding:8px 10px;text-align:center;font-weight:600;color:${scoreColor}">${e.score != null ? e.score : '—'}</td>
        <td style="padding:8px 10px;text-align:center">${passCell}</td>
        <td style="padding:8px 10px;text-align:right">${debugCta}<button class="ev-pin-btn" data-idx="${i}" style="font-size:11px;padding:3px 8px;margin-left:6px;border:1px solid var(--db-border,#333);background:transparent;color:var(--db-text-dim,#888);border-radius:6px;cursor:pointer">Pin</button></td>
      </tr>
      <tr class="ev-detail-row" data-detail="${i}" style="display:none">
        <td colspan="7" style="padding:0 10px 12px">
          <div style="background:rgba(128,128,128,.06);border-radius:8px;padding:12px;font-size:.82rem;line-height:1.7">
            <div><strong>Input:</strong> ${esc((e.input || '').slice(0, 500))}${(e.input || '').length > 500 ? '…' : ''}</div>
            <div><strong>Expected:</strong> ${esc((e.expected || '').slice(0, 500))}${(e.expected || '').length > 500 ? '…' : ''}</div>
            <div><strong>Output:</strong> ${esc((e.output || '').slice(0, 500))}${(e.output || '').length > 500 ? '…' : ''}</div>
            ${e.feedback ? `<div><strong>Feedback:</strong> ${esc(e.feedback)}</div>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  const gwBadge = gatewayConnected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 16px;font-size:1.5rem">📊 Eval Quality Cockpit</h2>

      ${partialError ? '<div style="margin-bottom:16px;padding:10px 14px;border-radius:8px;background:rgba(245,158,11,.1);color:#f59e0b;font-size:.85rem">⚠ Some data failed to load — showing partial results.</div>' : ''}
      ${!sdkAvailable ? '<div style="margin-bottom:16px;padding:10px 14px;border-radius:8px;background:rgba(239,68,68,.08);color:#ef4444;font-size:.85rem">Eval SDK not available — run trigger disabled. Install <code>praisonaiagents[eval]</code> to enable in-UI runs.</div>' : ''}

      <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:20px;padding:10px 14px;border:1px solid var(--db-border,#333);border-radius:10px;font-size:.82rem">
        <span>Eval SDK ${sdkAvailable ? '✅' : '❌'}</span>
        <span>Gateway ${gwBadge}</span>
        <span>${judges.length} judge${judges.length === 1 ? '' : 's'}</span>
        <span style="opacity:.7">Last run ${esc(lastRun)}</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        ${heroCard('Pass Rate', passRate != null ? Math.round(passRate * 100) + '%' : '—', 'of scored cases', heroColor(passRate))}
        ${heroCard('Avg Score', avgScore != null ? avgScore.toFixed(2) : '—', 'weighted by cases')}
        ${heroCard('Regressions', String(regressionCount), 'vs baseline', regressionCount > 0 ? '#ef4444' : undefined)}
        ${heroCard('Total Cases', String(totalCases), 'all time')}
      </div>

      ${scores.length === 0 ? `
        <div class="db-card" style="border-radius:12px;padding:40px;text-align:center">
          <div style="font-size:2rem;margin-bottom:8px">🧪</div>
          <div style="font-size:1.1rem;font-weight:600;margin-bottom:6px">No evaluations recorded yet</div>
          <div style="opacity:.6;font-size:.85rem;margin-bottom:16px">Run your first eval below or via the API to populate the cockpit.</div>
        </div>` : `
        <h3 style="margin:0 0 12px;font-size:1.1rem">Suite Health</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:24px">
          ${suiteCards}
        </div>`}

      <div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;margin-bottom:24px" class="ev-mid-grid">
        <div>
          <h3 style="margin:0 0 12px;font-size:1.1rem">Baseline Compare</h3>
          <div class="db-card" style="border-radius:12px;overflow:hidden">${compareHtml}</div>
        </div>
        <div>
          <h3 style="margin:0 0 12px;font-size:1.1rem">Run Eval</h3>
          <div class="db-card" style="border-radius:12px;padding:14px">
            <select id="ev-run-agent" style="width:100%;padding:8px;margin-bottom:8px;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px">
              <option value="">Agent…</option>${agentOptions}
            </select>
            <select id="ev-run-judge" style="width:100%;padding:8px;margin-bottom:8px;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px">
              <option value="">Judge…</option>${judgeOptions}
            </select>
            <textarea id="ev-run-input" placeholder="Input prompt" rows="2" style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px"></textarea>
            <textarea id="ev-run-output" placeholder="Agent output" rows="2" style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px"></textarea>
            <textarea id="ev-run-expected" placeholder="Expected answer" rows="2" style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px"></textarea>
            <div id="ev-run-error" style="display:none;color:#ef4444;font-size:.8rem;margin-bottom:8px"></div>
            <button id="ev-run-submit" ${runDisabled ? 'disabled' : ''} style="width:100%;padding:9px;background:${runDisabled ? 'rgba(168,85,247,.3)' : 'var(--db-accent,#a855f7)'};color:#fff;border:none;border-radius:8px;cursor:${runDisabled ? 'not-allowed' : 'pointer'};font-weight:600">Run eval</button>
          </div>
        </div>
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">Run History${evaluations.length ? ` (${evaluations.length})` : ''}</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden;overflow-x:auto">
        ${evaluations.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No evaluations recorded yet.</div>'
          : `<table style="width:100%;border-collapse:collapse;min-width:640px">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:8px 10px"></th>
                <th style="padding:8px 10px;text-align:left;font-size:.75rem;opacity:.6">Time</th>
                <th style="padding:8px 10px;text-align:left;font-size:.75rem;opacity:.6">Agent</th>
                <th style="padding:8px 10px;text-align:left;font-size:.75rem;opacity:.6">Evaluator</th>
                <th style="padding:8px 10px;text-align:center;font-size:.75rem;opacity:.6">Score</th>
                <th style="padding:8px 10px;text-align:center;font-size:.75rem;opacity:.6">Pass</th>
                <th style="padding:8px 10px;text-align:right;font-size:.75rem;opacity:.6">Actions</th>
              </tr></thead>
              <tbody>${historyRows}</tbody>
            </table>`
        }
      </div>
    </div>`;

  wire(container, ordered, scores);
}

function wire(container, ordered, scores) {
  container.querySelectorAll('.ev-filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const agent = btn.dataset.agent;
      const target = container.querySelector(`.ev-history-row td:nth-child(3)`);
      const first = [...container.querySelectorAll('.ev-history-row')].find(
        (r) => r.children[2]?.textContent?.trim() === agent);
      (first || target)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
  });

  container.querySelectorAll('.ev-history-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const idx = row.dataset.idx;
      const detail = container.querySelector(`.ev-detail-row[data-detail="${idx}"]`);
      if (detail) {
        const open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'table-row';
        row.children[0].textContent = open ? '▸' : '▾';
      }
    });
  });

  container.querySelectorAll('.ev-debug-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const session = btn.dataset.session;
      const hasRuns = window.aiui?.selectPage
        && document.querySelector('[data-page="runs"], [data-nav="runs"]');
      try {
        history.pushState({}, '', `/runs?session=${encodeURIComponent(session)}`);
      } catch (err) { /* ignore */ }
      navigate(hasRuns ? 'runs' : 'traces');
    });
  });

  container.querySelectorAll('.ev-pin-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ev = ordered[Number(btn.dataset.idx)];
      if (!ev) return;
      const agents = {};
      for (const s of scores) if (s.avg_score != null) agents[s.agent_id] = s.avg_score;
      saveBaseline({ id: ev.id, timestamp: ev.timestamp, agents });
      showToast(`Baseline set to ${ev.id}`, 'success');
      render(container);
    });
  });

  container.querySelector('#ev-clear-baseline')?.addEventListener('click', () => {
    clearBaseline();
    showToast('Baseline cleared', 'info');
    render(container);
  });

  const submit = container.querySelector('#ev-run-submit');
  submit?.addEventListener('click', async () => {
    if (submit.disabled) return;
    const errBox = container.querySelector('#ev-run-error');
    const agent = container.querySelector('#ev-run-agent')?.value || '';
    const evaluator = container.querySelector('#ev-run-judge')?.value || '';
    const input = container.querySelector('#ev-run-input')?.value?.trim() || '';
    const output = container.querySelector('#ev-run-output')?.value?.trim() || '';
    const expected = container.querySelector('#ev-run-expected')?.value?.trim() || '';
    if (!input) {
      if (errBox) { errBox.textContent = 'Input is required.'; errBox.style.display = 'block'; }
      return;
    }
    if (errBox) errBox.style.display = 'none';
    submit.disabled = true;
    submit.textContent = 'Running…';
    try {
      const res = await fetch('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent || 'ui', evaluator, input, output, expected }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Evaluation complete', 'success');
      render(container);
    } catch (err) {
      submit.disabled = false;
      submit.textContent = 'Run eval';
      if (errBox) { errBox.textContent = 'Run failed: ' + err.message; errBox.style.display = 'block'; }
    }
  });
}
