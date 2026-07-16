/**
 * Unified Work Hub (/work) — three-pane operator surface (STITCH-003).
 *
 * Pane 1: Kanban board (reuses createInteractiveBoard from board.js).
 * Pane 2: Selected card detail with Description / Chat / Tools / Traces tabs.
 * Pane 3: Activity — job runs, live log, trace link for the card's latest run.
 *
 * Card selection updates panes 2+3 without a page navigation. URL state
 * (?board=&card=&tab=) is kept in sync for deep links.
 */
import { createInteractiveBoard, relativeTime, escapeHtml } from '../board.js';

const STYLE_ID = 'work-hub-styles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .work-hub { display:flex; height:100%; min-height:0; gap:1px; background:var(--db-border,#3f3f46); }
    .work-hub-pane { background:var(--db-bg,#18181b); overflow:auto; min-height:0; }
    .work-hub-p1 { width:300px; min-width:240px; flex:0 0 auto; }
    .work-hub-p2 { flex:1 1 auto; min-width:0; }
    .work-hub-p3 { width:320px; min-width:280px; flex:0 0 auto; }
    .work-hub-pane-head { padding:10px 14px; border-bottom:1px solid var(--db-border,#3f3f46);
      font-size:13px; font-weight:600; position:sticky; top:0; background:var(--db-bg,#18181b); z-index:2; }
    .work-hub-empty { padding:24px; text-align:center; color:var(--db-text-dim,#a1a1aa); font-size:13px; }
    .work-hub-tabs { display:flex; gap:4px; padding:8px 14px 0; border-bottom:1px solid var(--db-border,#3f3f46); }
    .work-hub-tab { padding:6px 12px; font-size:13px; cursor:pointer; border:none; background:none;
      color:var(--db-text-dim,#a1a1aa); border-bottom:2px solid transparent; }
    .work-hub-tab.active { color:var(--db-text,#e4e4e7); border-bottom-color:var(--db-accent,#6366f1); }
    .work-hub-tab:disabled { opacity:.4; cursor:not-allowed; }
    .work-hub-tabbody { padding:14px; }
    .work-hub-chat-log { display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }
    .work-hub-chat-msg { padding:8px 10px; border-radius:8px; font-size:13px; line-height:1.5;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); }
    .work-hub-chat-msg .role { font-size:11px; font-weight:600; color:var(--db-accent,#6366f1); }
    .work-hub-composer { display:flex; gap:8px; align-items:flex-end; }
    .work-hub-composer textarea { flex:1; resize:none; min-height:40px; max-height:64px; padding:8px 10px;
      background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46); border-radius:8px;
      color:var(--db-text,#e4e4e7); font-size:13px; box-sizing:border-box; }
    .work-hub-log { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
      line-height:1.6; white-space:pre-wrap; background:var(--db-card-bg,#27272a);
      border:1px solid var(--db-border,#3f3f46); border-radius:8px; padding:10px; max-height:40vh; overflow:auto; }
    .work-hub-job { display:flex; align-items:center; gap:8px; padding:6px 0; font-size:13px; }
    .work-hub-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
    @media (max-width:1024px) {
      .work-hub { flex-direction:column; }
      .work-hub-p1, .work-hub-p2, .work-hub-p3 { width:auto; }
    }
  `;
  document.head.appendChild(style);
}

function statusColor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'success') return '#22c55e';
  if (s === 'running' || s === 'in_progress') return '#f59e0b';
  if (s === 'failed' || s === 'error' || s === 'blocked') return '#ef4444';
  return '#6366f1';
}

export async function render(container) {
  container.setAttribute('data-page', 'work');
  container.classList.add('work-hub-page');
  container.innerHTML = '';
  injectStyles();

  const params = new URLSearchParams(window.location.search);
  const boardState = { id: params.get('board') || 'default' };
  let selectedCard = null;
  let activeTab = params.get('tab') || 'description';
  const pendingCardId = params.get('card');

  const hub = document.createElement('div');
  hub.className = 'work-hub';
  container.appendChild(hub);

  const p1 = document.createElement('div');
  p1.className = 'work-hub-pane work-hub-p1';
  const p1Body = document.createElement('div');
  p1.appendChild(p1Body);
  hub.appendChild(p1);

  const p2 = document.createElement('div');
  p2.className = 'work-hub-pane work-hub-p2';
  hub.appendChild(p2);

  const p3 = document.createElement('div');
  p3.className = 'work-hub-pane work-hub-p3';
  hub.appendChild(p3);

  function syncUrl() {
    const q = new URLSearchParams();
    q.set('board', boardState.id);
    if (selectedCard) { q.set('card', selectedCard.id); q.set('tab', activeTab); }
    const url = `${window.location.pathname}?${q.toString()}`;
    window.history.replaceState({}, '', url);
  }

  function renderDetail() {
    if (!selectedCard) {
      p2.innerHTML = '<div class="work-hub-empty">Select a card to see its details.</div>';
      return;
    }
    const c = selectedCard;
    const meta = c.meta || {};
    const hasAgent = !!(c.assignee || meta.agent_id);
    const tabs = [
      ['description', 'Description', false],
      ['chat', 'Chat', !hasAgent],
      ['tools', 'Tools', false],
      ['traces', 'Traces', false],
    ];
    p2.innerHTML = `
      <div class="work-hub-pane-head">${escapeHtml(c.title || 'Card')}
        <span class="db-text-dim" style="font-weight:400;font-size:12px;margin-left:8px">${escapeHtml(c.status || '')}</span>
      </div>
      <div class="work-hub-tabs">
        ${tabs.map(([id, label, disabled]) =>
          `<button class="work-hub-tab ${id === activeTab ? 'active' : ''}" data-tab="${id}" ${disabled ? 'disabled' : ''}>${label}</button>`
        ).join('')}
      </div>
      <div class="work-hub-tabbody" id="work-hub-tabbody"></div>`;

    p2.querySelectorAll('.work-hub-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        activeTab = btn.getAttribute('data-tab');
        syncUrl();
        renderDetail();
      });
    });

    const body = p2.querySelector('#work-hub-tabbody');
    if (activeTab === 'description') {
      body.innerHTML = c.body
        ? `<div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escapeHtml(c.body)}</div>`
        : '<div class="work-hub-empty">No description.</div>';
    } else if (activeTab === 'chat') {
      renderChat(body, c);
    } else if (activeTab === 'tools') {
      const tools = meta.tools || [];
      body.innerHTML = tools.length
        ? tools.map((t) => `<span class="db-badge" style="display:inline-block;margin:2px;padding:2px 8px;border-radius:6px;background:var(--db-card-bg,#27272a);font-size:12px">${escapeHtml(String(t))}</span>`).join('')
        : '<div class="work-hub-empty">No tools listed for this card.</div>';
    } else if (activeTab === 'traces') {
      const sessionId = meta.session_id;
      body.innerHTML = sessionId
        ? `<div style="display:flex;flex-direction:column;gap:8px">
            <a href="/runs?session_id=${encodeURIComponent(sessionId)}" style="color:var(--db-accent,#6366f1)">Debug this run →</a>
            <a href="/traces?session_id=${encodeURIComponent(sessionId)}" style="color:var(--db-accent,#6366f1)">Open traces for this session →</a>
          </div>`
        : '<div class="work-hub-empty">No traces linked.</div>';
    }
  }

  function renderChat(body, card) {
    const agentId = card.assignee || (card.meta || {}).agent_id || '';
    body.innerHTML = `
      <div class="work-hub-chat-log" id="work-hub-chat-log">
        <div class="work-hub-empty">Ask the assigned agent (${escapeHtml(agentId)}) about this card.</div>
      </div>
      <div class="work-hub-composer">
        <textarea id="work-hub-composer" rows="2" placeholder="Message ${escapeHtml(agentId)}…"></textarea>
        <button class="db-btn db-btn-sm" id="work-hub-send">Send</button>
      </div>
      <div style="margin-top:8px;font-size:12px"><a href="/chat" style="color:var(--db-accent,#6366f1)">Open full chat →</a></div>`;

    const log = body.querySelector('#work-hub-chat-log');
    const ta = body.querySelector('#work-hub-composer');
    const send = body.querySelector('#work-hub-send');
    send.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return;
      const msg = document.createElement('div');
      msg.className = 'work-hub-chat-msg';
      msg.innerHTML = `<div class="role">You</div>${escapeHtml(text)}`;
      if (log.querySelector('.work-hub-empty')) log.innerHTML = '';
      log.appendChild(msg);
      ta.value = '';
      log.scrollTop = log.scrollHeight;
    });
  }

  async function renderActivity() {
    if (!selectedCard) {
      p3.innerHTML = '<div class="work-hub-pane-head">Activity</div><div class="work-hub-empty">No card selected.</div>';
      return;
    }
    const meta = selectedCard.meta || {};
    const jobId = meta.job_id;
    p3.innerHTML = '<div class="work-hub-pane-head">Activity</div><div class="work-hub-empty">Loading…</div>';
    if (!jobId) {
      p3.innerHTML = '<div class="work-hub-pane-head">Activity</div><div class="work-hub-empty">No jobs linked to this card.</div>';
      return;
    }
    let job = null;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (res.ok) job = await res.json();
    } catch (_) { /* offline */ }
    if (!job) {
      p3.innerHTML = '<div class="work-hub-pane-head">Activity</div><div class="work-hub-empty">Could not load job.</div>';
      return;
    }
    const logLines = (job.log || job.output || '').split('\n').slice(-50).join('\n');
    p3.innerHTML = `
      <div class="work-hub-pane-head">Activity</div>
      <div style="padding:14px">
        <div class="work-hub-job">
          <span class="work-hub-dot" style="background:${statusColor(job.status)}"></span>
          <span>${escapeHtml(job.id || jobId)}</span>
          <span class="db-text-dim" style="margin-left:auto;font-size:12px">${escapeHtml(job.status || '')}</span>
        </div>
        <div style="font-size:11px;color:var(--db-text-dim,#a1a1aa);margin:4px 0 10px">${job.updated_at ? relativeTime(job.updated_at) : ''}</div>
        <div class="work-hub-log">${escapeHtml(logLines) || 'No log output.'}</div>
        ${meta.session_id ? `<div style="margin-top:10px"><a href="/traces?session_id=${encodeURIComponent(meta.session_id)}" style="color:var(--db-accent,#6366f1);font-size:12px">Open trace →</a></div>` : ''}
      </div>`;
  }

  function selectCard(card) {
    selectedCard = card;
    if (card && (!activeTab)) activeTab = 'description';
    syncUrl();
    renderDetail();
    renderActivity();
  }

  let pendingHandled = !pendingCardId;
  function tryDeepLink(data) {
    for (const col of data.columns || []) {
      for (const card of col.cards || []) {
        if (card.id === pendingCardId) { pendingHandled = true; selectCard(card); return; }
      }
    }
  }

  const board = createInteractiveBoard(p1Body, {
    apiBase: '/api/kanban',
    eventsUrl: '/api/kanban/events',
    pollMs: 8000,
    debounceMs: 500,
    interactive: true,
    laneByProfile: true,
    boardSwitcher: true,
    boardState,
    onOpen: (card) => {
      pendingHandled = true;
      selectCard(card);
    },
    fetch: async () => {
      const [boardRes, boardsRes] = await Promise.all([
        fetch(`/api/kanban/board?board=${encodeURIComponent(boardState.id)}`),
        fetch('/api/kanban/boards'),
      ]);
      if (!boardRes.ok) throw new Error(await boardRes.text());
      const data = await boardRes.json();
      if (boardsRes.ok) {
        const b = await boardsRes.json();
        data.boards = b.boards || [{ id: 'default', title: 'Default' }];
      }
      if (!pendingHandled && pendingCardId) tryDeepLink(data);
      return data;
    },
  });

  renderDetail();
  renderActivity();

  return () => board.destroy();
}
