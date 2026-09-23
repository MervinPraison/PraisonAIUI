/**
 * Approvals View — execution approval queue
 * API: /api/approvals
 *
 * Pending items render as an Approval Card (human-in-the-loop): risk, question,
 * optional preset options / custom answer / confidence copy — surfaced only when
 * the API supplies them, so the card stays a plain approve/deny prompt otherwise.
 */
import { isSkillApproval, esc, emptyState } from '/plugins/views/_helpers.js';

const RISK = {
  low: { icon: '✅', color: '#22c55e' },
  medium: { icon: '⚠️', color: '#eab308' },
  high: { icon: '🟠', color: '#f97316' },
  critical: { icon: '🔴', color: '#ef4444' },
};

/**
 * Normalise a raw /api/approvals item into an ApprovalPromptModel-shaped object.
 * Keeps the field-mapping in one place; only carries what the API actually sends.
 */
function toApprovalModel(a) {
  const id = a.id || a.approval_id || '';
  const risk = String(a.risk_level || '').toLowerCase();
  const options = Array.isArray(a.options)
    ? a.options.map(o => (typeof o === 'string' ? { value: o, label: o } : { value: o.value ?? o.id ?? o.label, label: o.label ?? String(o.value ?? o.id) }))
    : [];
  const confidence = typeof a.confidence === 'number' ? Math.round(a.confidence * (a.confidence <= 1 ? 100 : 1)) : null;
  return {
    id,
    title: a.tool_name || a.action || 'Unknown',
    question: a.reason || a.description || a.question || '',
    agent: a.agent_name || '',
    risk,
    riskMeta: RISK[risk] || { icon: '❓', color: 'var(--db-text-dim)' },
    createdAt: a.created_at ? new Date(a.created_at * 1000).toLocaleString() : '',
    options,
    allowCustom: a.allow_custom_answer === true || (options.length === 0 && a.custom_answer !== false && !!a.question),
    confidence,
    isSkill: isSkillApproval(a),
  };
}

function approvalCard(m) {
  const optionsHtml = m.options.length
    ? `<div class="db-approval-options" role="radiogroup" aria-label="Response options" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
        ${m.options.map((o, i) => `
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border:1px solid var(--db-border);border-radius:6px;cursor:pointer">
            <input type="radio" name="opt-${esc(m.id)}" value="${esc(o.value)}" ${i === 0 ? 'checked' : ''}> ${esc(o.label)}
          </label>`).join('')}
      </div>`
    : '';
  const customHtml = m.allowCustom
    ? `<input class="approv-custom" data-id="${esc(m.id)}" type="text" placeholder="Custom answer (optional)"
        aria-label="Custom answer for ${esc(m.title)}"
        style="margin-top:10px;width:100%;padding:6px 10px;font-size:12px;background:var(--db-bg);color:var(--db-text);border:1px solid var(--db-border);border-radius:6px">`
    : '';
  const confidenceHtml = m.confidence != null
    ? `<div style="font-size:11px;color:var(--db-text-dim);margin-top:6px">Model confidence: ${m.confidence}%</div>`
    : '';
  const skillHtml = m.isSkill
    ? `<a href="/skills?tab=pending&approval_id=${encodeURIComponent(m.id)}" data-skill-studio="1" style="display:inline-block;margin-top:8px;font-size:11px;color:var(--db-accent);text-decoration:none">Skill write? Open Skills Studio →</a>`
    : '';

  return `
    <div class="db-card db-approval-card" data-id="${esc(m.id)}" role="group"
         aria-label="Approval request: ${esc(m.title)}"
         style="margin-bottom:12px;padding:16px 20px;border-left:3px solid ${m.riskMeta.color}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${m.riskMeta.icon} ${esc(m.title)}</div>
          ${m.question ? `<div style="font-size:13px;color:var(--db-text);margin-top:6px">${esc(m.question)}</div>` : ''}
          <div style="font-size:12px;color:var(--db-text-dim);margin-top:4px">Agent: ${esc(m.agent) || '—'}${m.risk ? ` · risk: ${esc(m.risk)}` : ''}</div>
          ${m.createdAt ? `<div style="font-size:11px;color:var(--db-text-dim)">${esc(m.createdAt)}</div>` : ''}
          ${optionsHtml}
          ${customHtml}
          ${confidenceHtml}
          ${skillHtml}
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="approv-yes" data-id="${esc(m.id)}" aria-label="Approve ${esc(m.title)}"
            style="padding:6px 16px;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:6px;cursor:pointer;font-size:12px">✓ Approve</button>
          <button class="approv-no" data-id="${esc(m.id)}" aria-label="Deny ${esc(m.title)}"
            style="padding:6px 16px;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:6px;cursor:pointer;font-size:12px">✗ Deny</button>
        </div>
      </div>
    </div>`;
}

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let pending = [], history = [], policies = {};
  try { const r = await fetch('/api/approvals/pending'); pending = (await r.json()).approvals || []; } catch(e) {}
  try { const r = await fetch('/api/approvals/history'); const d = await r.json(); history = d.approvals || d.history || []; } catch(e) {}
  try { const r = await fetch('/api/approvals/policies'); policies = await r.json(); } catch(e) {}

  const models = pending.map(toApprovalModel);

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Pending</div><div class="db-card-value" style="color:#eab308">${models.length}</div></div>
      <div class="db-card"><div class="db-card-title">Risk Threshold</div><div class="db-card-value" style="font-size:18px">${esc(policies.risk_threshold || 'high')}</div></div>
      <div class="db-card"><div class="db-card-title">Auto-Approve Tools</div><div class="db-card-value" style="font-size:18px">${(policies.auto_approve_tools || []).length}</div></div>
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Pending Approvals</h3>
    <div id="approv-pending" style="margin-bottom:28px">
      ${models.length === 0 ? emptyState({ icon: '✅', title: 'No pending approvals', body: 'All clear — nothing needs your decision.' }) : models.map(approvalCard).join('')}
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Recent History</h3>
    <div id="approv-history"></div>
  `;

  function collectExtra(id) {
    const card = container.querySelector(`.db-approval-card[data-id="${CSS.escape(id)}"]`);
    const body = {};
    if (!card) return body;
    const opt = card.querySelector(`input[name="opt-${CSS.escape(id)}"]:checked`);
    if (opt) body.option = opt.value;
    const custom = card.querySelector('.approv-custom');
    if (custom && custom.value.trim()) body.custom_answer = custom.value.trim();
    return body;
  }

  async function decide(id, action) {
    try {
      await fetch(`/api/approvals/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectExtra(id)),
      });
      render(container);
    } catch(e) {}
  }

  container.querySelectorAll('.approv-yes').forEach(b => b.addEventListener('click', () => decide(b.dataset.id, 'approve')));
  container.querySelectorAll('.approv-no').forEach(b => b.addEventListener('click', () => decide(b.dataset.id, 'deny')));

  const historyEl = container.querySelector('#approv-history');
  (Array.isArray(history) ? history : []).slice(0, 20).forEach(h => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:8px 0;border-bottom:1px solid var(--db-border);font-size:13px;display:flex;justify-content:space-between';
    const approved = h.status === 'approved' || h.approved;
    div.innerHTML = `<span>${esc(h.tool_name || h.action || '?')} — ${esc(h.agent_name || '')}</span><span style="color:${approved ? '#22c55e' : '#ef4444'}">${approved ? '✓ approved' : '✗ denied'}</span>`;
    historyEl.appendChild(div);
  });
  if (!history.length) historyEl.innerHTML = '<div style="font-size:13px;color:var(--db-text-dim)">No history</div>';
}
