/**
 * Agents View — CRUD agent management
 * API: /api/agents
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';
  
  let agents = [];
  try {
    const res = await fetch('/api/agents');
    const data = await res.json();
    agents = data.agents || data || [];
    if (!Array.isArray(agents)) agents = Object.values(agents);
  } catch(e) { container.innerHTML = '<div class="db-viewer"><pre>Failed to load agents</pre></div>'; return; }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <span style="color:var(--db-text-dim);font-size:13px">${agents.length} agent(s)</span>
      <button id="agent-add-btn" style="background:var(--db-accent);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">+ New Agent</button>
    </div>
    <div id="agents-grid" class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))"></div>
    <div id="agent-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;display:none;align-items:center;justify-content:center"></div>
  `;

  const grid = container.querySelector('#agents-grid');
  agents.forEach(a => {
    const card = document.createElement('div');
    card.className = 'db-card';
    card.style.cursor = 'pointer';
    const name = a.name || a.id || 'Unnamed';
    const model = a.model || 'default';
    const icon = a.icon || '🤖';
    const desc = a.description || a.instructions || '';
    const tools = a.tools || [];
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:28px">${icon}</span>
        <div>
          <div style="font-weight:600;font-size:15px">${name}</div>
          <div style="font-size:12px;color:var(--db-text-dim)">${model}</div>
        </div>
      </div>
      ${desc ? `<div style="font-size:13px;color:var(--db-text-dim);margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${desc}</div>` : ''}
      ${tools.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${tools.map(t => `<span style="font-size:11px;padding:2px 8px;background:var(--db-hover);border-radius:12px;color:var(--db-text-dim)">${t}</span>`).join('')}</div>` : ''}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="agent-run-btn" data-id="${a.id||name}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">▶ Run</button>
        <button class="agent-del-btn" data-id="${a.id||name}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });

  if (agents.length === 0) {
    grid.innerHTML = '<div class="db-viewer"><pre>No agents configured. Click "+ New Agent" to create one.</pre></div>';
  }

  // Add agent button
  container.querySelector('#agent-add-btn')?.addEventListener('click', () => showAgentForm(container));

  // Delete handlers
  container.querySelectorAll('.agent-del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this agent?')) return;
      try { await fetch(`/api/agents/${btn.dataset.id}`, {method:'DELETE'}); render(container); } catch(e) {}
    });
  });
}

function showAgentForm(container) {
  const modal = container.querySelector('#agent-modal');
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;padding:28px;width:440px;max-height:80vh;overflow-y:auto">
      <h3 style="margin:0 0 20px;font-size:18px">New Agent</h3>
      <label style="display:block;margin-bottom:16px">
        <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Name</span>
        <input id="af-name" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box" />
      </label>
      <label style="display:block;margin-bottom:16px">
        <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Instructions</span>
        <textarea id="af-instructions" rows="3" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;resize:vertical;box-sizing:border-box"></textarea>
      </label>
      <label style="display:block;margin-bottom:20px">
        <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Model</span>
        <input id="af-model" value="gpt-4o-mini" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box" />
      </label>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="af-cancel" style="padding:8px 16px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="af-save" style="padding:8px 16px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer">Create</button>
      </div>
    </div>
  `;
  modal.querySelector('#af-cancel').addEventListener('click', () => modal.style.display = 'none');
  modal.querySelector('#af-save').addEventListener('click', async () => {
    const body = { name: modal.querySelector('#af-name').value, instructions: modal.querySelector('#af-instructions').value, model: modal.querySelector('#af-model').value };
    try { await fetch('/api/agents', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); modal.style.display='none'; render(container); } catch(e) { alert('Failed to create agent'); }
  });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}
