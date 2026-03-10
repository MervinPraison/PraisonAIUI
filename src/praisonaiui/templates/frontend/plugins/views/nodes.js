/**
 * Nodes View — execution nodes and instance presence
 * API: /api/nodes, /api/nodes/instances
 */
import { showConfirm } from '../toast.js';
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let nodes = [], instances = [];
  try { const r = await fetch('/api/nodes'); const d = await r.json(); nodes = d.nodes || d || []; if (!Array.isArray(nodes)) nodes = Object.entries(nodes).map(([id,n]) => ({id,...(typeof n==='object'?n:{status:n})})); } catch(e) {}
  try { const r = await fetch('/api/nodes/instances'); const d = await r.json(); instances = d.instances || d || []; if (!Array.isArray(instances)) instances = Object.entries(instances).map(([id,i]) => ({id,...(typeof i==='object'?i:{status:i})})); } catch(e) {}

  const online = nodes.filter(n => n.status === 'online' || n.status === 'healthy').length;

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Nodes</div><div class="db-card-value">${nodes.length}</div><div class="db-card-footer">${online} online</div></div>
      <div class="db-card"><div class="db-card-title">Instances</div><div class="db-card-value">${instances.length}</div></div>
      <div class="db-card"><div class="db-card-title">Health</div><div class="db-card-value">${nodes.length > 0 ? Math.round(online/nodes.length*100) : 0}%</div></div>
    </div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Execution Nodes</h3>
    <div id="nodes-list" style="margin-bottom:24px"></div>

    <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Connected Instances</h3>
    <div id="instances-list"></div>
  `;

  const nodesList = container.querySelector('#nodes-list');
  nodes.forEach(n => {
    const card = document.createElement('div');
    card.className = 'db-card';
    card.style.cssText = 'margin-bottom:10px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between';
    const isOnline = n.status === 'online' || n.status === 'healthy';
    const agents = n.agents || n.agent_count || 0;
    card.innerHTML = `
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">🖥️</span>
          <div>
            <div style="font-weight:500;font-size:14px">${n.name || n.id || n.node_id || 'Node'}</div>
            <div style="font-size:12px;color:var(--db-text-dim)">${n.address || n.host || ''} · ${typeof agents === 'number' ? agents : Array.isArray(agents) ? agents.length : 0} agents</div>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;padding:3px 10px;border-radius:12px;${isOnline ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${isOnline ? '● online' : '○ offline'}</span>
        <button class="node-del" data-id="${n.id || n.node_id}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">Remove</button>
      </div>
    `;
    nodesList.appendChild(card);
  });
  if (nodes.length === 0) nodesList.innerHTML = '<div class="db-viewer"><pre>No nodes registered</pre></div>';

  const instList = container.querySelector('#instances-list');
  instances.forEach(i => {
    const div = document.createElement('div');
    div.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--db-border);font-size:13px;display:flex;justify-content:space-between;align-items:center';
    const lastSeen = i.last_heartbeat || i.last_seen;
    div.innerHTML = `
      <span>🔗 ${i.id || i.instance_id || 'unknown'}</span>
      <span style="font-size:11px;color:var(--db-text-dim)">${lastSeen ? 'Last seen: ' + new Date(lastSeen * 1000).toLocaleTimeString() : ''}</span>
    `;
    instList.appendChild(div);
  });
  if (instances.length === 0) instList.innerHTML = '<div style="font-size:13px;color:var(--db-text-dim)">No instances connected</div>';

  container.querySelectorAll('.node-del').forEach(b => b.addEventListener('click', async () => {
    if (!await showConfirm('Remove Node', 'Remove this node?')) return;
    try { await fetch(`/api/nodes/${b.dataset.id}`, {method:'DELETE'}); render(container); } catch(e) {}
  }));
}
