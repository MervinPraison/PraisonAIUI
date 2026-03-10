/**
 * Memory & Knowledge View — browse, search, and manage agent memory
 *
 * API: /api/memory, /api/memory/search, /api/memory/status, /api/memory/context
 */
import { showToast, showConfirm } from '../toast.js';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let memories = [], status = {};
  try { const r = await fetch('/api/memory'); const d = await r.json(); memories = d.memories || d.items || d || []; if (!Array.isArray(memories)) memories = []; } catch(e) {}
  try { const r = await fetch('/api/memory/status'); status = await r.json(); } catch(e) {}

  const totalCount = Array.isArray(memories) ? memories.length : 0;
  const shortCount = memories.filter(m => m.memory_type === 'short').length;
  const longCount = memories.filter(m => m.memory_type === 'long').length;

  container.innerHTML = `
    <!-- Stats -->
    <div class="db-columns" style="grid-template-columns:repeat(4,1fr);margin-bottom:24px">
      <div class="db-card">
        <div class="db-card-title">Memories</div>
        <div class="db-card-value">${totalCount}</div>
        <div class="db-card-footer">stored items</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Provider</div>
        <div class="db-card-value" style="font-size:16px">${status.provider || status.backend || 'unknown'}</div>
        <div class="db-card-footer">${status.status === 'ok' ? '● active' : '○ ' + (status.status || 'unknown')}</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Short-term</div>
        <div class="db-card-value">${shortCount}</div>
        <div class="db-card-footer">conversation context</div>
      </div>
      <div class="db-card">
        <div class="db-card-title">Long-term</div>
        <div class="db-card-value">${longCount}</div>
        <div class="db-card-footer">learned facts</div>
      </div>
    </div>

    <!-- Search + Actions -->
    <div style="display:flex;gap:8px;margin-bottom:20px;align-items:center">
      <input id="mem-search" type="text" placeholder="Search memory..." style="flex:1;padding:8px 14px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;color:var(--db-text);font-size:13px;outline:none" />
      <button id="mem-search-btn" style="padding:8px 18px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">🔍 Search</button>
      <button id="mem-store-btn" style="padding:8px 18px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer;font-size:12px">+ Store</button>
      <button id="mem-clear-btn" style="padding:8px 18px;border:1px solid #ef4444;background:transparent;color:#ef4444;border-radius:8px;cursor:pointer;font-size:12px" title="Clear all memories">🗑 Clear All</button>
    </div>

    <!-- Results -->
    <div id="mem-results">
      <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Recent Memories</h3>
      ${totalCount === 0 ? '<div style="padding:40px;text-align:center;color:var(--db-text-dim)">No memories stored yet. Use the chat to interact with agents and build memory.</div>' : ''}
      <div class="db-viewer">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${memories.slice(0, 50).map((m, i) => {
            const key = m.key || m.id || m.memory_id || i;
            const value = typeof m === 'string' ? m : m.value || m.content || m.text || JSON.stringify(m).substring(0, 120);
            const mtype = m.memory_type || '';
            const typeBadge = mtype === 'short'
              ? '<span style="background:#3b82f6;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600">SHORT</span>'
              : mtype === 'long'
              ? '<span style="background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600">LONG</span>'
              : '';
            return `<tr style="transition:background .1s" onmouseenter="this.style.background='rgba(99,102,241,.05)'" onmouseleave="this.style.background=''">
              <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);width:60px">${typeBadge}</td>
              <td style="padding:8px 12px;border-bottom:1px solid var(--db-border)">${String(value).substring(0, 200)}</td>
              <td style="padding:8px 12px;border-bottom:1px solid var(--db-border);width:40px;text-align:center">
                <button class="mem-delete-btn" data-id="${String(key)}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:4px;opacity:0.5;transition:opacity .15s" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.5'" title="Delete this memory">✕</button>
              </td>
            </tr>`;
          }).join('')}
        </table>
      </div>
    </div>
  `;

  // Delete handlers
  container.querySelectorAll('.mem-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const memId = btn.dataset.id;
      if (!await showConfirm('Delete memory?', 'This entry will be permanently removed.')) return;
      try {
        const r = await fetch(`/api/memory/${memId}`, { method: 'DELETE' });
        if (r.ok) {
          render(container);
        } else {
          const d = await r.json();
          showToast('Delete failed: ' + (d.error || r.statusText), 'error');
        }
      } catch(err) {
        showToast('Delete failed: ' + err.message, 'error');
      }
    });
  });

  // Clear All handler
  container.querySelector('#mem-clear-btn')?.addEventListener('click', async () => {
    if (!await showConfirm('Clear ALL memories?', 'This cannot be undone.')) return;
    try {
      const r = await fetch('/api/memory', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memory_type: 'all' }) });
      if (r.ok) {
        render(container);
      } else {
        showToast('Clear failed', 'error');
      }
    } catch(e) {
      showToast('Clear failed: ' + e.message, 'error');
    }
  });

  // Search handler
  const searchInput = container.querySelector('#mem-search');
  container.querySelector('#mem-search-btn')?.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    const resultsDiv = container.querySelector('#mem-results');
    resultsDiv.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';
    try {
      const r = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 20 }),
      });
      const data = await r.json();
      const results = data.results || data.memories || [];
      resultsDiv.innerHTML = `
        <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Search Results (${results.length})</h3>
        <div class="db-viewer">
          ${results.length === 0 ? '<div style="padding:20px;color:var(--db-text-dim)">No matches found</div>' :
            results.map(r => `<div style="padding:10px 14px;border-bottom:1px solid var(--db-border)">${typeof r === 'string' ? r : r.content || r.text || JSON.stringify(r).substring(0, 200)}</div>`).join('')}
        </div>
      `;
    } catch(e) {
      resultsDiv.innerHTML = '<div style="color:#ef4444">Search failed: ' + e.message + '</div>';
    }
  });

  // Store handler
  container.querySelector('#mem-store-btn')?.addEventListener('click', async () => {
    const text = prompt('Enter memory text:');
    if (!text) return;
    const type = prompt('Memory type (short/long):', 'long') || 'long';
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, memory_type: type }),
      });
      render(container);
    } catch(e) {
      showToast('Failed to store: ' + e.message, 'error');
    }
  });

  // Enter key = search
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') container.querySelector('#mem-search-btn')?.click();
  });
}
