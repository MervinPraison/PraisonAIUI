/**
 * Guardrails View — Input/output safety monitoring dashboard with CRUD.
 * Shows active guardrails, violation logs, and safety policies.
 * API: /api/guardrails, /api/guardrails/status, /api/guardrails/violations,
 *      POST /api/guardrails/register, DELETE /api/guardrails/{id}
 */
import { showToast, showConfirm } from '../toast.js';
import { inAppShell, statusChip, humanize, emptyState, shellButton, esc } from '/plugins/views/_helpers.js';
/** Shell: a class name as words (LLMGuardrail → LLM guardrail). */
function className(name) {
  const words = String(name || '-').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
  return words.map((w, i) => (i && w !== w.toUpperCase() ? w.toLowerCase() : w)).join(' ');
}

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let statusData = {}, guardrailsList = [], violations = [];
  try {
    const [sRes, gRes, vRes] = await Promise.all([
      fetch('/api/guardrails/status'), fetch('/api/guardrails'), fetch('/api/guardrails/violations?limit=20')
    ]);
    statusData = await sRes.json();
    guardrailsList = (await gRes.json()).guardrails || [];
    violations = (await vRes.json()).violations || [];
  } catch(e) { statusData = { status: 'error', active_guardrails: 0 }; }

  // Shell: chips on theme colours, neutral zero counts, sentence case, the designed empty state.
  const shell = inAppShell();
  const L = (dash, sentence) => (shell ? sentence : dash);
  const violationCount = statusData.total_violations || 0;
  const gwBadge = shell
    ? statusChip(statusData.gateway_connected ? 'Connected' : 'Not connected', statusData.gateway_connected ? 'success' : 'danger')
    : statusData.gateway_connected
    ? '<span style="color:#22c55e">● Connected</span>'
    : '<span style="color:#ef4444">● Not Connected</span>';

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h2 style="margin:0;font-size:1.5rem">${L('🛡️ ', '')}Guardrails</h2>
        <button id="gr-add-btn" style="padding:8px 18px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem">${L('+ Add Guardrail', '+ Add guardrail')}</button>
      </div>

      <div id="gr-add-form" style="display:none;margin-bottom:20px;padding:16px;background:var(--db-card-bg,#1a1a2e);border:1px solid var(--db-border,#333);border-radius:10px">
        <div style="margin-bottom:10px;font-weight:600;font-size:14px">${L('New Guardrail', 'New guardrail')}</div>
        <input id="gr-desc" placeholder="Description (e.g. 'be polite')" style="width:100%;padding:10px;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:8px;box-sizing:border-box;margin-bottom:8px" />
        <div style="display:flex;gap:10px;align-items:center">
          <select id="gr-type" style="padding:6px 10px;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px">
            <option value="llm">LLM</option>
            <option value="input">Input</option>
            <option value="output">Output</option>
          </select>
          <input id="gr-agent" placeholder="Agent name (optional)" style="padding:6px 10px;background:var(--db-input-bg,#0d0d1a);color:var(--db-text,#e0e0e0);border:1px solid var(--db-border,#333);border-radius:6px;flex:1" />
          <button id="gr-save" style="padding:6px 16px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">Save</button>
          <button id="gr-cancel" style="padding:6px 16px;background:transparent;color:var(--db-text-dim,#888);border:1px solid var(--db-border,#333);border-radius:6px;cursor:pointer">Cancel</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${shell ? '150px' : '200px'},1fr));gap:16px;margin-bottom:24px">
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">${L('Active Guardrails', 'Active guardrails')}</div>
          <div style="font-size:1.8rem;font-weight:700">${statusData.active_guardrails || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">${L('Total Violations', 'Violations')}</div>
          <div style="font-size:1.8rem;font-weight:700;color:${shell ? (violationCount > 0 ? 'var(--db-error)' : 'var(--db-text)') : '#ef4444'}">${statusData.total_violations || 0}</div>
        </div>
        <div class="db-card" style="padding:16px;border-radius:12px">
          <div style="font-size:.8rem;opacity:.6">Gateway</div>
          <div style="font-size:1rem;margin-top:4px">${gwBadge}</div>
          <div style="font-size:.75rem;opacity:.5">Agents: ${statusData.gateway_agent_count || 0}</div>
        </div>
      </div>

      <h3 style="margin:0 0 12px;font-size:1.1rem">${L('Active Guardrails', 'Active guardrails')}</h3>
      <div${shell && guardrailsList.length === 0 ? '' : ' class="db-card"'} style="border-radius:12px;overflow:hidden;margin-bottom:24px">
        ${guardrailsList.length === 0
          ? shell ? emptyState({ iconName: 'shield', title: 'No guardrails yet', body: 'Add a rule, like “be polite” or “no personal data”, and agents check their input or output against it.', actionHtml: shellButton('Add guardrail', 'data-gr-empty-add') }) : '<div style="padding:24px;text-align:center;opacity:.5">No guardrails configured. Click "+ Add Guardrail" to create one.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Description</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Type</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Guardrail</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Source</th>
                <th style="padding:10px 14px;text-align:right;font-size:.8rem;opacity:.6">Actions</th>
              </tr></thead>
              <tbody>${guardrailsList.map(g => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.85rem">${g.description || g.agent_name || '-'}</td>
                  <td style="padding:10px 14px">${shell ? statusChip(g.type === 'llm' ? 'LLM' : humanize(g.type), g.type === 'llm' ? 'info' : 'neutral') : `<span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:${g.type==='llm'?'rgba(34,197,94,.15)':g.type==='input'?'rgba(59,130,246,.15)':'rgba(168,85,247,.15)'}">${g.type}</span>`}</td>
                  ${shell ? `<td style="padding:10px 14px;font-size:.85rem">${esc(className(g.guardrail))}</td>` : `<td style="padding:10px 14px;font-size:.85rem;font-family:monospace">${g.guardrail || '-'}</td>`}
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.5">${g.source}</td>
                  <td style="padding:10px 14px;text-align:right">
                    <button class="gr-delete-btn" data-id="${g.id}" style="padding:4px 12px;${shell ? 'background:transparent;color:var(--db-error);border:1px solid var(--db-border)' : 'background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3)'};border-radius:6px;cursor:pointer;font-size:.75rem" title="Delete">${L('✕ Delete', 'Delete')}</button>
                  </td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>

      ${shell && violations.length === 0 ? (guardrailsList.length ? '<h3 style="margin:0 0 8px;font-size:1.1rem">Recent violations</h3><p style="margin:0;font-size:13px;color:var(--db-text-dim)">No violations recorded.</p>' : '') : `<h3 style="margin:0 0 12px;font-size:1.1rem">${L('Recent Violations', 'Recent violations')}</h3>
      <div class="db-card" style="border-radius:12px;overflow:hidden">
        ${violations.length === 0
          ? '<div style="padding:24px;text-align:center;opacity:.5">No violations recorded.</div>'
          : `<table style="width:100%;border-collapse:collapse">
              <thead><tr style="border-bottom:1px solid rgba(128,128,128,.2)">
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Time</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Agent</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Guardrail</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Level</th>
                <th style="padding:10px 14px;text-align:left;font-size:.8rem;opacity:.6">Message</th>
              </tr></thead>
              <tbody>${violations.map(v => `
                <tr style="border-bottom:1px solid rgba(128,128,128,.1)">
                  <td style="padding:10px 14px;font-size:.75rem;opacity:.6">${new Date(v.timestamp*1000).toLocaleTimeString()}</td>
                  <td style="padding:10px 14px;font-size:.85rem">${v.agent_id}</td>
                  <td style="padding:10px 14px;font-size:.85rem;font-family:monospace">${v.guardrail}</td>
                  <td style="padding:10px 14px">${shell ? statusChip(humanize(v.level), v.level === 'ERROR' ? 'danger' : 'warning') : `<span style="padding:2px 8px;border-radius:6px;font-size:.75rem;background:${v.level==='ERROR'?'rgba(239,68,68,.15)':'rgba(245,158,11,.15)'}">${v.level}</span>`}</td>
                  <td style="padding:10px 14px;font-size:.8rem">${v.message}</td>
                </tr>`).join('')}
              </tbody></table>`
        }
      </div>`}
    </div>`;

  // ── Add Guardrail Form ────────────────────────────────────────
  const addBtn = container.querySelector('#gr-add-btn');
  const addForm = container.querySelector('#gr-add-form');

  container.querySelector('[data-gr-empty-add]')?.addEventListener('click', () => addBtn?.click());
  addBtn?.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? 'block' : 'none';
    if (addForm.style.display === 'block') container.querySelector('#gr-desc')?.focus();
  });

  container.querySelector('#gr-cancel')?.addEventListener('click', () => {
    addForm.style.display = 'none';
  });

  container.querySelector('#gr-save')?.addEventListener('click', async () => {
    const desc = container.querySelector('#gr-desc')?.value?.trim();
    if (!desc) { container.querySelector('#gr-desc')?.focus(); return; }
    const type = container.querySelector('#gr-type')?.value || 'llm';
    const agent = container.querySelector('#gr-agent')?.value?.trim() || '';
    try {
      const res = await fetch('/api/guardrails/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, type, agent_name: agent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      render(container);
    } catch(e) {
      showToast('Failed to add guardrail: ' + e.message, 'error');
    }
  });

  // ── Delete Buttons ────────────────────────────────────────────
  container.querySelectorAll('.gr-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!await showConfirm('Delete Guardrail', 'Delete this guardrail?')) return;
      try {
        const res = await fetch(`/api/guardrails/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        render(container);
      } catch(e) {
        showToast('Failed to delete: ' + e.message, 'error');
      }
    });
  });
}
