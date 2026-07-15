/**
 * Skills Studio (STITCH-008) — unified Pending → Diff → Approve → Test →
 * Installed lifecycle for self_improve skill writes.
 *
 * Tabs: Pending (skill-filtered approvals) · Installed (toggle catalog) · History.
 * URL state: /skills?tab=pending|installed|history&approval_id={id}
 *
 * Reuses existing /api/approvals and /api/skills endpoints; no new backend.
 */
import { esc, timeAgo, diffLines, renderMarkdownPreview, isSkillApproval } from '/plugins/views/_helpers.js';

const RISK_ICONS = { low: '✅', medium: '⚠️', high: '🟠', critical: '🔴' };

let _container = null;

function currentTab() {
  const p = new URLSearchParams(location.search);
  return p.get('tab') || '';
}

function currentApprovalId() {
  return new URLSearchParams(location.search).get('approval_id') || '';
}

function setUrlState(tab, approvalId) {
  const p = new URLSearchParams(location.search);
  if (tab) p.set('tab', tab); else p.delete('tab');
  if (approvalId) p.set('approval_id', approvalId); else p.delete('approval_id');
  history.replaceState(history.state, '', `${location.pathname}?${p.toString()}`);
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function approvalId(a) {
  return a.id || a.approval_id || '';
}

function skillName(a) {
  const args = a.arguments || {};
  if (args.skill_name) return args.skill_name;
  if (args.name) return args.name;
  const path = String(args.path || '');
  const parts = path.split('/').filter(Boolean);
  if (path.endsWith('SKILL.md') && parts.length >= 2) return parts[parts.length - 2];
  return a.tool_name || a.action || 'skill';
}

function proposedContent(a) {
  const args = a.arguments || {};
  return a.proposed_content || args.content || args.skill_md || '';
}

function changeType(a) {
  if (a.current_content) return 'Update';
  const args = a.arguments || {};
  if (String(args.op || a.type || '').toLowerCase().includes('delete')) return 'Delete';
  return 'New';
}

// ── Diff overlay ────────────────────────────────────────────────────

function renderDiffRows(before, after) {
  const rows = diffLines(before, after);
  const colorFor = { add: 'rgba(34,197,94,.12)', del: 'rgba(239,68,68,.12)', ctx: 'transparent' };
  const signFor = { add: '+', del: '-', ctx: ' ' };
  let adds = 0;
  let dels = 0;
  const body = rows.map((r) => {
    if (r.type === 'add') adds++;
    if (r.type === 'del') dels++;
    return `<div style="display:flex;font-family:monospace;font-size:12px;background:${colorFor[r.type]}">
      <span style="width:16px;text-align:center;color:var(--db-text-dim);flex-shrink:0">${signFor[r.type]}</span>
      <span style="white-space:pre-wrap;word-break:break-word">${esc(r.text)}</span>
    </div>`;
  }).join('');
  return { html: body, adds, dels };
}

function diffOverlayHtml(a, skills) {
  const before = a.current_content || '';
  const after = proposedContent(a);
  const hasProposed = after !== '';
  const { html: rawRows, adds, dels } = renderDiffRows(before, after);
  const name = skillName(a);
  const dupe = changeType(a) === 'New' && skills.some((s) => (s.name || s.id) === name);
  const leftEmpty = before === '';
  return `
    <div class="ss-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;justify-content:flex-end">
      <div class="ss-panel" style="width:60%;max-width:920px;height:100%;background:var(--db-sidebar-bg);border-left:1px solid var(--db-border);display:flex;flex-direction:column;box-sizing:border-box">
        <div style="padding:16px 20px;border-bottom:1px solid var(--db-border);display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-size:16px;font-weight:600">${esc(name)}
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--db-card-bg);border:1px solid var(--db-border);margin-left:6px">${changeType(a)}</span>
              ${dupe ? '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(234,179,8,.15);color:#eab308;margin-left:4px">Name collision</span>' : ''}
            </div>
            <div style="font-size:12px;color:var(--db-text-dim);margin-top:4px">${RISK_ICONS[a.risk_level] || ''} ${esc(a.agent_name || '')} · +${adds} −${dels}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="ss-mode" data-mode="raw" style="padding:5px 12px;font-size:12px;border:1px solid var(--db-border);background:var(--db-accent);color:#fff;border-radius:6px;cursor:pointer">Raw</button>
            <button class="ss-mode" data-mode="preview" style="padding:5px 12px;font-size:12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">Preview</button>
            <button class="ss-close" style="background:none;border:none;color:var(--db-text-dim);font-size:22px;cursor:pointer">×</button>
          </div>
        </div>
        ${hasProposed ? '' : '<div style="padding:12px 20px;background:rgba(239,68,68,.1);color:#ef4444;font-size:13px">Content unavailable — approval disabled</div>'}
        <div class="ss-diff-body" style="flex:1;overflow:auto;padding:16px 20px">
          <div class="ss-columns" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
              <div style="font-size:12px;color:var(--db-text-dim);text-transform:uppercase;margin-bottom:8px">Current</div>
              <div class="ss-left">${leftEmpty ? '<div style="color:var(--db-text-dim);font-style:italic">No existing skill</div>' : `<pre style="white-space:pre-wrap;font-size:12px;margin:0">${esc(before)}</pre>`}</div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--db-text-dim);text-transform:uppercase;margin-bottom:8px">Proposed</div>
              <div class="ss-right">${rawRows}</div>
            </div>
          </div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--db-border);display:flex;gap:10px;justify-content:flex-end">
          <button class="ss-deny" data-id="${esc(approvalId(a))}" style="padding:8px 18px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:6px;cursor:pointer;font-size:13px">Reject</button>
          <button class="ss-approve" data-id="${esc(approvalId(a))}" ${hasProposed ? '' : 'disabled'} style="padding:8px 18px;background:${hasProposed ? 'rgba(34,197,94,.15)' : 'var(--db-card-bg)'};color:${hasProposed ? '#22c55e' : 'var(--db-text-dim)'};border:1px solid rgba(34,197,94,.3);border-radius:6px;cursor:${hasProposed ? 'pointer' : 'not-allowed'};font-size:13px">Approve</button>
        </div>
      </div>
    </div>`;
}

function openDiff(a, skills) {
  const host = _container.querySelector('#ss-overlay-host');
  if (!host) return;
  host.innerHTML = diffOverlayHtml(a, skills);
  setUrlState('pending', approvalId(a));
  const before = a.current_content || '';
  const after = proposedContent(a);

  const close = () => { host.innerHTML = ''; setUrlState('pending', ''); };
  host.querySelector('.ss-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  host.querySelector('.ss-close').addEventListener('click', close);

  host.querySelectorAll('.ss-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      host.querySelectorAll('.ss-mode').forEach((b) => {
        const on = b === btn;
        b.style.background = on ? 'var(--db-accent)' : 'transparent';
        b.style.color = on ? '#fff' : 'var(--db-text)';
      });
      const left = host.querySelector('.ss-left');
      const right = host.querySelector('.ss-right');
      if (mode === 'preview') {
        left.innerHTML = before === '' ? '<div style="color:var(--db-text-dim);font-style:italic">No existing skill</div>' : renderMarkdownPreview(before);
        right.innerHTML = renderMarkdownPreview(after);
      } else {
        left.innerHTML = before === '' ? '<div style="color:var(--db-text-dim);font-style:italic">No existing skill</div>' : `<pre style="white-space:pre-wrap;font-size:12px;margin:0">${esc(before)}</pre>`;
        right.innerHTML = renderDiffRows(before, after).html;
      }
    });
  });

  const resolve = async (verb, id) => {
    try { await fetch(`/api/approvals/${id}/${verb}`, { method: 'POST' }); } catch (e) { /* ignore */ }
    close();
    paint();
  };
  host.querySelector('.ss-approve')?.addEventListener('click', (e) => {
    if (e.currentTarget.disabled) return;
    resolve('approve', e.currentTarget.dataset.id);
  });
  host.querySelector('.ss-deny')?.addEventListener('click', (e) => resolve('deny', e.currentTarget.dataset.id));
}

// ── Tabs ────────────────────────────────────────────────────────────

function pendingCard(a, skills) {
  const name = skillName(a);
  const dupe = changeType(a) === 'New' && skills.some((s) => (s.name || s.id) === name);
  const preview = proposedContent(a).slice(0, 200);
  return `<div class="ss-pending-card db-card" data-id="${esc(approvalId(a))}" style="margin-bottom:10px;padding:16px 20px;cursor:pointer">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px">${esc(name.slice(0, 40))}
          <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--db-card-bg);border:1px solid var(--db-border);margin-left:6px">${changeType(a)}</span>
          ${dupe ? '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(234,179,8,.15);color:#eab308;margin-left:4px">Name collision</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--db-text-dim);margin-top:4px">🤖 ${esc(a.agent_name || '—')} · ${esc((a.metadata && a.metadata.source) || 'self_improve')} · ${esc(timeAgo(a.created_at))}</div>
      </div>
      <div style="font-size:12px">${RISK_ICONS[a.risk_level] || ''}</div>
    </div>
    ${preview ? `<pre style="margin:10px 0 0;font-size:11px;color:var(--db-text-dim);white-space:pre-wrap;max-height:44px;overflow:hidden">${esc(preview)}</pre>` : ''}
  </div>`;
}

function pendingTab(pending, skills) {
  if (pending.length === 0) {
    return `<div class="db-card" style="text-align:center;padding:2.5rem 1.5rem;color:var(--db-text-dim)">
      <div style="font-size:2.5rem;opacity:.4;margin-bottom:.75rem">📖</div>
      <div style="color:var(--db-text);font-weight:600;margin-bottom:.35rem">No pending skill writes</div>
      <div style="font-size:13px">Set <code>SKILL_WRITE_APPROVAL=1</code> and run an agent with <code>self_improve</code> to stage proposals here.</div>
    </div>`;
  }
  return pending.map((a) => pendingCard(a, skills)).join('');
}

function installedTab(tools, pendingNames) {
  const grouped = {};
  tools.forEach((t) => { const c = t.category || 'other'; (grouped[c] = grouped[c] || []).push(t); });
  if (tools.length === 0) return '<div class="db-viewer"><pre>No skills/tools available</pre></div>';
  return Object.entries(grouped).map(([category, catTools]) => {
    const cards = catTools.map((t) => {
      const enabled = t.enabled !== false;
      const icon = t.icon || '🔧';
      const keyStatus = t.api_key_set ? '🔑' : '';
      const hasPending = pendingNames.has(t.name || t.id);
      return `<div class="db-card" style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <span style="font-size:20px">${icon}</span>
          <div>
            <div style="font-size:13px;font-weight:500">${esc(t.name || t.id)} ${keyStatus}${hasPending ? ' <span title="Pending change" style="color:#eab308">●</span>' : ''}</div>
            <div style="font-size:11px;color:var(--db-text-dim)">${esc(t.description || '')}</div>
          </div>
        </div>
        <label style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer">
          <input type="checkbox" class="skill-toggle" data-id="${esc(t.id || t.name)}" ${enabled ? 'checked' : ''} style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:${enabled ? 'var(--db-accent)' : 'var(--db-border)'};border-radius:22px;transition:0.3s"></span>
          <span style="position:absolute;top:2px;left:${enabled ? '20px' : '2px'};width:18px;height:18px;background:#fff;border-radius:50%;transition:0.3s"></span>
        </label>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:20px">
      <h3 style="font-size:14px;font-weight:600;margin:0 0 10px;text-transform:capitalize">${esc(category)} (${catTools.length})</h3>
      <div class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${cards}</div>
    </div>`;
  }).join('');
}

function historyTab(history) {
  const skillHist = (Array.isArray(history) ? history : []).filter(isSkillApproval);
  if (skillHist.length === 0) return '<div style="font-size:13px;color:var(--db-text-dim)">No skill approval history</div>';
  return skillHist.slice(0, 25).map((h) => {
    const approved = h.status === 'approved' || h.approved;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--db-border);font-size:13px;display:flex;justify-content:space-between;gap:10px">
      <span>${esc(skillName(h))} — ${esc(h.agent_name || '')}</span>
      <span style="color:${approved ? '#22c55e' : '#ef4444'}">${approved ? '✓ approved' : '✗ denied'} · ${esc(timeAgo(h.resolved_at || h.created_at))}</span>
    </div>`;
  }).join('');
}

const STUDIO_STYLE = `<style id="ss-style">
  @media (max-width: 768px) {
    .ss-panel { width: 100% !important; }
    .ss-columns { grid-template-columns: 1fr !important; }
  }
</style>`;

function shell(data) {
  const { pending, tools } = data;
  const tab = data.activeTab;
  const enabledCount = tools.filter((t) => t.enabled !== false).length;
  const catCount = new Set(tools.map((t) => t.category || 'other')).size;
  const tabBtn = (id, label, badge) => {
    const on = tab === id;
    return `<button class="ss-tab" data-tab="${id}" style="padding:8px 16px;border:none;border-bottom:2px solid ${on ? 'var(--db-accent)' : 'transparent'};background:none;color:${on ? 'var(--db-text)' : 'var(--db-text-dim)'};font-size:13px;font-weight:${on ? '600' : '400'};cursor:pointer">${label}${badge ? ` <span style="background:rgba(234,179,8,.2);color:#eab308;padding:1px 7px;border-radius:10px;font-size:11px;margin-left:4px">${badge}</span>` : ''}</button>`;
  };
  let body = '';
  if (tab === 'installed') body = installedTab(tools, data.pendingNames);
  else if (tab === 'history') body = historyTab(data.history);
  else body = pendingTab(pending, tools);

  return `${STUDIO_STYLE}
    <div style="margin-bottom:8px">
      <h2 style="margin:0;font-size:1.1rem;font-weight:600">Skills Studio</h2>
      <div style="font-size:13px;color:var(--db-text-dim)">Review self_improve proposals</div>
    </div>
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin:16px 0 20px">
      <div class="db-card"><div class="db-card-title">Pending</div><div class="db-card-value" style="color:#eab308">${pending.length}</div></div>
      <div class="db-card"><div class="db-card-title">Enabled</div><div class="db-card-value" style="color:#22c55e">${enabledCount}</div></div>
      <div class="db-card"><div class="db-card-title">Categories</div><div class="db-card-value">${catCount}</div></div>
    </div>
    <div style="display:flex;gap:4px;border-bottom:1px solid var(--db-border);margin-bottom:16px">
      ${tabBtn('pending', 'Pending', pending.length || '')}
      ${tabBtn('installed', 'Installed', '')}
      ${tabBtn('history', 'History', '')}
    </div>
    <div id="ss-body">${body}</div>
    <div id="ss-overlay-host"></div>`;
}

async function loadAll() {
  const results = await Promise.allSettled([
    fetchJson('/api/skills'),
    fetchJson('/api/approvals/pending'),
    fetchJson('/api/approvals/history'),
  ]);
  const val = (i, f) => (results[i].status === 'fulfilled' ? results[i].value : f);
  const sk = val(0, {});
  let tools = sk.tools || sk.skills || sk || [];
  if (!Array.isArray(tools)) tools = Object.entries(tools).map(([id, t]) => ({ id, ...(typeof t === 'object' ? t : { name: t }) }));
  const rawPending = (val(1, {}).approvals) || [];
  const history = (val(2, {}).approvals) || (val(2, {}).history) || [];
  const pending = rawPending.filter(isSkillApproval);
  const pendingNames = new Set(pending.map((a) => skillName(a)));
  return { tools, pending, history, pendingNames };
}

function bindEvents(data) {
  _container.querySelectorAll('.ss-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      data.activeTab = btn.dataset.tab;
      setUrlState(data.activeTab, '');
      renderShell(data);
    });
  });
  _container.querySelectorAll('.ss-pending-card').forEach((card) => {
    card.addEventListener('click', () => {
      const a = data.pending.find((x) => approvalId(x) === card.dataset.id);
      if (a) openDiff(a, data.tools);
    });
  });
  _container.querySelectorAll('.skill-toggle').forEach((cb) => {
    cb.addEventListener('change', async () => {
      try { await fetch(`/api/skills/${cb.dataset.id}/toggle`, { method: 'POST' }); } catch (e) { /* ignore */ }
      paint();
    });
  });
}

function renderShell(data) {
  _container.innerHTML = shell(data);
  bindEvents(data);
}

async function paint() {
  if (!_container) return;
  const data = await loadAll();
  const tab = currentTab() || (data.pending.length > 0 ? 'pending' : 'installed');
  data.activeTab = tab;
  renderShell(data);
  const deepId = currentApprovalId();
  if (deepId && tab === 'pending') {
    const a = data.pending.find((x) => approvalId(x) === deepId);
    if (a) openDiff(a, data.tools);
  }
}

export async function render(container) {
  _container = container;
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';
  await paint();
}

export function cleanup() {
  _container = null;
}
