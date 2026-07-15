/**
 * Run Flight Recorder (/runs) — three-pane run debugger (STITCH-007).
 *
 * Left  : session picker (search + filter chips + list).
 * Center: unified timeline (chat turns, trace spans, log lines, errors merged).
 * Right : detail drawer (Summary / Span JSON / Logs / Debug tabs).
 *
 * Reuses existing APIs only — no new tracing backend:
 *   /api/sessions, /api/sessions/search, /api/sessions/{id}/preview,
 *   /api/traces, /api/traces/spans, /api/traces/status, /api/logs, /api/debug.
 *
 * Deep link: /runs?session_id={id} auto-selects a session.
 * Renders into [data-page="runs"].
 */
import {
  esc, timeAgo, filterChips, searchInput,
  formatDuration, emptyState, traceStatusBadge, timelineRow, helpBanner,
} from '/plugins/views/_helpers.js';

const MAX_EVENTS = 500;
const WINDOW_MS = 5000;

let _container = null;
let _abort = null;
let _sessions = [];
let _filter = 'all';
let _query = '';
let _selectedId = null;
let _lastData = null;

function navigate(pageId) {
  if (window.aiui?.selectPage) window.aiui.selectPage(pageId);
}

async function fetchJson(url, signal) {
  const r = await fetch(url, signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function toArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) {
    if (data && Array.isArray(data[k])) return data[k];
  }
  return [];
}

function settled(results, idx, fallback) {
  const r = results[idx];
  return r && r.status === 'fulfilled' ? r.value : fallback;
}

function sessionId(s) {
  return s.id || s.session_id || '';
}

function toEpochSeconds(input) {
  if (input == null) return null;
  if (typeof input === 'number') return input > 1e12 ? input / 1000 : input;
  const t = Date.parse(input);
  return isNaN(t) ? null : t / 1000;
}

function hashStr(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function classifySpan(span) {
  const kind = String(span.kind || '').toLowerCase();
  const name = String(span.name || '').toLowerCase();
  if (/tool/.test(kind) || name.startsWith('tool.')) return 'tool';
  if (/llm/.test(kind) || name.startsWith('llm.')) return 'llm';
  return 'system';
}

export function correlateSpanLogs(events, spans, windowMs = WINDOW_MS) {
  const windowS = windowMs / 1000;
  for (const ev of events) {
    if (ev.type !== 'error') continue;
    let best = null;
    let bestDelta = Infinity;
    for (const span of spans) {
      const delta = Math.abs((span.timestamp || 0) - (ev.timestamp || 0));
      if (delta < bestDelta) { bestDelta = delta; best = span; }
    }
    if (best && bestDelta < windowS) {
      ev.correlations = ev.correlations || [];
      ev.correlations.push(best.id);
      best.correlations = best.correlations || [];
      best.correlations.push(ev.id);
    }
  }
  return events;
}

function dedupeById(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev);
  }
  return out;
}

export function mergeTimelineEvents(sid, preview, traces, spans, logs, options = {}) {
  const windowMs = options.timestampWindowMs || WINDOW_MS;
  const maxEvents = options.maxEvents || MAX_EVENTS;
  const events = [];
  const p = preview || {};
  const agentId = p.agent_id;
  const created = toEpochSeconds(p.created_at);
  const updated = toEpochSeconds(p.updated_at);
  const windowStart = created ?? (Date.now() / 1000 - 3600);
  const windowEnd = updated ?? Date.now() / 1000;

  if ((p.total_messages || 0) > 0) {
    if (p.first_message) {
      events.push({
        type: 'message', id: 'msg-first', timestamp: created ?? windowStart,
        role: p.first_message.role, label: `${p.first_message.role || 'message'}: ${p.first_message.preview || ''}`,
        preview: p.first_message.preview, source: 'preview',
      });
    }
    if (p.last_message && (p.total_messages || 0) > 1) {
      events.push({
        type: 'message', id: 'msg-last', timestamp: updated ?? windowEnd,
        role: p.last_message.role, label: `${p.last_message.role || 'message'}: ${p.last_message.preview || ''}`,
        preview: p.last_message.preview, source: 'preview',
      });
    }
  }

  const matchedTraces = (traces || []).filter((t) => {
    const meta = t.metadata || {};
    if (meta.session_id && meta.session_id === sid) return true;
    if (agentId && t.agent_id === agentId) return true;
    const st = t.start_time;
    return st != null && Math.abs(st - windowEnd) < windowMs / 1000;
  });

  for (const t of matchedTraces) {
    events.push({
      type: 'trace_start', id: `trace-${t.id}`, timestamp: t.start_time,
      label: t.name || `trace ${String(t.id).slice(0, 8)}`, traceId: t.id,
      status: t.status, duration_ms: t.duration_ms, trace: t,
    });
  }

  const traceIds = new Set(matchedTraces.map((t) => t.id));
  let matchedSpans = (spans || []).filter((s) => traceIds.has(s.trace_id));
  if (matchedSpans.length === 0 && (spans || []).length > 0) {
    matchedSpans = (spans || []).filter((s) =>
      agentId && s.agent_id === agentId
      && s.timestamp >= windowStart && s.timestamp <= windowEnd);
  }

  for (const span of matchedSpans) {
    const rowType = classifySpan(span);
    events.push({
      type: rowType, id: `span-${span.id}`, timestamp: span.timestamp,
      label: span.name || rowType, traceId: span.trace_id,
      duration_ms: span.duration_ms, span, correlations: [],
    });
  }

  const sessionLogs = (logs || []).filter((log) => {
    const msg = String(log.message || '');
    if (sid && msg.includes(sid)) return true;
    if (agentId && String(log.logger || '').includes(agentId)) return true;
    const ts = toEpochSeconds(log.timestamp);
    return ts != null && ts >= windowStart && ts <= windowEnd;
  });

  for (const log of sessionLogs) {
    const ts = toEpochSeconds(log.timestamp);
    const level = String(log.level || '').toUpperCase();
    if (level === 'ERROR' || level === 'CRITICAL') {
      events.push({
        type: 'error', id: `log-${hashStr((log.timestamp || '') + (log.message || ''))}`,
        timestamp: ts, label: log.message || 'error', log, correlations: [],
      });
    } else {
      events.push({
        type: 'system', id: `log-${hashStr((log.timestamp || '') + (log.message || ''))}`,
        timestamp: ts, label: log.message || level, log, level,
      });
    }
  }

  correlateSpanLogs(events, matchedSpans, windowMs);

  let out = dedupeById(events).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  let truncated = false;
  if (out.length > maxEvents) {
    out = out.slice(-maxEvents);
    truncated = true;
  }
  out._truncated = truncated;
  out._matchedSpans = matchedSpans;
  return out;
}

export function parseSessionIdFromUrl(search) {
  try {
    return new URLSearchParams(search || window.location.search).get('session_id');
  } catch (e) {
    return null;
  }
}

const STYLE_ID = 'run-recorder-styles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .rr { display:flex; height:100%; min-height:0; gap:1px; background:var(--db-border,#3f3f46); }
    .rr-pane { background:var(--db-bg,#18181b); overflow:auto; min-height:0; }
    .rr-left { width:280px; min-width:240px; flex:0 0 auto; }
    .rr-center { flex:1 1 auto; min-width:0; }
    .rr-right { width:360px; min-width:320px; flex:0 0 auto; }
    .rr-head { padding:10px 14px; border-bottom:1px solid var(--db-border,#3f3f46);
      font-size:13px; font-weight:600; position:sticky; top:0; background:var(--db-bg,#18181b); z-index:2; }
    .rr-session { padding:8px 12px; cursor:pointer; border-bottom:1px solid var(--db-border,#3f3f46); }
    .rr-session:hover { background:var(--db-card-bg,#27272a); }
    .rr-session.active { background:var(--db-card-bg,#27272a); border-left:3px solid var(--db-accent,#6366f1); }
    .rr-tab { padding:6px 12px; font-size:13px; cursor:pointer; border:none; background:none;
      color:var(--db-text-dim,#a1a1aa); border-bottom:2px solid transparent; }
    .rr-tab.active { color:var(--db-text,#e4e4e7); border-bottom-color:var(--db-accent,#6366f1); }
    .rr-json { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.6;
      white-space:pre-wrap; background:var(--db-card-bg,#27272a); border:1px solid var(--db-border,#3f3f46);
      border-radius:8px; padding:10px; max-height:50vh; overflow:auto; }
    .rr-timeline-row.selected { background:var(--db-card-bg,#27272a) !important; }
    .rr-log-hi { background:rgba(234,179,8,.14); }
    .rr-banner { padding:10px 14px; margin:12px; border-radius:8px; font-size:13px; }
    @media (max-width:1023px) {
      .rr { flex-direction:column; }
      .rr-left, .rr-right { width:auto; }
    }
  `;
  document.head.appendChild(style);
}

function skeleton() {
  const rows = Array.from({ length: 5 }).map(() =>
    '<div style="height:32px;margin:6px 12px;border-radius:6px;background:var(--db-card-bg,#27272a);opacity:.5"></div>').join('');
  return `<div style="padding:8px 0">${rows}</div>`;
}

function filteredSessions() {
  let list = _sessions.slice();
  if (_filter === 'errors') {
    list = list.filter((s) => (s.labels || []).some((l) => /error|fail/i.test(l)) || s.has_error);
  } else if (_filter === 'today') {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const cut = dayStart.getTime() / 1000;
    list = list.filter((s) => (toEpochSeconds(s.updated_at) || 0) >= cut);
  }
  if (_query) {
    const q = _query.toLowerCase();
    list = list.filter((s) =>
      String(s.title || '').toLowerCase().includes(q)
      || sessionId(s).toLowerCase().includes(q));
  }
  return list;
}

function renderSessionList() {
  const list = filteredSessions();
  if (list.length === 0) {
    return emptyState({ icon: '📭', title: 'No sessions', body: _query ? 'Try a different search.' : 'Send a chat message to create one.' });
  }
  return list.slice(0, 200).map((s) => {
    const id = sessionId(s);
    const active = id === _selectedId;
    const dot = s.is_active ? '#22c55e' : '#71717a';
    return `<div class="rr-session${active ? ' active' : ''}" data-session-id="${esc(id)}">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex:0 0 auto"></span>
        <span style="flex:1;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title || id || 'session')}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:3px;font-size:11px;color:var(--db-text-dim)">
        ${s.agent_id ? `<span>${esc(s.agent_id)}</span>` : ''}
        <span>${esc(timeAgo(s.updated_at))}</span>
        <span>${esc((s.message_count ?? '') === '' ? '' : `${s.message_count} msgs`)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderLeft() {
  return `<div class="rr-head">Sessions</div>
    <div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px">
      ${searchInput('Search sessions…', 'rr-search')}
      <div style="display:flex;gap:6px">${filterChips(['all', 'errors', 'today'], _filter, 'data-rr-filter')}</div>
    </div>
    <div id="rr-session-list">${renderSessionList()}</div>`;
}

function summaryBar(session, preview, status, events) {
  const id = sessionId(session || {}) || _selectedId || '';
  const title = (session && session.title) || (preview && preview.session_id) || id;
  const tokens = (session && session.tokens) ?? (preview && preview.estimated_tokens);
  const times = events.map((e) => e.timestamp).filter((t) => typeof t === 'number');
  const dur = times.length > 1 ? (Math.max(...times) - Math.min(...times)) * 1000 : 0;
  return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--db-border);flex-wrap:wrap">
    <div style="flex:1;min-width:0">
      <div style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:12px;color:var(--db-text-dim)">
        <code style="font-family:ui-monospace,monospace">${esc(String(id).slice(0, 16))}</code>
        <button id="rr-copy-id" title="Copy session id" style="background:none;border:none;color:var(--db-text-dim);cursor:pointer">⧉</button>
        ${session && session.agent_id ? `<span style="padding:1px 8px;border-radius:10px;background:var(--db-card-bg);border:1px solid var(--db-border)">${esc(session.agent_id)}</span>` : ''}
        <span>${esc(formatDuration(dur))}</span>
        ${tokens != null ? `<span>${esc(Number(tokens).toLocaleString())} tok</span>` : ''}
        ${traceStatusBadge(status)}
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button id="rr-refresh" style="padding:8px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer;font-size:13px">Refresh</button>
      <button id="rr-export" style="padding:8px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer;font-size:13px">Export</button>
      <button id="rr-open-chat" style="padding:8px 14px;border:none;background:var(--db-accent,#6366f1);color:#fff;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500">Open in Chat</button>
    </div>
  </div>`;
}

function renderCenter(data) {
  if (!_selectedId) {
    return emptyState({ icon: '🛫', title: 'Select a session to inspect its run', body: 'Pick a session on the left, or open /runs?session_id={id}.' });
  }
  if (!data) return skeleton();
  const { session, preview, status, events, errors } = data;
  const partial = errors && (errors.traces || errors.logs || errors.spans);
  const sdkOff = status && !(status.trace_available || status.obs_available);
  let banner = '';
  if (status && status.gateway_connected === false) {
    banner = `<div class="rr-banner" style="background:rgba(239,68,68,.1);color:#ef4444">Gateway disconnected — showing cached data. <button id="rr-retry" style="margin-left:8px;background:none;border:1px solid currentColor;color:inherit;border-radius:6px;padding:2px 8px;cursor:pointer">Retry</button></div>`;
  } else if (sdkOff) {
    banner = `<div class="rr-banner" style="background:rgba(234,179,8,.1);color:#eab308">Traces unavailable — showing chat and logs only.</div>`;
  } else if (partial) {
    banner = `<div class="rr-banner" style="background:rgba(234,179,8,.1);color:#eab308">Some sources unavailable — timeline may be incomplete.</div>`;
  }
  let body;
  if (events.length === 0) {
    body = emptyState({ icon: '🕳️', title: 'No events for this session', body: 'Send a chat message or run the agent to generate activity.' });
  } else {
    const truncNote = events._truncated
      ? `<div style="padding:8px 12px;font-size:12px;color:var(--db-text-dim);text-align:center">Timeline truncated to latest ${MAX_EVENTS} events.</div>`
      : '';
    body = `${truncNote}<div id="rr-rows">${events.map(timelineRow).join('')}</div>`;
  }
  return `${summaryBar(session, preview, status, events)}${banner}${body}`;
}

function jsonBlock(obj) {
  let text;
  try { text = JSON.stringify(obj, null, 2); } catch (e) { text = String(obj); }
  return `<pre class="rr-json">${esc(text)}</pre>
    <button class="rr-copy-json" style="margin-top:8px;padding:6px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer;font-size:12px">Copy JSON</button>`;
}

function renderDrawer(ev, data) {
  const host = _container?.querySelector('#rr-right');
  if (!host) return;
  if (!ev) {
    host.innerHTML = `<div class="rr-head">Detail</div>${emptyState({ title: 'Select a timeline row', body: 'Details appear here.' })}`;
    return;
  }
  const tabs = ['Summary', 'Span JSON', 'Logs', 'Debug'];
  const tabBtns = tabs.map((t, i) =>
    `<button class="rr-tab${i === 0 ? ' active' : ''}" data-rr-tab="${esc(t)}">${esc(t)}</button>`).join('');

  const summary = `<div style="font-size:13px;line-height:1.8">
    <div><strong>Type</strong>: ${esc(ev.type)}</div>
    ${ev.label ? `<div><strong>Label</strong>: ${esc(ev.label)}</div>` : ''}
    ${ev.duration_ms != null ? `<div><strong>Duration</strong>: ${esc(formatDuration(ev.duration_ms))}</div>` : ''}
    ${ev.traceId ? `<div><strong>Trace</strong>: <code>${esc(String(ev.traceId).slice(0, 12))}</code></div>` : ''}
    ${(ev.correlations && ev.correlations.length) ? `<div><strong>Correlated</strong>: ${ev.correlations.length} item(s)</div>` : ''}
  </div>`;

  const spanJson = ev.span ? jsonBlock(ev.span) : (ev.trace ? jsonBlock(ev.trace) : `<div style="color:var(--db-text-dim);font-size:13px">No span payload for this row.</div>`);

  const correlatedLogIds = new Set(ev.correlations || []);
  const logs = (data && data.events || []).filter((e) => e.log);
  const logsHtml = logs.length === 0
    ? `<div style="color:var(--db-text-dim);font-size:13px">No log lines correlated.</div>`
    : logs.map((e) => {
      const hi = e.id === ev.id || correlatedLogIds.has(e.id) || (e.correlations || []).includes(ev.id);
      return `<div class="${hi ? 'rr-log-hi' : ''}" style="font-family:ui-monospace,monospace;font-size:12px;padding:4px 6px;border-bottom:1px solid var(--db-border)">
        <span style="color:var(--db-text-dim)">${esc((e.level || '').toUpperCase())}</span> ${esc(String((e.log && e.log.message) || e.label || '').slice(0, 200))}</div>`;
    }).join('');

  const debug = data && data.debug
    ? jsonBlock(data.debug)
    : `<div style="color:var(--db-text-dim);font-size:13px">Debug snapshot unavailable.</div>`;

  const panels = {
    Summary: summary, 'Span JSON': spanJson, Logs: logsHtml, Debug: debug,
  };

  host.innerHTML = `<div class="rr-head">Detail</div>
    <div style="display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--db-border)">${tabBtns}</div>
    <div id="rr-tabbody" style="padding:14px">${panels.Summary}</div>`;

  host.querySelectorAll('.rr-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      host.querySelectorAll('.rr-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const body = host.querySelector('#rr-tabbody');
      if (body) body.innerHTML = panels[btn.dataset.rrTab] || '';
      bindCopy(host, ev);
    });
  });
  bindCopy(host, ev);
}

function bindCopy(host, ev) {
  host.querySelectorAll('.rr-copy-json').forEach((btn) => {
    btn.addEventListener('click', () => {
      const payload = ev.span || ev.trace || ev.log || ev;
      try { navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); } catch (e) { /* ignore */ }
    });
  });
}

function buildExport(data) {
  if (!data) return '';
  const lines = [`# Run ${_selectedId}`, ''];
  for (const ev of data.events) {
    const when = ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : '';
    lines.push(`- ${when} [${ev.type}] ${String(ev.label || '').slice(0, 120)}`);
  }
  return lines.join('\n');
}

function openInChat() {
  if (!_selectedId) return;
  const id = _selectedId;
  Promise.resolve(navigate('chat')).then(() => {
    try {
      window.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: id } }));
    } catch (e) { /* ignore */ }
  });
}

async function loadTimeline(sid) {
  const centerHost = _container?.querySelector('#rr-center');
  if (centerHost) centerHost.innerHTML = `${skeleton()}<div style="text-align:center;color:var(--db-text-dim);font-size:13px">Loading run data…</div>`;

  if (_abort) _abort.abort();
  _abort = new AbortController();
  const signal = _abort.signal;

  const session = _sessions.find((s) => sessionId(s) === sid) || {};
  const agentId = session.agent_id || '';
  const agentQ = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';

  const results = await Promise.allSettled([
    fetchJson(`/api/sessions/${encodeURIComponent(sid)}/preview`, signal),
    fetchJson(`/api/traces?limit=50${agentQ}`, signal),
    fetchJson('/api/traces/status', signal),
    fetchJson('/api/logs?limit=200', signal),
    fetchJson('/api/debug', signal),
  ]);

  if (signal.aborted) return;

  const preview = settled(results, 0, {});
  const traces = toArray(settled(results, 1, {}), 'traces');
  const status = settled(results, 2, {});
  const logs = toArray(settled(results, 3, {}), 'logs');
  const debug = settled(results, 4, null);

  const traceIds = traces
    .filter((t) => {
      const meta = t.metadata || {};
      if (meta.session_id && meta.session_id === sid) return true;
      return agentId && t.agent_id === agentId;
    })
    .map((t) => t.id)
    .slice(0, 10);

  let spans = [];
  let spansFailed = false;
  if (traceIds.length) {
    const spanResults = await Promise.allSettled(
      traceIds.map((id) => fetchJson(`/api/traces/spans?trace_id=${encodeURIComponent(id)}&limit=200`, signal)));
    if (signal.aborted) return;
    for (const r of spanResults) {
      if (r.status === 'fulfilled') spans = spans.concat(toArray(r.value, 'spans'));
      else spansFailed = true;
    }
  } else {
    try {
      spans = toArray(await fetchJson('/api/traces/spans?limit=200', signal), 'spans');
    } catch (e) { spansFailed = true; }
  }

  if (signal.aborted) return;

  const events = mergeTimelineEvents(sid, preview, traces, spans, logs);
  const data = {
    session, preview, status, debug, events,
    errors: {
      traces: results[1].status === 'rejected',
      logs: results[3].status === 'rejected',
      spans: spansFailed,
    },
  };
  _lastData = data;
  if (centerHost) centerHost.innerHTML = renderCenter(data);
  bindCenter(data);
  renderDrawer(null, data);
}

function selectSession(sid) {
  _selectedId = sid;
  try {
    const url = `${window.location.pathname}?session_id=${encodeURIComponent(sid)}`;
    history.replaceState({ pageId: 'runs' }, '', url);
  } catch (e) { /* ignore */ }
  const listHost = _container?.querySelector('#rr-session-list');
  if (listHost) listHost.innerHTML = renderSessionList();
  bindSessionRows();
  loadTimeline(sid);
}

function bindSessionRows() {
  _container?.querySelectorAll('.rr-session').forEach((row) => {
    row.addEventListener('click', () => selectSession(row.dataset.sessionId));
  });
}

function bindLeft() {
  const search = _container?.querySelector('#rr-search');
  if (search) {
    search.addEventListener('input', (e) => {
      _query = e.target.value || '';
      const host = _container.querySelector('#rr-session-list');
      if (host) { host.innerHTML = renderSessionList(); bindSessionRows(); }
    });
  }
  _container?.querySelectorAll('[data-rr-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      _filter = btn.getAttribute('data-rr-filter');
      const left = _container.querySelector('#rr-left');
      if (left) { left.innerHTML = renderLeft(); bindLeft(); }
    });
  });
  bindSessionRows();
}

function bindCenter(data) {
  const c = _container;
  if (!c) return;
  c.querySelector('#rr-refresh')?.addEventListener('click', () => { if (_selectedId) loadTimeline(_selectedId); });
  c.querySelector('#rr-retry')?.addEventListener('click', () => { if (_selectedId) loadTimeline(_selectedId); });
  c.querySelector('#rr-open-chat')?.addEventListener('click', openInChat);
  c.querySelector('#rr-copy-id')?.addEventListener('click', () => {
    try { navigator.clipboard.writeText(_selectedId || ''); } catch (e) { /* ignore */ }
  });
  c.querySelector('#rr-export')?.addEventListener('click', () => {
    try { navigator.clipboard.writeText(buildExport(data)); } catch (e) { /* ignore */ }
  });
  c.querySelectorAll('.db-timeline-row').forEach((row) => {
    const activate = () => {
      c.querySelectorAll('.db-timeline-row').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      const ev = (data.events || []).find((e) => e.id === row.dataset.eventId);
      if (ev) renderDrawer(ev, data);
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

async function loadSessions() {
  const listHost = _container?.querySelector('#rr-session-list');
  if (listHost) listHost.innerHTML = skeleton();
  try {
    const data = _query
      ? await fetchJson(`/api/sessions/search?q=${encodeURIComponent(_query)}`)
      : await fetchJson('/api/sessions');
    _sessions = toArray(data, 'sessions');
  } catch (e) {
    _sessions = [];
    if (listHost) {
      listHost.innerHTML = emptyState({
        icon: '⚠️', title: 'Could not load sessions',
        actionHtml: '<button id="rr-sessions-retry" style="padding:8px 16px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px">Retry</button>',
      });
      listHost.querySelector('#rr-sessions-retry')?.addEventListener('click', loadSessions);
    }
    return;
  }
  if (listHost) { listHost.innerHTML = renderSessionList(); bindSessionRows(); }
}

function shell() {
  return `<div class="rr">
    <div class="rr-pane rr-left" id="rr-left">${renderLeft()}</div>
    <div class="rr-pane rr-center" id="rr-center">${renderCenter(null)}</div>
    <div class="rr-pane rr-right" id="rr-right"></div>
  </div>
  <div style="padding:0 12px 12px">
    ${helpBanner({
      title: 'Run Flight Recorder',
      what: 'Merges chat turns, trace spans, log lines and errors into one timeline for a single session so you can see exactly what happened inside a run.',
      howToUse: 'Pick a session on the left. The center timeline shows events in order; click any row to inspect its details, span JSON, and correlated logs on the right.',
      tip: 'Events are correlated by agent and timestamp when spans lack an exact session id. Use "Open in Chat" to resume the conversation.',
      collapsed: true,
    })}
  </div>`;
}

export async function render(container) {
  _container = container;
  injectStyles();
  _selectedId = null;
  _query = '';
  _filter = 'all';
  container.innerHTML = shell();
  bindLeft();
  renderDrawer(null, null);
  await loadSessions();

  const urlSid = parseSessionIdFromUrl();
  if (urlSid) {
    _selectedId = urlSid;
    const listHost = container.querySelector('#rr-session-list');
    if (listHost) { listHost.innerHTML = renderSessionList(); bindSessionRows(); }
    loadTimeline(urlSid);
  }
}

export function cleanup() {
  if (_abort) { try { _abort.abort(); } catch (e) { /* ignore */ } _abort = null; }
  _container = null;
  _sessions = [];
  _selectedId = null;
  _lastData = null;
}
