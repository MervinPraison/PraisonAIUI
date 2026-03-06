/**
 * Channels View — multi-platform messaging channel management
 * API: /api/channels
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let channels = [], platforms = [];
  try { const r = await fetch('/api/channels'); const d = await r.json(); channels = d.channels || d || []; if (!Array.isArray(channels)) channels = Object.entries(channels).map(([id,c]) => ({id,...(typeof c==='object'?c:{platform:c})})); } catch(e) {}
  try { const r = await fetch('/api/channels/platforms'); const d = await r.json(); platforms = d.platforms || d || []; } catch(e) {}

  const platformIcons = { discord: '🎮', slack: '💬', telegram: '✈️', whatsapp: '📱', imessage: '🍎', signal: '🔒', googlechat: '💼', nostr: '🟣' };

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <span style="color:var(--db-text-dim);font-size:13px">${channels.length} channel(s) · ${platforms.length} platforms supported</span>
      <button id="ch-add" style="background:var(--db-accent);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">+ Add Channel</button>
    </div>
    <div id="ch-grid" class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))"></div>
    <div id="ch-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center"></div>
  `;

  const grid = container.querySelector('#ch-grid');
  channels.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'db-card';
    const platform = ch.platform || ch.type || ch.id || '';
    const icon = platformIcons[platform.toLowerCase()] || '📡';
    const enabled = ch.enabled !== false;
    const status = ch.status || (enabled ? 'connected' : 'disconnected');
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:28px">${icon}</span>
        <div style="flex:1">
          <div style="font-weight:600;font-size:15px">${ch.name || ch.id || platform}</div>
          <div style="font-size:12px;color:var(--db-text-dim)">${platform}</div>
        </div>
        <span style="font-size:11px;padding:3px 10px;border-radius:12px;${status === 'connected' || status === 'running' ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${status}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="ch-toggle" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">${enabled ? 'Disable' : 'Enable'}</button>
        <button class="ch-restart" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">⟳ Restart</button>
        <button class="ch-del" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });

  if (channels.length === 0) grid.innerHTML = '<div class="db-viewer"><pre>No channels configured</pre></div>';

  container.querySelectorAll('.ch-toggle').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/channels/${b.dataset.id}/toggle`, {method:'POST'}); render(container); } catch(e){} }));
  container.querySelectorAll('.ch-restart').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/channels/${b.dataset.id}/restart`, {method:'POST'}); } catch(e){} }));
  container.querySelectorAll('.ch-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete channel?')) return; try { await fetch(`/api/channels/${b.dataset.id}`, {method:'DELETE'}); render(container); } catch(e){} }));

  container.querySelector('#ch-add')?.addEventListener('click', () => {
    const m = container.querySelector('#ch-modal'); m.style.display = 'flex';
    m.innerHTML = `<div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;padding:28px;width:420px">
      <h3 style="margin:0 0 20px;font-size:18px">Add Channel</h3>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Platform</span>
        <select id="chf-platform" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box">
          ${(Array.isArray(platforms) ? platforms : Object.keys(platformIcons)).map(p => `<option value="${p}">${platformIcons[p]||'📡'} ${p}</option>`).join('')}
        </select></label>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Name</span><input id="chf-name" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <label style="display:block;margin-bottom:20px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Token</span><input id="chf-token" type="password" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="chf-cancel" style="padding:8px 16px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="chf-save" style="padding:8px 16px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer">Add</button>
      </div></div>`;
    m.querySelector('#chf-cancel').addEventListener('click', () => m.style.display = 'none');
    m.querySelector('#chf-save').addEventListener('click', async () => {
      const body = { platform: m.querySelector('#chf-platform').value, name: m.querySelector('#chf-name').value, token: m.querySelector('#chf-token').value };
      try { await fetch('/api/channels', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); m.style.display='none'; render(container); } catch(e){}
    });
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });
}
