/**
 * Sessions View — session list + detail panel
 * API: /api/sessions
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let sessions = [];
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    sessions = data.sessions || data || [];
    if (!Array.isArray(sessions)) sessions = Object.entries(sessions).map(([id,s]) => ({id,...(typeof s === 'object' ? s : {status:s})}));
  } catch(e) {}

  container.innerHTML = `
    <div style="display:flex;gap:20px;height:calc(100vh - 200px)">
      <div id="sess-list" style="width:340px;overflow-y:auto;border-right:1px solid var(--db-border);padding-right:16px">
        <div style="margin-bottom:12px;font-size:13px;color:var(--db-text-dim)">${sessions.length} session(s)</div>
        ${sessions.length === 0 ? '<div class="db-viewer"><pre>No sessions found</pre></div>' : ''}
      </div>
      <div id="sess-detail" style="flex:1;overflow-y:auto">
        <div class="db-viewer"><pre>Select a session to view details</pre></div>
      </div>
    </div>
  `;

  const list = container.querySelector('#sess-list');
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'db-card';
    item.style.cssText = 'cursor:pointer;margin-bottom:8px;padding:12px 16px';
    const id = s.id || s.session_id || 'unknown';
    const agent = s.agent_id || s.agent || '';
    const active = s.is_active !== false;
    const created = s.created_at ? new Date(s.created_at * 1000).toLocaleString() : '';
    item.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;font-weight:500">${id.substring(0,12)}…</div>
        <span style="font-size:11px;padding:2px 8px;border-radius:12px;${active ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${active ? 'active' : 'closed'}</span>
      </div>
      ${agent ? `<div style="font-size:11px;color:var(--db-text-dim);margin-top:4px">Agent: ${agent}</div>` : ''}
      ${created ? `<div style="font-size:11px;color:var(--db-text-dim);margin-top:2px">${created}</div>` : ''}
    `;
    item.addEventListener('click', () => showSessionDetail(container, s));
    list.appendChild(item);
  });
}

async function showSessionDetail(container, session) {
  const detail = container.querySelector('#sess-detail');
  const id = session.id || session.session_id;
  detail.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let state = {}, preview = {};
  try { const r = await fetch(`/api/sessions/${id}/state`); state = await r.json(); } catch(e) {}
  try { const r = await fetch(`/api/sessions/${id}/preview`); preview = await r.json(); } catch(e) {}

  detail.innerHTML = `
    <h3 style="font-size:16px;margin:0 0 16px">Session: ${id}</h3>
    <div class="db-columns" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
      <div class="db-card">
        <div class="db-card-title">State</div>
        <pre style="font-size:12px;color:var(--db-text-dim);margin:8px 0 0;white-space:pre-wrap">${JSON.stringify(state, null, 2)}</pre>
      </div>
      <div class="db-card">
        <div class="db-card-title">Preview</div>
        <pre style="font-size:12px;color:var(--db-text-dim);margin:8px 0 0;white-space:pre-wrap">${JSON.stringify(preview, null, 2)}</pre>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="sess-reset" style="font-size:12px;padding:6px 14px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">Reset Session</button>
      <button id="sess-compact" style="font-size:12px;padding:6px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">Compact</button>
    </div>
  `;

  detail.querySelector('#sess-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset this session?')) return;
    try { await fetch(`/api/sessions/${id}/reset`, {method:'POST'}); render(container); } catch(e) {}
  });
  detail.querySelector('#sess-compact')?.addEventListener('click', async () => {
    try { await fetch(`/api/sessions/${id}/compact`, {method:'POST'}); showSessionDetail(container, session); } catch(e) {}
  });
}
