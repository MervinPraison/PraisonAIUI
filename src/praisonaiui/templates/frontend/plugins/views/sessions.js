/**
 * Sessions View — Session list with inline editing, filters, and usage.
 *
 * Enhanced with: inline label editing, per-session usage/token counts,
 *                active/closed filter, agent filter, delete action, link to chat.
 *
 * API: /api/sessions, /api/sessions/{id}/state, /api/sessions/{id}/preview,
 *      /api/sessions/{id}/labels, /api/sessions/{id}/usage
 */
import { showConfirm } from '../toast.js';

let filterStatus = 'all';
let filterAgent = '';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let sessions = [];
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    sessions = data.sessions || data || [];
    if (!Array.isArray(sessions)) sessions = Object.entries(sessions).map(([id,s]) => ({id,...(typeof s === 'object' ? s : {status:s})}));
  } catch(e) {}

  // Collect unique agents for filter
  const agentNames = [...new Set(sessions.map(s => s.agent_id || s.agent || '').filter(Boolean))];

  // Apply filters
  let filtered = sessions;
  if (filterStatus === 'active') filtered = filtered.filter(s => s.is_active !== false);
  if (filterStatus === 'closed') filtered = filtered.filter(s => s.is_active === false);
  if (filterAgent) filtered = filtered.filter(s => (s.agent_id || s.agent || '') === filterAgent);

  container.innerHTML = `
    <!-- Controls -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap">
      <div style="display:flex;gap:6px;align-items:center">
        ${['all','active','closed'].map(s => `<button class="sess-filter-btn" data-filter="${s}" style="padding:5px 14px;border:1px solid var(--db-border);background:${filterStatus===s?'var(--db-accent)':'transparent'};color:${filterStatus===s?'#fff':'var(--db-text)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">${s.charAt(0).toUpperCase()+s.slice(1)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="sess-agent-filter" style="padding:5px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:12px">
          <option value="">All Agents</option>
          ${agentNames.map(a => `<option value="${a}"${filterAgent===a?' selected':''}>${a}</option>`).join('')}
        </select>
        <span style="color:var(--db-text-dim);font-size:13px">${filtered.length} of ${sessions.length} session(s)</span>
      </div>
    </div>

    <!-- Split layout -->
    <div style="display:flex;gap:20px;height:calc(100vh - 230px)">
      <div id="sess-list" style="width:380px;overflow-y:auto;padding-right:8px"></div>
      <div id="sess-detail" style="flex:1;overflow-y:auto">
        <div class="db-viewer"><pre>Select a session to view details</pre></div>
      </div>
    </div>
  `;

  // Bind filters
  container.querySelectorAll('.sess-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => { filterStatus = btn.dataset.filter; render(container); });
  });
  container.querySelector('#sess-agent-filter')?.addEventListener('change', (e) => {
    filterAgent = e.target.value;
    render(container);
  });

  // Populate list
  const list = container.querySelector('#sess-list');
  filtered.forEach(s => {
    const item = document.createElement('div');
    item.className = 'db-card';
    item.style.cssText = 'cursor:pointer;margin-bottom:8px;padding:12px 16px;transition:all .15s';
    const id = s.id || s.session_id || 'unknown';
    const agent = s.agent_id || s.agent || '';
    const active = s.is_active !== false;
    const created = s.created_at ? new Date(typeof s.created_at === 'number' ? s.created_at * 1000 : s.created_at).toLocaleString() : '';
    const label = s.label || s.name || '';
    const tokens = (s.input_tokens || 0) + (s.output_tokens || 0);

    item.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label || id.substring(0,12) + '…'}</span>
          <span style="font-size:10px;padding:2px 6px;border-radius:8px;flex-shrink:0;${active ? 'background:rgba(34,197,94,.15);color:#22c55e' : 'background:rgba(239,68,68,.15);color:#ef4444'}">${active ? 'active' : 'closed'}</span>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="sess-chat-link" data-id="${id}" style="font-size:10px;padding:2px 8px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:4px;cursor:pointer" title="Open in Chat">💬</button>
          <button class="sess-delete-btn" data-id="${id}" style="font-size:10px;padding:2px 8px;border:1px solid rgba(239,68,68,.3);background:transparent;color:#ef4444;border-radius:4px;cursor:pointer" title="Delete">✕</button>
        </div>
      </div>
      ${agent ? `<div style="font-size:11px;color:var(--db-text-dim);margin-top:4px">🤖 ${agent}</div>` : ''}
      <div style="font-size:11px;color:var(--db-text-dim);margin-top:2px;display:flex;gap:12px">
        ${created ? `<span>${created}</span>` : ''}
        ${tokens > 0 ? `<span>📊 ${tokens.toLocaleString()} tokens</span>` : ''}
      </div>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.sess-delete-btn') || e.target.closest('.sess-chat-link')) return;
      showSessionDetail(container, s);
      list.querySelectorAll('.db-card').forEach(c => c.style.borderColor = '');
      item.style.borderColor = 'var(--db-accent)';
    });
    list.appendChild(item);
  });

  if (filtered.length === 0) list.innerHTML = '<div class="db-viewer"><pre>No sessions match filters</pre></div>';

  // Delete buttons
  container.querySelectorAll('.sess-delete-btn').forEach(b => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await showConfirm('Delete Session', 'Delete this session?')) return;
      try { await fetch(`/api/sessions/${b.dataset.id}`, {method:'DELETE'}); render(container); } catch(e) {}
    });
  });

  // Chat link buttons
  container.querySelectorAll('.sess-chat-link').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      // Navigate to chat page with session ID
      window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { page: 'chat', session: b.dataset.id } }));
    });
  });
}

async function showSessionDetail(container, session) {
  const detail = container.querySelector('#sess-detail');
  const id = session.id || session.session_id;
  detail.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let state = {}, preview = {}, labels = {}, usage = {};
  try { const r = await fetch(`/api/sessions/${id}/state`); state = await r.json(); } catch(e) {}
  try { const r = await fetch(`/api/sessions/${id}/preview`); preview = await r.json(); } catch(e) {}
  try { const r = await fetch(`/api/sessions/${id}/labels`); labels = await r.json(); } catch(e) {}
  try { const r = await fetch(`/api/sessions/${id}/usage`); usage = await r.json(); } catch(e) {}

  const currentLabel = labels.label || session.label || session.name || '';

  detail.innerHTML = `
    <h3 style="font-size:16px;margin:0 0 16px">Session: ${id}</h3>

    <!-- Inline Label Editor -->
    <div class="db-card" style="margin-bottom:16px;padding:14px 18px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:12px;color:var(--db-text-dim);font-weight:600">Label:</span>
        <input id="sess-label-input" value="${currentLabel}" placeholder="Add a label…" style="flex:1;padding:6px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:13px">
        <button id="sess-save-label" style="padding:6px 14px;background:var(--db-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">Save</button>
      </div>
    </div>

    <!-- Usage Stats -->
    ${usage && (usage.input_tokens || usage.output_tokens || usage.cost) ? `
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="db-card"><div class="db-card-title">Input Tokens</div><div style="font-size:20px;font-weight:700;margin-top:6px">${(usage.input_tokens || 0).toLocaleString()}</div></div>
      <div class="db-card"><div class="db-card-title">Output Tokens</div><div style="font-size:20px;font-weight:700;margin-top:6px">${(usage.output_tokens || 0).toLocaleString()}</div></div>
      <div class="db-card"><div class="db-card-title">Cost</div><div style="font-size:20px;font-weight:700;margin-top:6px">$${(usage.cost || 0).toFixed(4)}</div></div>
    </div>` : ''}

    <!-- State & Preview -->
    <div class="db-columns" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
      <div class="db-card">
        <div class="db-card-title">State</div>
        <pre style="font-size:12px;color:var(--db-text-dim);margin:8px 0 0;white-space:pre-wrap;max-height:300px;overflow-y:auto">${JSON.stringify(state, null, 2)}</pre>
      </div>
      <div class="db-card">
        <div class="db-card-title">Preview</div>
        <pre style="font-size:12px;color:var(--db-text-dim);margin:8px 0 0;white-space:pre-wrap;max-height:300px;overflow-y:auto">${JSON.stringify(preview, null, 2)}</pre>
      </div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:8px">
      <button id="sess-compact" style="font-size:12px;padding:6px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">📦 Compact</button>
      <button id="sess-reset" style="font-size:12px;padding:6px 14px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">🗑 Reset Session</button>
    </div>
  `;

  // Save label
  detail.querySelector('#sess-save-label')?.addEventListener('click', async () => {
    const label = detail.querySelector('#sess-label-input').value.trim();
    try {
      await fetch(`/api/sessions/${id}/labels`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({label}) });
      render(container);
    } catch(e) {}
  });

  detail.querySelector('#sess-reset')?.addEventListener('click', async () => {
    if (!await showConfirm('Reset Session', 'Reset this session? All messages will be cleared.')) return;
    try { await fetch(`/api/sessions/${id}/reset`, {method:'POST'}); render(container); } catch(e) {}
  });
  detail.querySelector('#sess-compact')?.addEventListener('click', async () => {
    try { await fetch(`/api/sessions/${id}/compact`, {method:'POST'}); showSessionDetail(container, session); } catch(e) {}
  });
}
