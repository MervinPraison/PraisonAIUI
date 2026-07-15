/**
 * Training Lab View — ML experiment tracker for praisonai-train agent sessions.
 * Mirrors the CLI workflow: list / show / apply.
 * API: /api/training/status, /api/training/sessions, /api/training/sessions/{id},
 *      /api/training/sessions/{id}/apply
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function relTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return esc(iso);
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function scoreColor(score) {
  if (score == null) return '#94a3b8';
  if (score >= 9) return '#22c55e';
  if (score >= 7) return '#f59e0b';
  return '#ef4444';
}

function fmtScore(s) {
  return s == null ? '—' : Number(s).toFixed(1);
}

function scoreChart(iterations) {
  const pts = iterations
    .map((it, i) => ({ x: i + 1, score: typeof it.score === 'number' ? it.score : null, best: it.is_best }))
    .filter((p) => p.score != null);
  if (pts.length === 0) {
    return '<div style="padding:24px;text-align:center;opacity:.5">No scored iterations to chart.</div>';
  }
  const W = 640, H = 220, pad = 36, maxY = 10;
  const n = pts.length;
  const xFor = (x) => pad + (n === 1 ? (W - 2 * pad) / 2 : ((x - 1) / (n - 1)) * (W - 2 * pad));
  const yFor = (s) => H - pad - (s / maxY) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.x).toFixed(1)},${yFor(p.score).toFixed(1)}`).join(' ');
  const thresholdY = yFor(9.5).toFixed(1);
  const dots = pts.map((p) => {
    const cx = xFor(p.x).toFixed(1), cy = yFor(p.score).toFixed(1);
    const c = scoreColor(p.score);
    const star = p.best
      ? `<text x="${cx}" y="${(yFor(p.score) - 12).toFixed(1)}" text-anchor="middle" font-size="14" fill="#6366f1">Best: #${p.x} (${fmtScore(p.score)})</text>`
      : '';
    return `<circle cx="${cx}" cy="${cy}" r="${p.best ? 6 : 4}" fill="${c}"><title>Iteration ${p.x} — ${fmtScore(p.score)}/10</title></circle>${star}`;
  }).join('');
  const yTicks = [0, 5, 10].map((t) => `<text x="${pad - 8}" y="${(yFor(t) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#94a3b8">${t}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="rgba(128,128,128,.3)"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="rgba(128,128,128,.3)"/>
    <line x1="${pad}" y1="${thresholdY}" x2="${W - pad}" y2="${thresholdY}" stroke="#6366f1" stroke-dasharray="4 4" opacity=".6"><title>Early-stop threshold 9.5</title></line>
    ${yTicks}
    <path d="${line}" fill="none" stroke="#6366f1" stroke-width="2"/>
    ${dots}
  </svg>`;
}

function iterationCard(it, idx) {
  const num = it.iteration_num != null ? it.iteration_num : idx + 1;
  const suggestions = it.suggestions || [];
  const bestTag = it.is_best ? '<span style="color:#6366f1;font-weight:600">* Best</span>' : '';
  const border = it.is_best ? 'border-left:3px solid #6366f1;' : '';
  return `<div class="db-card" style="padding:14px;border-radius:10px;margin-bottom:10px;${border}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="font-family:monospace">[#${num}]</span>
      <span style="font-weight:700;color:${scoreColor(it.score)}">${fmtScore(it.score)}/10</span>
      ${bestTag}
    </div>
    ${it.feedback ? `<div style="font-size:.85rem;opacity:.85;margin-bottom:6px">${esc(it.feedback)}</div>` : ''}
    ${suggestions.length ? `<details><summary style="cursor:pointer;font-size:.8rem;opacity:.7">${suggestions.length} suggestion(s)</summary>
      <ul style="margin:6px 0 0;padding-left:18px;font-size:.82rem">${suggestions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  const params = new URLSearchParams(window.location.search);
  let selectedId = params.get('session');
  const agentFilter = params.get('agent_id');

  let status = {}, sessions = [];
  try {
    const url = '/api/training/sessions' + (agentFilter ? `?agent_id=${encodeURIComponent(agentFilter)}` : '');
    const [sRes, lRes] = await Promise.all([fetch('/api/training/status'), fetch(url)]);
    status = await sRes.json();
    sessions = (await lRes.json()).sessions || [];
  } catch (e) {
    status = { status: 'error' };
  }

  if (!selectedId && sessions.length) selectedId = sessions[0].session_id;

  const statusStrip = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;margin-bottom:16px" class="db-card">
      <span style="font-size:.8rem">${status.train_package_available
        ? `<span style="color:#22c55e">● praisonai-train ${esc(status.train_package_version || '')}</span>`
        : '<span style="color:#f59e0b">● praisonai-train not installed</span>'}</span>
      <span style="font-size:.75rem;opacity:.6;font-family:monospace">${esc(status.storage_dir || '~/.praison/train')}</span>
      <span style="font-size:.75rem;opacity:.6">${status.session_count || 0} sessions</span>
      <span style="font-size:.7rem;padding:2px 8px;border-radius:6px;background:rgba(99,102,241,.15)" title="SQLite sessions not visible until PraisonAI #3041 is resolved">JSON</span>
      <button class="db-btn" style="margin-left:auto;font-size:.8rem" onclick="location.reload()">Refresh</button>
    </div>`;

  const emptyState = `
    <div class="db-card" style="padding:32px;border-radius:12px;text-align:center">
      <div style="font-size:1.1rem;margin-bottom:10px">No training sessions yet</div>
      <div style="opacity:.7;font-size:.85rem;margin-bottom:12px">Run a training session from the CLI:</div>
      <pre style="text-align:left;display:inline-block;background:rgba(0,0,0,.25);padding:12px 16px;border-radius:8px;font-size:.8rem">praisonai-train agents --input "..." --iterations 3</pre>
    </div>`;

  if (!sessions.length) {
    container.innerHTML = `<div style="padding:24px;max-width:1200px;margin:0 auto">
      <h2 style="margin:0 0 16px;font-size:1.5rem">Training Lab</h2>${statusStrip}${emptyState}</div>`;
    return;
  }

  const sidebar = sessions.map((s) => {
    const active = s.session_id === selectedId;
    const early = s.early_stopped
      ? `<span style="font-size:.7rem;padding:1px 6px;border-radius:6px;background:rgba(245,158,11,.2);color:#f59e0b">${s.completed_iterations}/${s.requested_iterations}</span>` : '';
    const incomplete = s.completed_iterations === 0 ? 'opacity:.5;' : '';
    return `<div class="db-card training-session" data-session="${esc(s.session_id)}" style="padding:10px 12px;border-radius:8px;margin-bottom:8px;cursor:pointer;${incomplete}${active ? 'outline:2px solid #6366f1;' : ''}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-family:monospace;font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.session_id)}</span>
        <span style="margin-left:auto;font-weight:700;color:${scoreColor(s.avg_score)}">${fmtScore(s.avg_score)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:.7rem;opacity:.7">
        <span>${s.completed_iterations} iter${s.completed_iterations === 1 ? '' : 's'}</span>
        ${early}
        <span>${esc(s.status_label)}</span>
        <span style="margin-left:auto">${relTime(s.modified_at)}</span>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="padding:24px;max-width:1280px;margin:0 auto">
      <h2 style="margin:0 0 16px;font-size:1.5rem">Training Lab</h2>
      ${statusStrip}
      <div class="training-grid" style="display:grid;grid-template-columns:280px 1fr;gap:20px">
        <div>${sidebar}</div>
        <div id="training-detail"><div class="db-loading"><div class="db-spinner"></div></div></div>
      </div>
    </div>
    <style>@media (max-width:768px){.training-grid{grid-template-columns:1fr !important}}</style>`;

  const detailEl = container.querySelector('#training-detail');

  async function loadDetail(sessionId) {
    detailEl.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';
    let d;
    try {
      const res = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) { detailEl.innerHTML = `<div class="db-card" style="padding:24px">Failed to load session (${res.status}).</div>`; return; }
      d = await res.json();
    } catch (e) {
      detailEl.innerHTML = '<div class="db-card" style="padding:24px">Error loading session.</div>';
      return;
    }

    const iterations = d.iterations || [];
    const earlyBadge = d.early_stopped
      ? `<span title="LLM-as-judge stops when an iteration scores >= 9.5. This session reached ${fmtScore(d.avg_score)}." style="padding:4px 10px;border-radius:8px;background:rgba(245,158,11,.2);color:#f59e0b;font-size:.8rem">Early stop: ${d.completed_iterations} of ${d.requested_iterations} requested</span>`
      : '';
    const iterCard = d.early_stopped
      ? `<span style="color:#f59e0b">${d.completed_iterations} / ${d.requested_iterations}</span>`
      : `${d.completed_iterations}`;

    const hero = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px">
        <div class="db-card" style="padding:14px;border-radius:10px"><div style="font-size:.75rem;opacity:.6">Average score</div><div style="font-size:1.6rem;font-weight:700;color:${scoreColor(d.avg_score)}">${fmtScore(d.avg_score)}</div></div>
        <div class="db-card" style="padding:14px;border-radius:10px"><div style="font-size:.75rem;opacity:.6">Improvement</div><div style="font-size:1.6rem;font-weight:700">${d.improvement == null ? '—' : (d.improvement >= 0 ? '+' : '') + Number(d.improvement).toFixed(1)}</div></div>
        <div class="db-card" style="padding:14px;border-radius:10px"><div style="font-size:.75rem;opacity:.6">Iterations</div><div style="font-size:1.6rem;font-weight:700">${iterCard}</div></div>
        <div class="db-card" style="padding:14px;border-radius:10px"><div style="font-size:.75rem;opacity:.6">Status</div><div style="font-size:1rem;font-weight:600;margin-top:6px">${esc(d.passed === true ? 'PASSED' : d.passed === false ? 'NEEDS WORK' : 'UNKNOWN')}</div></div>
      </div>`;

    const canApply = d.passed === true || (typeof d.avg_score === 'number' && d.avg_score >= 7);
    const applyBar = canApply ? `
      <div class="db-card" style="position:sticky;bottom:0;padding:14px;border-radius:10px;margin-top:16px;display:flex;flex-wrap:wrap;align-items:center;gap:10px">
        <select id="training-agent" style="padding:6px 10px;border-radius:8px"><option value="">Select agent…</option></select>
        <span style="font-size:.8rem;opacity:.7">Best: iter #${d.best_iteration_num != null ? d.best_iteration_num : '—'}</span>
        <button id="training-apply" class="db-btn" style="margin-left:auto">Apply profile to agent</button>
      </div>` : '';

    detailEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-family:monospace">${esc(d.session_id)}</span>
        ${earlyBadge}
      </div>
      ${hero}
      <h3 style="margin:0 0 8px;font-size:1.05rem">Iteration scores</h3>
      <div class="db-card" style="padding:12px;border-radius:10px;margin-bottom:16px">${scoreChart(iterations)}</div>
      <h3 style="margin:0 0 8px;font-size:1.05rem">Iterations</h3>
      ${iterations.map((it, i) => iterationCard(it, i)).join('')}
      ${applyBar}`;

    if (canApply) await wireApply(d);
  }

  async function wireApply(d) {
    const sel = detailEl.querySelector('#training-agent');
    const btn = detailEl.querySelector('#training-apply');
    if (!sel || !btn) return;
    try {
      const res = await fetch('/api/agents/definitions');
      const agents = (await res.json()).agents || [];
      sel.innerHTML = '<option value="">Select agent…</option>' +
        agents.map((a) => {
          const id = a.id || a.agent_id || '';
          return `<option value="${esc(id)}">${esc(a.name || id)}</option>`;
        }).join('');
    } catch (e) { /* keep placeholder */ }

    btn.addEventListener('click', async () => {
      const agentId = sel.value;
      if (!agentId) { btn.textContent = 'Select an agent first'; return; }
      btn.disabled = true; btn.textContent = 'Applying…';
      try {
        const res = await fetch(`/api/training/sessions/${encodeURIComponent(d.session_id)}/apply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, iteration: null }),
        });
        const out = await res.json();
        if (res.ok && out.success) {
          btn.textContent = `Applied (${esc(out.hook_id)})`;
        } else {
          btn.disabled = false;
          btn.textContent = `Failed: ${esc(out.error || res.status)}`;
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Apply failed';
      }
    });
  }

  container.querySelectorAll('.training-session').forEach((el) => {
    el.addEventListener('click', () => {
      selectedId = el.getAttribute('data-session');
      container.querySelectorAll('.training-session').forEach((n) => { n.style.outline = 'none'; });
      el.style.outline = '2px solid #6366f1';
      const u = new URL(window.location.href);
      u.searchParams.set('session', selectedId);
      history.replaceState(null, '', u.toString());
      loadDetail(selectedId);
    });
  });

  if (selectedId) await loadDetail(selectedId);
}
