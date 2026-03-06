/**
 * Approvals View — execution approval queue
 * API: /api/approvals
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let pending = [], history = [], policies = {};
  try { const r = await fetch('/api/approvals/pending'); pending = (await r.json()).approvals || []; } catch(e) {}
  try { const r = await fetch('/api/approvals/history'); history = (await r.json()).approvals || (await r.json()).history || []; } catch(e) {}
  try { const r = await fetch('/api/approvals/policies'); policies = await r.json(); } catch(e) {}

  const riskIcons = { low: '✅', medium: '⚠️', high: '🟠', critical: '🔴' };

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Pending</div><div class="db-card-value" style="color:#eab308">${pending.length}</div></div>
      <div class="db-card"><div class="db-card-title">Risk Threshold</div><div class="db-card-value" style="font-size:18px">${policies.risk_threshold || 'high'}</div></div>
      <div class="db-card"><div class="db-card-title">Auto-Approve Tools</div><div class="db-card-value" style="font-size:18px">${(policies.auto_approve_tools || []).length}</div></div>
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Pending Approvals</h3>
    <div id="approv-pending" style="margin-bottom:28px">
      ${pending.length === 0 ? '<div class="db-viewer"><pre>No pending approvals</pre></div>' : ''}
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Recent History</h3>
    <div id="approv-history"></div>
  `;

  const pendingEl = container.querySelector('#approv-pending');
  pending.forEach(a => {
    const card = document.createElement('div');
    card.className = 'db-card';
    card.style.cssText = 'margin-bottom:10px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between';
    card.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:500;font-size:14px">${riskIcons[a.risk_level] || '❓'} ${a.tool_name || a.action || 'Unknown'}</div>
        <div style="font-size:12px;color:var(--db-text-dim);margin-top:4px">Agent: ${a.agent_name || '—'} · ${a.reason || ''}</div>
        <div style="font-size:11px;color:var(--db-text-dim)">${a.created_at ? new Date(a.created_at * 1000).toLocaleString() : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="approv-yes" data-id="${a.id || a.approval_id}" style="padding:6px 16px;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:6px;cursor:pointer;font-size:12px">✓ Approve</button>
        <button class="approv-no" data-id="${a.id || a.approval_id}" style="padding:6px 16px;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:6px;cursor:pointer;font-size:12px">✗ Deny</button>
      </div>
    `;
    pendingEl.appendChild(card);
  });

  container.querySelectorAll('.approv-yes').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/approvals/${b.dataset.id}/approve`, {method:'POST'}); render(container); } catch(e){} }));
  container.querySelectorAll('.approv-no').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/approvals/${b.dataset.id}/deny`, {method:'POST'}); render(container); } catch(e){} }));

  const historyEl = container.querySelector('#approv-history');
  (Array.isArray(history) ? history : []).slice(0, 20).forEach(h => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--db-border);font-size:13px;display:flex;justify-content:space-between';
    const approved = h.status === 'approved' || h.approved;
    div.innerHTML = `<span>${h.tool_name || h.action || '?'} — ${h.agent_name || ''}</span><span style="color:${approved ? '#22c55e' : '#ef4444'}">${approved ? '✓ approved' : '✗ denied'}</span>`;
    historyEl.appendChild(div);
  });
  if (!history.length) historyEl.innerHTML = '<div style="font-size:13px;color:var(--db-text-dim)">No history</div>';
}
