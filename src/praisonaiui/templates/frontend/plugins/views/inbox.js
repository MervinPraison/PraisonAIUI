/**
 * Channel Inbox (/inbox) — unified multi-channel conversation triage (STITCH-010).
 *
 * Track B (session-filter fallback): derives threads from channel-backed
 * sessions + chat history, groups messages by sender, and persists status +
 * assignee via /api/sessions/{id}/state. Replies use the same chat transport
 * as chat.js (/api/chat/send). Deep-links to /chat and /work.
 *
 * Three panes: Queue (list + filters) · Conversation (history + composer) ·
 * Context rail (customer meta + assign agent + status + actions).
 */
import { showToast } from '../toast.js';

const STYLE_ID = 'channel-inbox-styles';

const PLATFORM_ICONS = {
  discord: '🎮', slack: '💬', telegram: '✈️', whatsapp: '📱',
  imessage: '🍎', signal: '🔒', googlechat: '💼', nostr: '🟣',
};

const STATUS_META = {
  open: { label: 'Open', color: '#6366f1', priority: 2 },
  waiting_on_agent: { label: 'Waiting on agent', color: '#f59e0b', priority: 1 },
  waiting_on_customer: { label: 'Waiting on customer', color: '#a1a1aa', priority: 3 },
  resolved: { label: 'Resolved', color: '#22c55e', priority: 4 },
};

const STATUS_ORDER = ['open', 'waiting_on_agent', 'waiting_on_customer', 'resolved'];

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function platformIcon(p) {
  return PLATFORM_ICONS[String(p || '').toLowerCase()] || '📡';
}

function relativeTime(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts * (ts < 1e12 ? 1000 : 1) : Date.parse(ts);
  if (!t || isNaN(t)) return '';
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.open;
}

// ── Pure thread-building helpers (unit-tested via source assertions) ──

export function senderKey(channelId, sender) {
  const s = (sender == null || sender === '') ? 'general' : String(sender);
  return `${channelId || 'unknown'}:${s}`;
}

export function groupMessagesBySender(sessionId, channelId, messages) {
  const groups = new Map();
  (messages || []).forEach((m) => {
    const sender = m.sender || m.sender_id || m.user || '';
    const key = senderKey(channelId, sender);
    if (!groups.has(key)) {
      groups.set(key, { key, sessionId, channelId, sender, messages: [] });
    }
    groups.get(key).messages.push(m);
  });
  return Array.from(groups.values());
}

export function buildThreadRow(group, platform, stateThreads) {
  const msgs = group.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const persisted = (stateThreads && stateThreads[group.key]) || {};
  const preview = String(last.content || last.text || '').slice(0, 120);
  const senderDisplay = last.sender_display || group.sender || 'General';
  const updatedAt = last.timestamp || last.created_at || last.ts || 0;
  return {
    threadId: group.key,
    sessionId: group.sessionId,
    channelId: group.channelId,
    platform: platform || last.platform || '',
    sender: group.sender || '',
    senderDisplay,
    preview,
    status: persisted.status || 'open',
    assignedAgent: persisted.assigned_agent || '',
    updatedAt,
    messageCount: msgs.length,
    messages: msgs,
  };
}

export function sortThreads(rows) {
  return rows.slice().sort((a, b) => {
    const pa = statusMeta(a.status).priority;
    const pb = statusMeta(b.status).priority;
    if (pa !== pb) return pa - pb;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .inbox { display:flex; height:100%; min-height:0; gap:1px; background:var(--db-border,#3f3f46); }
    .inbox-pane { background:var(--db-bg,#18181b); overflow:auto; min-height:0; display:flex; flex-direction:column; }
    .inbox-queue { width:300px; min-width:240px; flex:0 0 auto; }
    .inbox-conv { flex:1 1 auto; min-width:0; }
    .inbox-rail { width:300px; min-width:260px; flex:0 0 auto; }
    .inbox-head { padding:12px 14px; border-bottom:1px solid var(--db-border,#3f3f46);
      font-size:14px; font-weight:600; position:sticky; top:0; background:var(--db-bg,#18181b); z-index:2; }
    .inbox-filters { padding:10px 12px; border-bottom:1px solid var(--db-border,#3f3f46);
      display:flex; flex-direction:column; gap:8px; }
    .inbox-search { width:100%; box-sizing:border-box; padding:6px 10px; border-radius:8px;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); color:var(--db-text,#e4e4e7); font-size:13px; }
    .inbox-chips { display:flex; flex-wrap:wrap; gap:6px; }
    .inbox-chip { padding:4px 10px; font-size:12px; border-radius:999px; cursor:pointer;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); color:var(--db-text-dim,#a1a1aa); }
    .inbox-chip.active { color:#fff; background:var(--db-accent,#6366f1); border-color:var(--db-accent,#6366f1); }
    .inbox-list { flex:1 1 auto; overflow:auto; }
    .inbox-row { display:flex; gap:10px; padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--db-border,#3f3f46); }
    .inbox-row:hover { background:var(--db-card-bg,#27272a); }
    .inbox-row.active { background:var(--db-card-bg,#27272a); border-left:3px solid var(--db-accent,#6366f1); }
    .inbox-row-icon { font-size:18px; flex:0 0 auto; }
    .inbox-row-body { flex:1 1 auto; min-width:0; }
    .inbox-row-top { display:flex; justify-content:space-between; gap:6px; align-items:center; }
    .inbox-row-sender { font-weight:600; font-size:13px; color:var(--db-text,#e4e4e7); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .inbox-row-time { font-size:11px; color:var(--db-text-dim,#a1a1aa); flex:0 0 auto; }
    .inbox-row-preview { font-size:12px; color:var(--db-text-dim,#a1a1aa); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .inbox-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; margin-top:5px; }
    .inbox-empty { padding:32px 20px; text-align:center; color:var(--db-text-dim,#a1a1aa); font-size:13px; }
    .inbox-empty a { color:var(--db-accent,#6366f1); }
    .inbox-msgs { flex:1 1 auto; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:8px; }
    .inbox-msg { max-width:80%; padding:8px 12px; border-radius:10px; font-size:13px; line-height:1.5; }
    .inbox-msg-in { align-self:flex-start; background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); }
    .inbox-msg-out { align-self:flex-end; background:var(--db-accent,#6366f1); color:#fff; }
    .inbox-composer { display:flex; gap:8px; padding:12px; border-top:1px solid var(--db-border,#3f3f46); }
    .inbox-composer textarea { flex:1; resize:none; min-height:40px; max-height:96px; padding:8px 10px;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); border-radius:8px; color:var(--db-text,#e4e4e7); font-size:13px; box-sizing:border-box; }
    .inbox-btn { padding:8px 16px; background:var(--db-accent,#6366f1); color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:13px; }
    .inbox-btn:disabled { opacity:.5; cursor:not-allowed; }
    .inbox-rail-sec { padding:14px; border-bottom:1px solid var(--db-border,#3f3f46); }
    .inbox-rail-label { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--db-text-dim,#a1a1aa); margin-bottom:6px; }
    .inbox-select { width:100%; box-sizing:border-box; padding:6px 10px; border-radius:8px;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); color:var(--db-text,#e4e4e7); font-size:13px; }
    .inbox-pill-group { display:flex; flex-wrap:wrap; gap:6px; }
    .inbox-pill { padding:4px 10px; font-size:12px; border-radius:999px; cursor:pointer;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); color:var(--db-text-dim,#a1a1aa); }
    .inbox-pill.active { color:#fff; }
    .inbox-action { display:block; width:100%; box-sizing:border-box; text-align:center; margin-top:8px; padding:8px;
      border-radius:8px; font-size:13px; cursor:pointer; text-decoration:none;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); color:var(--db-text,#e4e4e7); }
    .inbox-banner { padding:8px 12px; background:rgba(245,158,11,.15); border:1px solid rgba(245,158,11,.35);
      color:#f59e0b; font-size:12px; border-radius:8px; margin:12px; }
    .inbox-strip { font-size:12px; color:var(--db-text-dim,#a1a1aa); font-weight:400; }
    @media (max-width:768px) {
      .inbox { flex-direction:column; }
      .inbox-queue, .inbox-conv, .inbox-rail { width:auto; }
    }
  `;
  document.head.appendChild(style);
}

async function fetchJSON(url, opts) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

export async function render(container) {
  container.setAttribute('data-page', 'inbox');
  injectStyles();
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  const [sessRes, chRes, agentsRes, defsRes] = await Promise.allSettled([
    fetchJSON('/api/sessions'),
    fetchJSON('/api/channels'),
    fetchJSON('/agents'),
    fetchJSON('/api/agents/definitions'),
  ]);

  const val = (r) => (r.status === 'fulfilled' ? r.value : null) || {};
  const sessions = (val(sessRes).sessions || val(sessRes) || []);
  let channels = val(chRes).channels || val(chRes) || [];
  if (!Array.isArray(channels)) {
    channels = Object.entries(channels).map(([id, c]) => ({ id, ...(typeof c === 'object' ? c : { platform: c }) }));
  }
  const agentList = new Set();
  const av = val(agentsRes);
  (av.agents || av || []).forEach((a) => agentList.add(typeof a === 'string' ? a : (a.name || a.id)));
  const dv = val(defsRes);
  (dv.definitions || dv.agents || dv || []).forEach((a) => agentList.add(typeof a === 'string' ? a : (a.name || a.id)));
  const agents = Array.from(agentList).filter(Boolean);

  const channelById = {};
  channels.forEach((c) => { channelById[c.id || c.channel_id] = c; });

  const channelSessions = sessions.filter((s) => {
    const sid = s.id || s.session_id || '';
    return String(sid).startsWith('channel-') || !!s.platform;
  });

  const runningChannels = channels.filter((c) => c.running === true).length;
  const totalChannels = channels.length;

  // Load state + history for each channel session, build threads.
  let threads = [];
  await Promise.allSettled(channelSessions.map(async (s) => {
    const sid = s.id || s.session_id;
    const channelId = s.channel_id || (String(sid).startsWith('channel-') ? String(sid).slice('channel-'.length) : sid);
    const [hist, state] = await Promise.all([
      fetchJSON('/api/chat/history/' + encodeURIComponent(sid)),
      fetchJSON('/api/sessions/' + encodeURIComponent(sid) + '/state'),
    ]);
    const messages = (hist && (hist.messages || hist.history || hist)) || [];
    const stateThreads = (state && state.state && state.state.inbox_threads) || {};
    const groups = groupMessagesBySender(sid, channelId, Array.isArray(messages) ? messages : []);
    if (groups.length === 0) {
      threads.push(buildThreadRow(
        { key: senderKey(channelId, ''), sessionId: sid, channelId, sender: '', messages: [] },
        s.platform, stateThreads));
    } else {
      groups.forEach((g) => threads.push(buildThreadRow(g, s.platform, stateThreads)));
    }
  }));

  const state = {
    platform: 'all',
    status: 'open',
    search: '',
    selected: null,
    threads,
  };

  const params = new URLSearchParams(location.search);
  if (params.get('status')) state.status = params.get('status');

  container.innerHTML = `
    <div class="inbox">
      <div class="inbox-pane inbox-queue">
        <div class="inbox-head">Channel Inbox
          <div class="inbox-strip">${runningChannels}/${totalChannels} channels online · ${threads.length} threads</div>
        </div>
        <div class="inbox-filters">
          <input class="inbox-search" id="inbox-search" placeholder="Search conversations" />
          <div class="inbox-chips" id="inbox-platform-chips"></div>
          <div class="inbox-chips" id="inbox-status-chips"></div>
        </div>
        <div class="inbox-list" id="inbox-list"></div>
      </div>
      <div class="inbox-pane inbox-conv" id="inbox-conv"></div>
      <div class="inbox-pane inbox-rail" id="inbox-rail"></div>
    </div>`;

  const listEl = container.querySelector('#inbox-list');
  const convEl = container.querySelector('#inbox-conv');
  const railEl = container.querySelector('#inbox-rail');
  const platEl = container.querySelector('#inbox-platform-chips');
  const statEl = container.querySelector('#inbox-status-chips');
  const searchEl = container.querySelector('#inbox-search');

  const platformsPresent = Array.from(new Set(threads.map((t) => t.platform).filter(Boolean)));
  const platformChips = ['all', ...platformsPresent];
  platEl.innerHTML = platformChips.map((p) =>
    `<span class="inbox-chip ${p === state.platform ? 'active' : ''}" data-platform="${esc(p)}">${p === 'all' ? 'All' : platformIcon(p) + ' ' + esc(p)}</span>`
  ).join('');

  const statusTabs = ['open', 'waiting_on_agent', 'all', 'resolved'];
  statEl.innerHTML = statusTabs.map((s) =>
    `<span class="inbox-chip ${s === state.status ? 'active' : ''}" data-status="${esc(s)}">${s === 'all' ? 'All' : statusMeta(s).label}</span>`
  ).join('');

  function filtered() {
    let rows = state.threads.filter((t) => {
      if (state.platform !== 'all' && t.platform !== state.platform) return false;
      if (state.status === 'all') { /* show all */ }
      else if (state.status === 'open') { if (t.status === 'resolved') return false; }
      else if (t.status !== state.status) return false;
      if (state.search) {
        const q = state.search.toLowerCase();
        if (!(t.senderDisplay + ' ' + t.preview).toLowerCase().includes(q)) return false;
      }
      return true;
    });
    return sortThreads(rows);
  }

  function renderList() {
    const rows = filtered();
    if (rows.length === 0) {
      if (channels.length === 0) {
        listEl.innerHTML = `<div class="inbox-empty">No channels configured<br><a href="/channels">Configure channels →</a></div>`;
      } else {
        listEl.innerHTML = `<div class="inbox-empty">No conversations in this view</div>`;
      }
      return;
    }
    listEl.innerHTML = rows.map((t) => {
      const active = state.selected === t.threadId ? 'active' : '';
      const sm = statusMeta(t.status);
      return `<div class="inbox-row ${active}" data-thread="${esc(t.threadId)}">
        <div class="inbox-row-icon">${platformIcon(t.platform)}</div>
        <div class="inbox-row-body">
          <div class="inbox-row-top">
            <span class="inbox-row-sender">${esc(t.senderDisplay)}</span>
            <span class="inbox-row-time">${relativeTime(t.updatedAt)}</span>
          </div>
          <div class="inbox-row-preview">${esc(t.preview) || '<em>No messages yet</em>'}</div>
        </div>
        <div class="inbox-dot" style="background:${sm.color}" title="${sm.label}"></div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.inbox-row').forEach((row) => {
      row.addEventListener('click', () => selectThread(row.getAttribute('data-thread')));
    });
  }

  function findThread(id) {
    return state.threads.find((t) => t.threadId === id) || null;
  }

  async function persistThread(t) {
    const body = { state: { inbox_threads: { [t.threadId]: { status: t.status, assigned_agent: t.assignedAgent } } } };
    const r = await fetchJSON('/api/sessions/' + encodeURIComponent(t.sessionId) + '/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return r != null;
  }

  function renderConversation(t) {
    if (!t) {
      convEl.innerHTML = `<div class="inbox-empty">Select a conversation to view messages</div>`;
      return;
    }
    const ch = channelById[t.channelId] || {};
    const offline = ch.running === false;
    const sm = statusMeta(t.status);
    convEl.innerHTML = `
      <div class="inbox-head">${platformIcon(t.platform)} ${esc(t.senderDisplay)}
        <span class="inbox-strip">${esc(t.platform || 'channel')} · <span style="color:${sm.color}">${sm.label}</span></span>
      </div>
      ${offline ? `<div class="inbox-banner">This channel is offline. Replies are disabled until it reconnects.</div>` : ''}
      <div class="inbox-msgs" id="inbox-msgs"></div>
      <div class="inbox-composer">
        <textarea id="inbox-reply" placeholder="Reply${t.assignedAgent ? ' as ' + esc(t.assignedAgent) : ''}…" ${offline ? 'disabled' : ''}></textarea>
        <button class="inbox-btn" id="inbox-send" ${offline ? 'disabled' : ''}>Send</button>
      </div>`;
    const msgsEl = convEl.querySelector('#inbox-msgs');
    if (!t.messages || t.messages.length === 0) {
      msgsEl.innerHTML = `<div class="inbox-empty">No messages yet</div>`;
    } else {
      msgsEl.innerHTML = t.messages.map((m) => {
        const role = String(m.role || '').toLowerCase();
        const out = role === 'assistant' || role === 'agent' || m.direction === 'outbound';
        return `<div class="inbox-msg ${out ? 'inbox-msg-out' : 'inbox-msg-in'}">${esc(m.content || m.text || '')}</div>`;
      }).join('');
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
    const sendBtn = convEl.querySelector('#inbox-send');
    const replyEl = convEl.querySelector('#inbox-reply');
    if (sendBtn) sendBtn.addEventListener('click', () => sendReply(t, replyEl, msgsEl, sendBtn));
  }

  async function sendReply(t, replyEl, msgsEl, sendBtn) {
    const content = (replyEl.value || '').trim();
    if (!content) return;
    sendBtn.disabled = true;
    const data = await fetchJSON('/api/chat/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, session_id: t.sessionId, agent_name: t.assignedAgent || undefined }),
    });
    sendBtn.disabled = false;
    if (data == null || data.error) {
      showToast(data && data.error ? data.error : 'Failed to send reply', 'error');
      return;
    }
    const msg = { role: 'agent', content, direction: 'outbound' };
    t.messages.push(msg);
    t.preview = content.slice(0, 120);
    t.updatedAt = Date.now() / 1000;
    t.status = 'waiting_on_customer';
    replyEl.value = '';
    persistThread(t);
    renderConversation(t);
    renderRail(t);
    renderList();
  }

  function renderRail(t) {
    if (!t) {
      railEl.innerHTML = `<div class="inbox-empty">Details</div>`;
      return;
    }
    const ch = channelById[t.channelId] || {};
    const chStatus = ch.running === true ? 'Connected' : ch.start_error ? 'Error' : 'Stopped';
    const opts = ['', ...agents].map((a) =>
      `<option value="${esc(a)}" ${a === t.assignedAgent ? 'selected' : ''}>${a ? esc(a) : 'Unassigned'}</option>`
    ).join('');
    const pills = STATUS_ORDER.map((s) => {
      const sm = STATUS_META[s];
      const active = s === t.status ? 'active' : '';
      const style = s === t.status ? `background:${sm.color};border-color:${sm.color}` : '';
      return `<span class="inbox-pill ${active}" data-status="${s}" style="${style}">${sm.label}</span>`;
    }).join('');
    railEl.innerHTML = `
      <div class="inbox-head">Details</div>
      <div class="inbox-rail-sec">
        <div class="inbox-rail-label">Customer</div>
        <div style="font-size:13px">${esc(t.senderDisplay)}</div>
        <div style="font-size:12px;color:var(--db-text-dim,#a1a1aa)">${esc(t.platform || 'channel')} · ${esc(t.sender || 'general')}</div>
      </div>
      <div class="inbox-rail-sec">
        <div class="inbox-rail-label">Assigned agent</div>
        <select class="inbox-select" id="inbox-assign">${opts}</select>
      </div>
      <div class="inbox-rail-sec">
        <div class="inbox-rail-label">Status</div>
        <div class="inbox-pill-group" id="inbox-status-pills">${pills}</div>
      </div>
      <div class="inbox-rail-sec">
        <div class="inbox-rail-label">Actions</div>
        <a class="inbox-action" href="/chat?session=${encodeURIComponent(t.sessionId)}">Open in Chat</a>
        <a class="inbox-action" href="/work?card=${encodeURIComponent(t.sessionId)}">Escalate to Work Hub</a>
        <button class="inbox-action" id="inbox-resolve">Mark resolved</button>
      </div>
      <div class="inbox-rail-sec">
        <div class="inbox-rail-label">Channel</div>
        <div style="font-size:12px">${platformIcon(t.platform)} ${esc(t.channelId)} · ${esc(chStatus)}</div>
      </div>`;
    const assignEl = railEl.querySelector('#inbox-assign');
    assignEl.addEventListener('change', async () => {
      t.assignedAgent = assignEl.value;
      const ok = await persistThread(t);
      if (ok) showToast(t.assignedAgent ? `Assigned to ${t.assignedAgent}` : 'Unassigned', 'success');
      renderList();
      renderConversation(t);
    });
    railEl.querySelectorAll('#inbox-status-pills .inbox-pill').forEach((pill) => {
      pill.addEventListener('click', async () => {
        t.status = pill.getAttribute('data-status');
        await persistThread(t);
        renderRail(t);
        renderConversation(t);
        renderList();
      });
    });
    const resolveBtn = railEl.querySelector('#inbox-resolve');
    resolveBtn.addEventListener('click', async () => {
      t.status = 'resolved';
      await persistThread(t);
      renderRail(t);
      renderList();
      showToast('Thread resolved', 'success');
    });
  }

  function selectThread(id) {
    const t = findThread(id);
    state.selected = id;
    renderList();
    renderConversation(t);
    renderRail(t);
  }

  platEl.querySelectorAll('.inbox-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.platform = chip.getAttribute('data-platform');
      platEl.querySelectorAll('.inbox-chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderList();
    });
  });
  statEl.querySelectorAll('.inbox-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.status = chip.getAttribute('data-status');
      statEl.querySelectorAll('.inbox-chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderList();
    });
  });
  searchEl.addEventListener('input', () => { state.search = searchEl.value; renderList(); });

  renderList();
  renderConversation(null);
  renderRail(null);

  const first = filtered()[0];
  if (first) selectThread(first.threadId);
}
