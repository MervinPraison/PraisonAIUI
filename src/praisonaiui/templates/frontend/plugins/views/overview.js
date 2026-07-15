/**
 * Overview View — Agent Command Center (STITCH-001).
 *
 * Mission-control home: live metric cards, agent table, needs-attention feed,
 * activity timeline, and an omnibar that opens the existing command palette.
 *
 * Data sources (parallel, fault-tolerant via Promise.allSettled):
 *   /api/agents, /api/sessions, /api/approvals/pending, /api/usage/summary,
 *   /api/usage/timeseries, /api/channels, /api/gateway/status,
 *   /api/features, /api/traces
 *
 * Renders into [data-page="overview"].
 */
import {
  metricCard, esc, timeAgo,
  sumTodayTokens, computeBudgetPct, budgetLevelFor,
  costStripHTML, budgetBannerHTML,
} from '/plugins/views/_helpers.js';

const METRICS_POLL_MS = 30000;
const APPROVALS_POLL_MS = 10000;

let _metricsTimer = null;
let _approvalsTimer = null;
let _visibilityHandler = null;
let _container = null;

const STATUS_COLORS = { running: '#22c55e', active: '#22c55e', idle: '#71717a', error: '#ef4444' };

function navigate(pageId) {
  if (window.aiui?.selectPage) window.aiui.selectPage(pageId);
}

function openPalette() {
  if (window.aiui?.openCommandPalette) window.aiui.openCommandPalette();
  else if (window.openCommandPalette) window.openCommandPalette();
}

function chatWithAgent(agentName) {
  if (agentName) {
    const url = `/chat?agent=${encodeURIComponent(agentName)}`;
    history.pushState({ pageId: 'chat' }, '', url);
  }
  navigate('chat');
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function settled(results, idx, fallback) {
  const r = results[idx];
  return r && r.status === 'fulfilled' ? r.value : fallback;
}

function toArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) {
    if (data && Array.isArray(data[k])) return data[k];
  }
  return [];
}

function statusDot(status) {
  const s = (status || 'idle').toLowerCase();
  const color = STATUS_COLORS[s] || STATUS_COLORS.idle;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}" title="${esc(s)}"></span>`;
}

async function loadAll() {
  const results = await Promise.allSettled([
    fetchJson('/api/agents'),
    fetchJson('/api/sessions'),
    fetchJson('/api/approvals/pending'),
    fetchJson('/api/usage/summary'),
    fetchJson('/api/usage/timeseries?hours=24'),
    fetchJson('/api/channels'),
    fetchJson('/api/gateway/status'),
    fetchJson('/api/features'),
    fetchJson('/api/traces?limit=10'),
    fetchJson('/api/usage/models'),
    fetchJson('/api/config/runtime'),
  ]);

  const agents = toArray(settled(results, 0, {}), 'agents');
  const sessions = toArray(settled(results, 1, {}), 'sessions');
  const pending = toArray(settled(results, 2, {}), 'approvals', 'pending');
  const usage = settled(results, 3, null);
  const timeseries = settled(results, 4, null);
  const channels = toArray(settled(results, 5, {}), 'channels');
  const gateway = settled(results, 6, null);
  const features = toArray(settled(results, 7, {}), 'features');
  const traces = toArray(settled(results, 8, {}), 'traces');
  const models = toArray(settled(results, 9, {}), 'models');
  const runtime = settled(results, 10, null);

  return {
    agents, sessions, pending, usage, timeseries, channels, gateway, features, traces, models,
    finops: (runtime && runtime.config && runtime.config.finops) || null,
    errors: {
      agents: results[0].status === 'rejected',
      sessions: results[1].status === 'rejected',
      usage: results[3].status === 'rejected',
      timeseries: results[4].status === 'rejected',
    },
  };
}

function usageSpark(timeseries) {
  const ts = timeseries && Array.isArray(timeseries.timeseries) ? timeseries.timeseries : [];
  return ts.map((p) => Number(p.tokens) || 0);
}

function todayTokens(usage) {
  if (!usage) return null;
  const s = usage.summary || usage;
  return s.today_tokens ?? s.total_tokens ?? s.tokens ?? null;
}

function gatewayLabel(gateway) {
  if (!gateway) return { value: 'Standalone', accent: '#71717a' };
  if (gateway.status === 'unavailable' || gateway.connected === false) {
    if (gateway.auth_required || gateway.status === 'auth_required') {
      return { value: 'Auth required', accent: '#eab308' };
    }
    return { value: 'Standalone', accent: '#71717a' };
  }
  return { value: 'OK', accent: '#22c55e' };
}

function renderMetrics(data) {
  const { agents, sessions, pending, usage, timeseries, channels, gateway, errors } = data;
  const channelsOnline = channels.filter((c) => c.running === true || c.connected === true).length;
  const tokens = todayTokens(usage);
  const gw = gatewayLabel(gateway);

  const cards = [
    metricCard({
      title: 'Active Agents', value: agents.length, subtitle: 'registered', nav: 'agents',
    }),
    metricCard({
      title: 'Live Sessions', value: errors.sessions ? '—' : sessions.length, subtitle: 'open', nav: 'sessions',
    }),
    metricCard({
      title: 'Pending Approvals', value: pending.length, subtitle: 'awaiting action', nav: 'approvals',
      accent: pending.length > 0 ? '#eab308' : undefined,
    }),
    metricCard({
      title: 'Tokens Today', value: tokens == null ? '—' : Number(tokens).toLocaleString(),
      subtitle: 'tokens', nav: 'usage', spark: usageSpark(timeseries),
    }),
    metricCard({
      title: 'Channel Health', value: `${channelsOnline}/${channels.length}`, subtitle: 'channels online', nav: 'channels',
    }),
    metricCard({
      title: 'Gateway Status', value: gw.value, subtitle: gateway?.runtime_type || 'runtime', nav: 'config', accent: gw.accent,
    }),
  ];

  return `<div class="db-metric-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px">${cards.join('')}</div>`;
}

function finopsState(data) {
  const finops = data.finops || {};
  // E1: usage timeseries unreachable → hide all FinOps UI (no error toast)
  if (data.errors.usage || data.errors.timeseries) return null;
  // E2: master toggle off → hide
  if (finops.enabled === false) return null;
  const ts = data.timeseries && Array.isArray(data.timeseries.timeseries) ? data.timeseries.timeseries : [];
  const today = sumTodayTokens(ts);
  const todayCost = ts.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
  const budget = finops.daily_token_budget != null ? Number(finops.daily_token_budget) : null;
  const warnPct = Number(finops.warn_pct) || 80;
  const criticalPct = Number(finops.critical_pct) || 95;
  const pct = computeBudgetPct(today, budget);
  const level = budgetLevelFor(pct, warnPct, criticalPct);
  return { today, todayCost, budget, warnPct, criticalPct, pct, level };
}

function renderFinOps(data) {
  const st = finopsState(data);
  if (!st) return '';
  const bannerDismissed = sessionStorage.getItem('finops-banner-dismissed') === '1';
  const banner = (st.level !== 'none' && !bannerDismissed) ? budgetBannerHTML(st.level, st.pct) : '';
  const strip = costStripHTML({
    todayTokens: st.today, todayCost: st.todayCost, budget: st.budget,
    warnPct: st.warnPct, criticalPct: st.criticalPct, models: data.models,
  });
  return `<div id="ov-finops-banner">${banner}</div>${strip}`;
}

function renderAgentTable(agents) {
  if (agents.length === 0) {
    return `<div class="db-card" style="text-align:center;padding:2.5rem 1.5rem;color:var(--db-text-dim)">
      <div style="font-size:2.5rem;opacity:.4;margin-bottom:.75rem">🤖</div>
      <div style="color:var(--db-text);font-weight:600;margin-bottom:.35rem">No agents registered yet</div>
      <div style="font-size:13px;margin-bottom:1rem">Configure agents to see them here.</div>
      <button data-nav="agents" style="padding:8px 16px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px">Configure agents</button>
    </div>`;
  }
  const rows = agents.slice(0, 20).map((a) => {
    const id = a.id || a.name || '';
    const preview = a.instructions || a.description || '';
    return `<tr data-agent-id="${esc(id)}" class="db-agent-row" style="cursor:pointer;border-top:1px solid var(--db-border)">
      <td style="padding:10px 12px">${statusDot(a.status)}</td>
      <td style="padding:10px 12px;font-weight:500">${esc(a.name || id)}</td>
      <td style="padding:10px 12px"><span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--db-card-bg);border:1px solid var(--db-border)">${esc(a.model || '—')}</span></td>
      <td style="padding:10px 12px;color:var(--db-text-dim);font-size:12px">${esc(timeAgo(a.last_active || a.updated_at) || (a.status || 'idle'))}</td>
      <td style="padding:10px 12px;color:var(--db-text-dim);font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(preview.slice(0, 80))}</td>
      <td style="padding:10px 12px"><button class="db-agent-chat" data-agent-id="${esc(id)}" data-agent-name="${esc(a.name || id)}" style="font-size:11px;padding:4px 12px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:6px;cursor:pointer">Chat</button></td>
    </tr>`;
  }).join('');
  return `<div class="db-card" style="padding:0;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="text-align:left;color:var(--db-text-dim);font-size:11px;text-transform:uppercase">
        <th style="padding:10px 12px"></th><th style="padding:10px 12px">Name</th><th style="padding:10px 12px">Model</th>
        <th style="padding:10px 12px">Last active</th><th style="padding:10px 12px">Preview</th><th style="padding:10px 12px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function buildAttention(data) {
  const items = [];
  data.pending.forEach((a) => {
    items.push({
      priority: 0, border: '#ef4444',
      html: `<div style="flex:1"><div style="font-weight:500">⚠ Approve: ${esc(a.tool_name || a.tool || a.action || 'request')}</div>
        <div style="font-size:12px;color:var(--db-text-dim)">${esc(a.agent_name || a.agent || '')}</div></div>
        <div style="display:flex;gap:6px">
          <button class="atn-approve" data-id="${esc(a.id || a.approval_id)}" style="font-size:11px;padding:4px 10px;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);border-radius:6px;cursor:pointer">Approve</button>
          <button class="atn-deny" data-id="${esc(a.id || a.approval_id)}" style="font-size:11px;padding:4px 10px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:6px;cursor:pointer">Deny</button>
        </div>`,
    });
  });
  data.features.filter((f) => f.health && f.health.status !== 'ok').forEach((f) => {
    items.push({
      priority: 1, border: '#eab308',
      html: `<div style="flex:1"><div style="font-weight:500">⚠ Feature degraded: ${esc(f.name || 'unknown')}</div></div>
        <button data-nav="debug" style="font-size:11px;padding:4px 10px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">View</button>`,
    });
  });
  data.channels.filter((c) => c.enabled !== false && c.running !== true && c.connected !== true).forEach((c) => {
    items.push({
      priority: 2, border: '#eab308',
      html: `<div style="flex:1"><div style="font-weight:500">⚠ Channel offline: ${esc(c.name || c.id || c.platform || 'channel')}</div></div>
        <button data-nav="channels" style="font-size:11px;padding:4px 10px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">Open</button>`,
    });
  });
  if (data.agents.length === 0) {
    items.push({
      priority: 4, border: 'var(--db-accent,#6366f1)',
      html: `<div style="flex:1"><div style="font-weight:500">No agents configured</div></div>
        <button data-nav="agents" style="font-size:11px;padding:4px 10px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">Configure</button>`,
    });
  }
  items.sort((a, b) => a.priority - b.priority);
  return items.slice(0, 8);
}

function renderAttention(data) {
  const items = buildAttention(data);
  if (items.length === 0) {
    return `<div style="padding:20px;color:var(--db-text-dim);font-size:13px;text-align:center">✓ All clear — nothing needs attention</div>`;
  }
  return items.map((it) => `<div class="db-card" style="display:flex;align-items:center;gap:10px;padding:12px 14px;margin-bottom:8px;border-left:3px solid ${it.border}">${it.html}</div>`).join('');
}

function renderTimeline(traces) {
  if (traces.length === 0) {
    return `<div style="padding:16px;color:var(--db-text-dim);font-size:13px">No recent activity</div>`;
  }
  return traces.slice(0, 10).map((t) => {
    const label = t.name || t.event || t.tool || t.type || 'event';
    const agent = t.agent_name || t.agent || '';
    const when = timeAgo(t.timestamp || t.created_at || t.start_time);
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--db-border);font-size:13px">
      <span style="color:var(--db-text-dim);font-size:11px;min-width:64px">${esc(when)}</span>
      <span style="flex:1">${esc(label)}</span>
      ${agent ? `<span style="color:var(--db-text-dim);font-size:12px">${esc(agent)}</span>` : ''}
    </div>`;
  }).join('');
}

const OVERVIEW_STYLE = `<style id="ov-style">
  @media (max-width: 768px) {
    .db-metric-grid { grid-template-columns: repeat(2, 1fr) !important; }
    .db-ov-columns { grid-template-columns: 1fr !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .db-sparkline polyline, .db-sparkline polygon { transition: none !important; }
  }
</style>`;

function shell(data) {
  return `${OVERVIEW_STYLE}
    <div class="db-omnibar" data-omnibar="1" role="button" tabindex="0" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:18px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:10px;cursor:pointer;color:var(--db-text-dim);max-width:520px">
      <span>🔍</span><span style="flex:1;font-size:13px">Search pages, agents, sessions…</span>
      <span style="font-size:11px;padding:2px 8px;border:1px solid var(--db-border);border-radius:6px">Ctrl+K</span>
    </div>

    <div id="ov-metrics">${renderMetrics(data)}</div>

    <div id="ov-finops">${renderFinOps(data)}</div>

    <div class="db-ov-columns" style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-top:20px">
      <div>
        <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Active Agents</h3>
        <div id="ov-agents">${renderAgentTable(data.agents)}</div>
      </div>
      <div>
        <h3 style="margin:0 0 12px;font-size:15px;font-weight:600">Needs Attention</h3>
        <div id="ov-attention">${renderAttention(data)}</div>
      </div>
    </div>

    <h3 style="margin:24px 0 12px;font-size:15px;font-weight:600">Recent Activity</h3>
    <div id="ov-timeline" class="db-card" style="padding:6px 16px">${renderTimeline(data.traces)}</div>

    <details style="margin-top:24px">
      <summary style="cursor:pointer;font-size:15px;font-weight:600;margin-bottom:12px">Feature Health</summary>
      <div class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-top:12px">
        ${data.features.map((f) => `
          <div class="db-card" style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between">
            <div><div style="font-size:13px;font-weight:500">${esc(f.name || 'unknown')}</div>
              <div style="font-size:11px;color:var(--db-text-dim)">${esc(f.description || '')}</div></div>
            <span style="font-size:12px;padding:3px 10px;border-radius:20px;${f.health?.status === 'ok'
              ? 'background:rgba(34,197,94,0.15);color:#22c55e'
              : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${f.health?.status === 'ok' ? '● active' : '○ inactive'}</span>
          </div>`).join('')}
      </div>
    </details>

    <div id="ov-drawer"></div>
  `;
}

function openDrawer(agent) {
  const host = _container?.querySelector('#ov-drawer');
  if (!host) return;
  const id = agent.id || agent.name || '';
  const tools = Array.isArray(agent.tools) ? agent.tools : [];
  host.innerHTML = `
    <div class="ov-drawer-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200">
      <div style="position:absolute;top:0;right:0;height:100%;width:400px;max-width:92vw;background:var(--db-sidebar-bg);border-left:1px solid var(--db-border);padding:24px;overflow-y:auto;box-sizing:border-box">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <h2 style="margin:0;font-size:18px">${esc(agent.name || id)}</h2>
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--db-card-bg);border:1px solid var(--db-border)">${esc(agent.model || '—')}</span>
              ${statusDot(agent.status)}<span style="font-size:12px;color:var(--db-text-dim)">${esc(agent.status || 'idle')}</span>
            </div>
          </div>
          <button class="ov-drawer-close" style="background:none;border:none;color:var(--db-text-dim);font-size:20px;cursor:pointer">×</button>
        </div>
        <div style="margin-top:20px">
          <div style="font-size:12px;color:var(--db-text-dim);text-transform:uppercase;margin-bottom:6px">Instructions</div>
          <div style="font-size:13px;line-height:1.6;color:var(--db-text)">${esc((agent.instructions || agent.description || '—').slice(0, 400))}</div>
        </div>
        ${tools.length ? `<div style="margin-top:18px">
          <div style="font-size:12px;color:var(--db-text-dim);text-transform:uppercase;margin-bottom:6px">Tools</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${tools.map((t) => `<span style="font-size:11px;padding:3px 9px;border-radius:10px;background:var(--db-card-bg);border:1px solid var(--db-border)">${esc(typeof t === 'string' ? t : t.name || 'tool')}</span>`).join('')}</div>
        </div>` : ''}
        <div style="margin-top:24px;display:flex;gap:10px">
          <button class="ov-drawer-chat" data-agent-name="${esc(agent.name || id)}" style="flex:1;padding:9px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500">Chat now</button>
          <button class="ov-drawer-traces" style="padding:9px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">View traces</button>
        </div>
      </div>
    </div>`;

  const close = () => { host.innerHTML = ''; };
  host.querySelector('.ov-drawer-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  host.querySelector('.ov-drawer-close').addEventListener('click', close);
  host.querySelector('.ov-drawer-chat')?.addEventListener('click', (e) => {
    close();
    chatWithAgent(e.currentTarget.dataset.agentName);
  });
  host.querySelector('.ov-drawer-traces')?.addEventListener('click', () => { close(); navigate('traces'); });
}

function bindEvents(container, data) {
  const agentById = (id) => data.agents.find((a) => (a.id || a.name) === id);

  container.querySelectorAll('[data-nav]').forEach((el) => {
    const go = () => navigate(el.getAttribute('data-nav'));
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  container.querySelector('[data-omnibar]')?.addEventListener('click', openPalette);

  container.querySelector('.db-finops-banner-usage')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigate('usage');
  });
  container.querySelector('.db-finops-banner-dismiss')?.addEventListener('click', (e) => {
    e.stopPropagation();
    sessionStorage.setItem('finops-banner-dismissed', '1');
    const host = container.querySelector('#ov-finops-banner');
    if (host) host.innerHTML = '';
  });

  container.querySelectorAll('.db-agent-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.db-agent-chat')) return;
      const a = agentById(row.dataset.agentId);
      if (a) openDrawer(a);
    });
  });

  container.querySelectorAll('.db-agent-chat').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatWithAgent(btn.dataset.agentName);
    });
  });

  container.querySelectorAll('.atn-approve').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await fetch(`/api/approvals/${btn.dataset.id}/approve`, { method: 'POST' }); } catch (e) { /* ignore */ }
      refreshApprovals();
    });
  });
  container.querySelectorAll('.atn-deny').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await fetch(`/api/approvals/${btn.dataset.id}/deny`, { method: 'POST' }); } catch (e) { /* ignore */ }
      refreshApprovals();
    });
  });
}

async function paint() {
  if (!_container) return;
  const data = await loadAll();
  _container.__ovData = data;
  _container.innerHTML = shell(data);
  bindEvents(_container, data);
}

async function refreshApprovals() {
  if (!_container || document.hidden) return;
  let pending = [];
  try { pending = toArray(await fetchJson('/api/approvals/pending'), 'approvals', 'pending'); } catch (e) { return; }
  const data = _container.__ovData;
  if (!data) return;
  data.pending = pending;
  const metricsEl = _container.querySelector('#ov-metrics');
  const attnEl = _container.querySelector('#ov-attention');
  if (metricsEl) metricsEl.innerHTML = renderMetrics(data);
  if (attnEl) attnEl.innerHTML = renderAttention(data);
  bindEvents(_container, data);
}

function startPolling() {
  stopPolling();
  _metricsTimer = setInterval(() => { if (!document.hidden) paint(); }, METRICS_POLL_MS);
  _approvalsTimer = setInterval(refreshApprovals, APPROVALS_POLL_MS);
  _visibilityHandler = () => { if (!document.hidden) refreshApprovals(); };
  document.addEventListener('visibilitychange', _visibilityHandler);
}

function stopPolling() {
  if (_metricsTimer) { clearInterval(_metricsTimer); _metricsTimer = null; }
  if (_approvalsTimer) { clearInterval(_approvalsTimer); _approvalsTimer = null; }
  if (_visibilityHandler) { document.removeEventListener('visibilitychange', _visibilityHandler); _visibilityHandler = null; }
}

export async function render(container) {
  _container = container;
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';
  await paint();
  startPolling();
}

export function cleanup() {
  stopPolling();
  _container = null;
}
