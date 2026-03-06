/**
 * Logs View — real-time WebSocket log viewer
 * API: /api/logs/stream (WebSocket), /api/logs/levels, /api/logs/stats
 */
let ws = null;

export async function render(container) {
  // Clean up previous connection
  if (ws) { try { ws.close(); } catch(e) {} ws = null; }

  let stats = {}, levels = {};
  try { const r = await fetch('/api/logs/stats'); stats = await r.json(); } catch(e) {}
  try { const r = await fetch('/api/logs/levels'); levels = await r.json(); } catch(e) {}

  const levelList = levels.levels || Object.keys(levels) || ['DEBUG','INFO','WARNING','ERROR'];

  container.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
      <select id="log-level" style="padding:6px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:13px">
        <option value="">All Levels</option>
        ${(Array.isArray(levelList) ? levelList : Object.keys(levelList)).map(l => `<option value="${typeof l === 'string' ? l : l.name || l}">${typeof l === 'string' ? l : l.name || l}</option>`).join('')}
      </select>
      <input id="log-search" placeholder="Filter logs…" style="flex:1;padding:6px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:13px" />
      <button id="log-clear" style="padding:6px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer;font-size:12px">Clear</button>
      <span id="log-status" style="font-size:12px;color:var(--db-text-dim)">Connecting…</span>
    </div>
    <div class="db-columns" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
      <div class="db-card" style="padding:12px 16px">
        <div class="db-card-title">Total</div>
        <div class="db-card-value" style="font-size:20px">${stats.total || 0}</div>
      </div>
      <div class="db-card" style="padding:12px 16px">
        <div class="db-card-title">Errors</div>
        <div class="db-card-value" style="font-size:20px;color:#ef4444">${stats.by_level?.ERROR || 0}</div>
      </div>
      <div class="db-card" style="padding:12px 16px">
        <div class="db-card-title">Warnings</div>
        <div class="db-card-value" style="font-size:20px;color:#eab308">${stats.by_level?.WARNING || 0}</div>
      </div>
      <div class="db-card" style="padding:12px 16px">
        <div class="db-card-title">Buffer</div>
        <div class="db-card-value" style="font-size:20px">${stats.buffer_size || 0}</div>
      </div>
    </div>
    <div id="log-output" style="background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:10px;padding:16px;height:calc(100vh - 400px);overflow-y:auto;font-family:monospace;font-size:12px;line-height:1.8"></div>
  `;

  const output = container.querySelector('#log-output');
  const statusEl = container.querySelector('#log-status');
  const levelSelect = container.querySelector('#log-level');
  const searchInput = container.querySelector('#log-search');

  // Connect WebSocket
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    ws = new WebSocket(`${proto}//${location.host}/api/logs/stream`);
    ws.onopen = () => { statusEl.textContent = '● Connected'; statusEl.style.color = '#22c55e'; };
    ws.onclose = () => { statusEl.textContent = '○ Disconnected'; statusEl.style.color = '#ef4444'; };
    ws.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        const level = levelSelect.value;
        const search = searchInput.value.toLowerCase();
        if (level && entry.level !== level) return;
        if (search && !(entry.message || '').toLowerCase().includes(search)) return;
        appendLogEntry(output, entry);
      } catch(err) {}
    };
  } catch(e) { statusEl.textContent = 'WS unavailable'; }

  container.querySelector('#log-clear')?.addEventListener('click', async () => {
    try { await fetch('/api/logs/clear', {method:'POST'}); output.innerHTML = ''; } catch(e) {}
  });
}

function appendLogEntry(output, entry) {
  const colors = { DEBUG: '#6b7280', INFO: '#3b82f6', WARNING: '#eab308', ERROR: '#ef4444', CRITICAL: '#dc2626' };
  const color = colors[entry.level] || '#6b7280';
  const line = document.createElement('div');
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
  line.innerHTML = `<span style="color:var(--db-text-dim)">${time}</span> <span style="color:${color};font-weight:600">[${entry.level || 'LOG'}]</span> ${entry.message || entry.msg || JSON.stringify(entry)}`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

export function cleanup() { if (ws) { try { ws.close(); } catch(e) {} ws = null; } }
