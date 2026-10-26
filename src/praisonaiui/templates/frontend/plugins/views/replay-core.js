/**
 * PraisonAI Replay — pure model functions (no DOM, no network, no deps).
 *
 *   buildModel(events, graph) -> { lanes, blocks, arrows, chapters, totals, narration, ... }
 *   narrate(event, related?)  -> one deterministic sentence ('' when not worth saying)
 *   layoutMap(graph)          -> { nodes:[{x,y,w,h,shape,...}], edges:[{points,...}], width, height }
 *   deriveGraph(events)       -> who-talked-to-whom graph for runs without a recorded graph
 *
 * Input is the trace event stream of contract v1 (ContextEvent.to_dict(), schema
 * 1.0 or 1.1). Unknown event types and fields are ignored, never fatal.
 *
 * Loaded three ways: ES import by the dashboard view (replay.js), `node --test`,
 * and inlined into a standalone HTML export (it then also sets
 * globalThis.PraisonReplayCore so the inlined replay.js can find it).
 */

export const PALETTE = Object.freeze({
  agent: '#8B0000',
  tool: '#0F7287',
  human: '#8A5A00',
  manager: '#3C4A5C',
});

/** Shape per node/lane kind. Colour is never the only signal. */
export const SHAPES = Object.freeze({
  agent: 'circle',
  tool: 'rounded',
  human: 'diamond',
  manager: 'square',
  task: 'note',
  step: 'rect',
  start: 'chevron',
  end: 'flag',
  fork: 'bar',
  join: 'bar',
  decision: 'hexagon',
});

export const HUMAN_LANE = 'human:you';
export const MANAGER_LANE = 'manager:Manager';

const PAIRS = {
  tool_call_start: 'tool_call_end',
  llm_request: 'llm_response',
  approval_requested: 'approval_decided',
  task_start: 'task_end',
  step_start: 'step_end',
  agent_start: 'agent_end',
  workflow_start: 'workflow_end',
  session_start: 'session_end',
};
const END_OF = Object.fromEntries(Object.entries(PAIRS).map(([s, e]) => [e, s]));

/** Approvers that mean "a person decided", anything else is an automatic source. */
const HUMAN_APPROVERS = new Set(['user', 'human', 'you', 'ui', 'replay', 'console', 'web', 'dashboard']);

const HANDOFF_VERBS = {
  handoff: ['handed off to', 'hands off'],
  delegate: ['delegated to', 'delegates'],
  route: ['routed to', 'routes'],
  spawn: ['spawned', 'spawns'],
};

// ── small helpers ─────────────────────────────────────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : 0);
const str = (v) => (v == null ? '' : String(v));
const dataOf = (ev) => (ev && ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data) ? ev.data : {});

export function eventId(ev, index = 0) {
  const seq = isNum(ev && ev.sequence_num) ? ev.sequence_num : `i${index}`;
  return `${str(ev && ev.session_id)}:${seq}`;
}

export function truncate(text, max = 60) {
  const s = str(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "850 ms", "1.2 s", "2 min 05 s". Deterministic (no locale). */
export function formatDuration(ms) {
  if (!isNum(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

/** "$0.002", "$1.25", "<$0.0001", '' for zero/unknown. */
export function formatCost(usd) {
  if (!isNum(usd) || usd <= 0) return '';
  if (usd < 0.0001) return '<$0.0001';
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function stripPrefix(id) {
  const s = str(id);
  const i = s.indexOf(':');
  return i >= 0 ? s.slice(i + 1) : s;
}

const ARG_KEYS = ['query', 'q', 'search', 'url', 'path', 'file', 'expression', 'command', 'cmd', 'title', 'text', 'prompt', 'input'];

/** The most telling argument of a tool call, for one sentence. */
export function argPreview(args) {
  if (args == null) return '';
  if (typeof args !== 'object') return truncate(args, 48);
  for (const k of ARG_KEYS) {
    if (typeof args[k] === 'string' && args[k]) return truncate(args[k], 48);
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v) return truncate(v, 48);
  }
  const keys = Object.keys(args);
  return keys.length ? truncate(JSON.stringify(args), 48) : '';
}

/** Stable order: sequence_num, then arrival; drops exact duplicate event ids. */
export function sortEvents(events) {
  const seen = new Set();
  const out = [];
  (Array.isArray(events) ? events : []).forEach((ev, i) => {
    if (!ev || typeof ev !== 'object') return;
    const id = eventId(ev, i);
    if (isNum(ev.sequence_num)) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    out.push({ ev, i });
  });
  out.sort((a, b) => {
    const sa = isNum(a.ev.sequence_num) ? a.ev.sequence_num : Infinity;
    const sb = isNum(b.ev.sequence_num) ? b.ev.sequence_num : Infinity;
    return sa - sb || a.i - b.i;
  });
  return out.map((o) => o.ev);
}

// ── narration ─────────────────────────────────────────────────────────

/** Quote user text; trailing sentence punctuation is dropped so lines end cleanly. */
function q(text) {
  const t = truncate(str(text).replace(/[\s.!?]+$/, ''), 70);
  return t ? `'${t}'` : '';
}

function costTail(parts) {
  const bits = parts.filter(Boolean);
  return bits.length ? ` — ${bits.join(', ')}` : '';
}

function durOf(ev, related) {
  const d = dataOf(ev);
  if (isNum(d.duration_ms)) return d.duration_ms;
  if (related && isNum(related.timestamp) && isNum(ev.timestamp)) {
    return Math.abs(ev.timestamp - related.timestamp) * 1000;
  }
  return null;
}

/**
 * One sentence for a meaningful event, from fixed templates (no LLM).
 * `related` is the paired event when known (the end for a start, or vice versa),
 * so a tool call can be told with its duration and cost in one line.
 * Returns '' for events not worth a line (snapshots, unknown types).
 */
export function narrate(ev, related = null) {
  if (!ev || typeof ev !== 'object') return '';
  const d = dataOf(ev);
  const rd = dataOf(related);
  const who = str(ev.agent_name) || 'The run';
  switch (ev.event_type) {
    case 'session_start':
      return 'Recording started.';
    case 'session_end':
      return 'Recording ended.';
    case 'workflow_start': {
      const kind = { team: 'Team', flow: 'Flow', agent: 'Agent' }[d.kind] || 'Run';
      const name = d.name ? ` '${truncate(d.name, 60)}'` : '';
      const proc = d.process && d.process !== d.kind ? ` (${d.process})` : '';
      return `${kind}${name} started${proc}.`;
    }
    case 'workflow_end': {
      const dur = formatDuration(durOf(ev, related));
      const verb = d.status === 'failed' ? 'failed' : 'completed';
      return `The run ${verb}${dur ? ` after ${dur}` : ''}.`;
    }
    case 'task_start': {
      const name = d.name || stripPrefix(ev.node_id) || 'task';
      const to = d.agent || ev.agent_name;
      return to ? `Task '${truncate(name, 50)}' went to ${to}.` : `Task '${truncate(name, 50)}' started.`;
    }
    case 'task_end': {
      const name = rd.name || d.name || stripPrefix(ev.node_id) || 'task';
      const dur = formatDuration(durOf(ev, related));
      const retries = num(d.retries);
      const r = retries ? `, ${retries} ${retries === 1 ? 'retry' : 'retries'}` : '';
      if (d.status === 'failed') return `Task '${truncate(name, 50)}' failed${dur ? ` after ${dur}` : ''}${r}.`;
      if (d.status === 'skipped') return `Task '${truncate(name, 50)}' was skipped.`;
      return `Task '${truncate(name, 50)}' finished${dur ? ` in ${dur}` : ''}${r}.`;
    }
    case 'step_start': {
      const name = truncate(d.name || stripPrefix(ev.node_id) || 'step', 50);
      const pass = isNum(d.iteration) ? ` (pass ${d.iteration})` : '';
      if (d.pattern === 'parallel') return `Step '${name}' fanned out in parallel.`;
      if (d.pattern === 'loop' || d.pattern === 'repeat') return `Loop '${name}' started.`;
      if (d.pattern === 'route' || d.pattern === 'if') return `Step '${name}' is choosing a route.`;
      if (d.pattern === 'discussion') return `Discussion '${name}' started.`;
      return `Step '${name}' started${pass}.`;
    }
    case 'step_end': {
      const name = truncate(rd.name || d.name || stripPrefix(ev.node_id) || 'step', 50);
      const dur = formatDuration(durOf(ev, related));
      if (d.route) return `Step '${name}' chose route '${truncate(d.route, 40)}'.`;
      if (d.status === 'cached') return `Step '${name}' reused a cached result.`;
      if (d.status === 'skipped') return `Step '${name}' was skipped.`;
      if (d.status === 'failed') return `Step '${name}' failed${dur ? ` after ${dur}` : ''}.`;
      return `Step '${name}' finished${dur ? ` in ${dur}` : ''}.`;
    }
    case 'agent_start':
      return `${who} started.`;
    case 'agent_end':
      return d.status === 'failed' ? `${who} stopped with an error.` : `${who} finished.`;
    case 'agent_handoff': {
      const kind = HANDOFF_VERBS[d.kind] ? d.kind : 'handoff';
      const from = d.from_agent || ev.agent_name || 'An agent';
      const to = d.to_agent || 'another agent';
      const reason = d.reason ? `: ${q(d.reason)}` : '';
      return `${from} ${HANDOFF_VERBS[kind][0]} ${to}${reason}.`;
    }
    case 'tool_call_start': {
      const tool = d.tool_name || 'a tool';
      const arg = argPreview(d.tool_args);
      const forArg = arg ? ` for '${arg}'` : '';
      if (!related) return `${who} is asking ${tool}${forArg}…`;
      const dur = formatDuration(durOf(related, ev));
      if (rd.error) return `${who} asked ${tool}${forArg} — failed${dur ? ` after ${dur}` : ''}: ${truncate(rd.error, 60)}.`;
      return `${who} asked ${tool}${forArg}${costTail([dur, formatCost(related.cost_usd)])}.`;
    }
    case 'tool_call_end': {
      const tool = d.tool_name || 'A tool';
      const dur = formatDuration(durOf(ev, related));
      if (d.error) return `${tool} failed for ${who}${dur ? ` after ${dur}` : ''}: ${truncate(d.error, 60)}.`;
      return `${tool} answered ${who}${costTail([dur, formatCost(ev.cost_usd)])}.`;
    }
    case 'llm_request': {
      const model = d.model ? ` with ${d.model}` : '';
      return `${who} is thinking${model}…`;
    }
    case 'llm_response': {
      const model = d.model || rd.model;
      const tokens = num(ev.prompt_tokens) + num(ev.completion_tokens);
      const parts = [formatDuration(durOf(ev, related)), tokens ? `${tokens} tokens` : '', formatCost(ev.cost_usd)];
      return `${who} thought${model ? ` with ${model}` : ''}${costTail(parts)}.`;
    }
    case 'approval_requested': {
      const tool = d.tool || 'an action';
      const risk = d.risk ? ` (${d.risk} risk)` : '';
      return d.kind === 'task_output_review'
        ? `${who} asked you to review the output of ${tool}${risk}.`
        : `${who} asked you to approve ${tool}${risk}.`;
    }
    case 'approval_decided': {
      const tool = rd.tool || d.tool || 'the request';
      const approver = str(d.approver).toLowerCase();
      const auto = approver && !HUMAN_APPROVERS.has(approver);
      if (approver === 'timeout') return `${tool} was denied: no answer before the timeout.`;
      if (d.approved) {
        if (auto) return `${tool} was approved automatically (${d.approver}).`;
        return `You approved ${tool}${d.modified ? ' with edited arguments' : ''}.`;
      }
      const reason = d.reason ? `: ${q(d.reason)}` : '';
      if (auto) return `${tool} was denied automatically (${d.approver})${reason}.`;
      return `You denied ${tool}${reason}.`;
    }
    case 'message_added': {
      const text = q(d.content);
      if (!text) return '';
      if (d.role === 'user' && !ev.agent_name) return `You said: ${text}.`;
      if (d.role === 'user') return `${who} was asked: ${text}.`;
      return '';
    }
    case 'memory_store':
      return `${who} saved a memory.`;
    case 'memory_search':
      return `${who} searched memory${d.query ? ` for ${q(d.query)}` : ''}.`;
    case 'knowledge_search':
      return `${who} searched knowledge${d.query ? ` for ${q(d.query)}` : ''}.`;
    case 'knowledge_add':
      return `${who} added knowledge.`;
    default:
      return '';
  }
}

// ── model ─────────────────────────────────────────────────────────────

function pairKey(ev) {
  const t = END_OF[ev.event_type] || ev.event_type;
  const d = dataOf(ev);
  let extra = '';
  if (t === 'tool_call_start') extra = str(d.tool_name);
  else if (t === 'approval_requested') return `${t}|${str(d.approval_id)}`;
  else if (t === 'task_start' || t === 'step_start') extra = str(ev.node_id || d.name);
  if (t === 'session_start' || t === 'workflow_start') return t;
  return `${t}|${str(ev.agent_name)}|${str(ev.branch_id)}|${extra}`;
}

/**
 * Pair start/end events. 1.1: an end's parent_seq names its start. 1.0, or
 * llm_response (a point event whose parent_seq is its scope): oldest open start
 * with the same kind/agent/branch/tool. Returns Map startIndex -> endIndex.
 */
export function pairEvents(evs) {
  const pairs = new Map();
  const bySeq = new Map();
  const open = new Map(); // key -> [index]
  evs.forEach((ev, i) => {
    const t = ev.event_type;
    if (PAIRS[t]) {
      if (isNum(ev.sequence_num)) bySeq.set(ev.sequence_num, i);
      const k = pairKey(ev);
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(i);
      return;
    }
    const startType = END_OF[t];
    if (!startType) return;
    let si = null;
    if (t !== 'llm_response' && isNum(ev.parent_seq) && bySeq.has(ev.parent_seq)) {
      const cand = bySeq.get(ev.parent_seq);
      if (evs[cand].event_type === startType && !pairs.has(cand)) si = cand;
    }
    if (si == null) {
      const list = open.get(pairKey(ev)) || [];
      while (list.length && pairs.has(list[0])) list.shift();
      if (list.length) si = list[0];
    }
    if (si == null) return;
    pairs.set(si, i);
    const list = open.get(pairKey(evs[si]));
    if (list) {
      const j = list.indexOf(si);
      if (j >= 0) list.splice(j, 1);
    }
  });
  return pairs;
}

function isManagerName(name, graph) {
  if (name === 'Manager') return true;
  if (!graph || !Array.isArray(graph.nodes)) return false;
  return graph.nodes.some((n) => n && n.kind === 'manager' && (n.label === name || stripPrefix(n.id) === name));
}

/**
 * Build everything the timeline needs from an event list.
 *
 * Times are seconds from the first event. Lanes: "You" first, then Manager
 * (when present), then agents in graph order, then first appearance. Parallel
 * branches (branch_id) of one agent become sub-lanes. Consecutive identical
 * blocks in a lane (same kind + label), and consecutive passes of one step,
 * collapse into one item with count = N.
 */
export function buildModel(events, graph = null) {
  const evs = sortEvents(events);
  const ids = evs.map((ev, i) => eventId(ev, i));
  const times = evs.map((ev) => (isNum(ev.timestamp) ? ev.timestamp : null)).filter((t) => t != null);
  const t0 = times.length ? Math.min(...times) : 0;
  const tEnd = times.length ? Math.max(...times) : 0;
  const rel = (ev) => (isNum(ev.timestamp) ? ev.timestamp - t0 : 0);
  const pairs = pairEvents(evs);
  const endToStart = new Map([...pairs].map(([s, e]) => [e, s]));

  // lanes -------------------------------------------------------------
  const lanes = new Map();
  const branchLabels = new Map();
  for (const ev of evs) {
    if (ev.branch_id && ev.event_type === 'step_start' && !branchLabels.has(ev.branch_id)) {
      branchLabels.set(ev.branch_id, str(dataOf(ev).name) || str(ev.branch_id));
    }
  }
  const addLane = (id, kind, label, parent = null, branch = null) => {
    if (!lanes.has(id)) lanes.set(id, { id, kind, label, shape: SHAPES[kind] || 'rect', parent, branch, order: lanes.size });
    return lanes.get(id);
  };
  addLane(HUMAN_LANE, 'human', 'You');
  const agentOrder = [];
  if (graph && Array.isArray(graph.nodes)) {
    for (const n of graph.nodes) {
      if (n && n.kind === 'manager') agentOrder.push(['manager', n.label || stripPrefix(n.id)]);
    }
    for (const n of graph.nodes) {
      if (n && n.kind === 'agent') agentOrder.push(['agent', n.label || stripPrefix(n.id)]);
    }
  }
  const baseLaneId = (name) => (isManagerName(name, graph) ? MANAGER_LANE : `agent:${name}`);
  const ensureAgent = (name) => {
    if (!name) return null;
    const id = baseLaneId(name);
    return addLane(id, id === MANAGER_LANE ? 'manager' : 'agent', id === MANAGER_LANE ? 'Manager' : name).id;
  };
  const laneOf = (name, branch) => {
    const base = ensureAgent(name);
    if (!base || !branch) return base;
    const id = `${base}#${branch}`;
    addLane(id, lanes.get(base).kind, branchLabels.get(branch) || str(branch), base, branch);
    return id;
  };
  // Pre-seed in a stable order so lanes don't jump while a live run grows.
  const usesManager = evs.some((ev) => isManagerName(ev.agent_name, graph) || dataOf(ev).from_agent === 'Manager');
  if (usesManager || agentOrder.some(([k]) => k === 'manager')) addLane(MANAGER_LANE, 'manager', 'Manager');
  for (const [, name] of agentOrder) ensureAgent(name);
  for (const ev of evs) {
    if (ev.agent_name) laneOf(ev.agent_name, ev.branch_id);
    const d = dataOf(ev);
    if (ev.event_type === 'agent_handoff') {
      ensureAgent(d.from_agent);
      ensureAgent(d.to_agent);
    }
  }

  // blocks ------------------------------------------------------------
  const raw = [];
  const blockOfEvent = new Map();
  evs.forEach((ev, i) => {
    const t = ev.event_type;
    if (t !== 'tool_call_start' && t !== 'llm_request' && t !== 'approval_requested') return;
    const d = dataOf(ev);
    const ei = pairs.get(i);
    const end = ei != null ? evs[ei] : null;
    const ed = dataOf(end);
    const start = rel(ev);
    const stop = end ? rel(end) : tEnd - t0;
    let block;
    if (t === 'approval_requested') {
      const decided = end != null;
      block = {
        kind: 'approval',
        lane: HUMAN_LANE,
        fromLane: laneOf(ev.agent_name, ev.branch_id),
        label: str(d.tool) || 'approval',
        status: decided ? (ed.approved ? 'approved' : 'denied') : 'pending',
        approvalId: str(d.approval_id),
        cost: 0,
        tokens: 0,
      };
    } else if (t === 'tool_call_start') {
      block = {
        kind: 'tool',
        lane: laneOf(ev.agent_name, ev.branch_id) || HUMAN_LANE,
        label: str(d.tool_name) || 'tool',
        status: end ? (ed.error ? 'error' : 'ok') : 'running',
        cost: num(end && end.cost_usd),
        tokens: 0,
      };
    } else {
      const laneId = laneOf(ev.agent_name, ev.branch_id) || HUMAN_LANE;
      block = {
        kind: 'llm',
        lane: laneId,
        label: str(d.model || ed.model) || 'LLM',
        status: end ? 'ok' : 'running',
        cost: num(end && end.cost_usd),
        tokens: end ? num(end.prompt_tokens) + num(end.completion_tokens) : 0,
      };
    }
    const durationMs = end ? (isNum(ed.duration_ms) ? ed.duration_ms : (stop - start) * 1000) : (stop - start) * 1000;
    Object.assign(block, {
      id: `b:${ids[i]}`,
      start,
      end: Math.max(stop, start),
      open: !end,
      durationMs,
      startSeq: ev.sequence_num,
      endSeq: end ? end.sequence_num : null,
      eventIds: end ? [ids[i], ids[ei]] : [ids[i]],
      nodeId: ev.node_id || null,
      branch: ev.branch_id || null,
      agent: str(ev.agent_name),
      count: 1,
      members: [],
    });
    raw.push(block);
  });

  // collapse consecutive repeats within a lane --------------------------
  const blocks = [];
  const byLane = new Map();
  for (const b of raw) {
    if (!byLane.has(b.lane)) byLane.set(b.lane, []);
    byLane.get(b.lane).push(b);
  }
  for (const list of byLane.values()) {
    list.sort((a, b) => a.start - b.start || a.startSeq - b.startSeq);
    let cur = null;
    for (const b of list) {
      const same = cur && b.kind !== 'approval' && cur.kind === b.kind && cur.label === b.label
        && !b.open && !cur.open && cur.status === b.status;
      if (same) {
        if (!cur.members.length) cur.members.push({ ...cur, members: [] });
        cur.members.push({ ...b, members: [] });
        cur.count += 1;
        cur.end = Math.max(cur.end, b.end);
        cur.cost += b.cost;
        cur.tokens += b.tokens;
        cur.durationMs += b.durationMs;
        cur.eventIds = cur.eventIds.concat(b.eventIds);
        cur.endSeq = b.endSeq;
      } else {
        cur = { ...b };
        blocks.push(cur);
      }
    }
  }
  blocks.sort((a, b) => a.start - b.start || a.startSeq - b.startSeq);
  for (const b of blocks) for (const id of b.eventIds) blockOfEvent.set(id, b.id);

  // arrows ------------------------------------------------------------
  const arrows = [];
  const arrowOfEvent = new Map();
  evs.forEach((ev, i) => {
    const d = dataOf(ev);
    if (ev.event_type === 'agent_handoff') {
      const kind = HANDOFF_VERBS[d.kind] ? d.kind : 'handoff';
      const from = ensureAgent(d.from_agent || ev.agent_name);
      const to = ensureAgent(d.to_agent);
      if (!from || !to) return;
      const a = { id: `a:${ids[i]}`, kind, from, to, t: rel(ev), seq: ev.sequence_num, label: HANDOFF_VERBS[kind][1], eventId: ids[i] };
      arrows.push(a);
      arrowOfEvent.set(ids[i], a.id);
    } else if (ev.event_type === 'approval_requested') {
      const from = laneOf(ev.agent_name, ev.branch_id);
      if (!from) return;
      const a = { id: `a:${ids[i]}`, kind: 'ask', from, to: HUMAN_LANE, t: rel(ev), seq: ev.sequence_num, label: 'asks you', eventId: ids[i] };
      arrows.push(a);
      arrowOfEvent.set(ids[i], a.id);
    } else if (ev.event_type === 'approval_decided') {
      const si = endToStart.get(i);
      const req = si != null ? evs[si] : null;
      const to = req ? laneOf(req.agent_name, req.branch_id) : null;
      if (!to) return;
      const a = {
        id: `a:${ids[i]}`, kind: 'answer', from: HUMAN_LANE, to, t: rel(ev), seq: ev.sequence_num,
        label: d.approved ? 'approved' : 'denied', eventId: ids[i],
      };
      arrows.push(a);
      arrowOfEvent.set(ids[i], a.id);
    }
  });

  // chapters (tasks and steps) ----------------------------------------
  const chapterStarts = [];
  const depthBySeq = new Map();
  evs.forEach((ev, i) => {
    if (ev.event_type !== 'task_start' && ev.event_type !== 'step_start') return;
    const parentDepth = isNum(ev.parent_seq) && depthBySeq.has(ev.parent_seq) ? depthBySeq.get(ev.parent_seq) : -1;
    const depth = parentDepth + 1;
    if (isNum(ev.sequence_num)) depthBySeq.set(ev.sequence_num, depth);
    const d = dataOf(ev);
    const ei = pairs.get(i);
    const end = ei != null ? evs[ei] : null;
    const ed = dataOf(end);
    chapterStarts.push({
      id: `c:${ids[i]}`,
      kind: ev.event_type === 'task_start' ? 'task' : 'step',
      label: str(d.name) || stripPrefix(ev.node_id) || (ev.event_type === 'task_start' ? 'task' : 'step'),
      nodeId: ev.node_id || null,
      start: rel(ev),
      end: end ? Math.max(rel(end), rel(ev)) : tEnd - t0,
      open: !end,
      depth,
      parentSeq: isNum(ev.parent_seq) ? ev.parent_seq : null,
      status: end ? str(ed.status) || 'completed' : 'running',
      pattern: d.pattern || null,
      route: ed.route || null,
      agent: str(d.agent || ev.agent_name),
      branch: ev.branch_id || null,
      seq: ev.sequence_num,
      eventIds: end ? [ids[i], ids[ei]] : [ids[i]],
      count: 1,
      members: [],
    });
  });
  const chapters = [];
  const lastAt = new Map(); // `${depth}|${parent}` -> chapter
  for (const c of chapterStarts) {
    const key = `${c.depth}|${c.parentSeq}|${c.branch}`;
    const prev = lastAt.get(key);
    if (prev && prev.nodeId && prev.nodeId === c.nodeId && !prev.open && !c.open) {
      if (!prev.members.length) prev.members.push({ ...prev, members: [] });
      prev.members.push({ ...c, members: [] });
      prev.count += 1;
      prev.end = Math.max(prev.end, c.end);
      prev.eventIds = prev.eventIds.concat(c.eventIds);
      prev.status = c.status;
      continue;
    }
    const copy = { ...c };
    chapters.push(copy);
    lastAt.set(key, copy);
  }
  // pack chapters into rows (overlaps at one depth, e.g. parallel branches, get their own row)
  const rowsByDepth = new Map();
  let chapterRows = 0;
  const maxDepth = chapters.reduce((m, c) => Math.max(m, c.depth), -1);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const rows = [];
    for (const c of chapters.filter((x) => x.depth === depth).sort((a, b) => a.start - b.start)) {
      let r = rows.findIndex((endAt) => endAt <= c.start + 1e-9);
      if (r < 0) { rows.push(c.end); r = rows.length - 1; } else rows[r] = c.end;
      c.row = chapterRows + r;
    }
    rowsByDepth.set(depth, rows.length);
    chapterRows += rows.length;
  }
  const chapterOfEvent = new Map();
  for (const c of chapters) for (const id of c.eventIds) chapterOfEvent.set(id, c.id);

  // totals ------------------------------------------------------------
  const agents = {};
  for (const lane of lanes.values()) {
    if (lane.parent || lane.kind === 'human') continue;
    agents[lane.id] = { label: lane.label, cost_usd: 0, busy_ms: 0, llm_ms: 0, tool_ms: 0, tokens: 0, llm_calls: 0, tool_calls: 0 };
  }
  const totals = { cost_usd: 0, duration_ms: (tEnd - t0) * 1000, tokens: 0, llm_calls: 0, tool_calls: 0, events: evs.length, agents };
  for (const b of raw) {
    if (b.kind === 'approval') continue;
    const lane = lanes.get(b.lane);
    const owner = agents[lane && lane.parent ? lane.parent : b.lane];
    totals.cost_usd += b.cost;
    totals.tokens += b.tokens;
    if (b.kind === 'llm') totals.llm_calls += 1; else totals.tool_calls += 1;
    if (!owner) continue;
    owner.cost_usd += b.cost;
    owner.tokens += b.tokens;
    owner.busy_ms += b.durationMs;
    if (b.kind === 'llm') { owner.llm_ms += b.durationMs; owner.llm_calls += 1; } else { owner.tool_ms += b.durationMs; owner.tool_calls += 1; }
  }
  // costs recorded on events outside blocks (e.g. orphan ends) still count toward the run
  const blockCost = totals.cost_usd;
  const eventCost = evs.reduce((s, ev) => s + num(ev.cost_usd), 0);
  if (eventCost > blockCost + 1e-12) totals.cost_usd = eventCost;

  // narration ---------------------------------------------------------
  const narration = [];
  evs.forEach((ev, i) => {
    const t = ev.event_type;
    let related = null;
    if (PAIRS[t]) {
      const ei = pairs.get(i);
      related = ei != null ? evs[ei] : null;
    } else if (END_OF[t]) {
      const si = endToStart.get(i);
      related = si != null ? evs[si] : null;
      // a paired tool/llm end is already told by its start line
      if (related && (t === 'tool_call_end')) return;
    }
    if (t === 'llm_request' && related) return; // told by the response
    const text = narrate(ev, related);
    if (!text) return;
    const id = ids[i];
    const startId = related && END_OF[t] ? ids[endToStart.get(i)] : null;
    narration.push({
      id,
      seq: ev.sequence_num,
      t: rel(ev),
      type: t,
      text,
      agent: str(ev.agent_name),
      lane: ev.agent_name ? laneOf(ev.agent_name, ev.branch_id) : (t.startsWith('approval') ? HUMAN_LANE : null),
      blockId: blockOfEvent.get(id) || (startId && blockOfEvent.get(startId)) || null,
      arrowId: arrowOfEvent.get(id) || null,
      chapterId: chapterOfEvent.get(id) || null,
      nodeId: ev.node_id || null,
    });
  });

  return {
    t0,
    duration: tEnd - t0,
    lanes: [...lanes.values()],
    blocks,
    arrows,
    chapters,
    chapterRows,
    totals,
    narration,
    events: evs,
    eventIndex: new Map(ids.map((id, i) => [id, i])),
    pending: blocks.filter((b) => b.kind === 'approval' && b.status === 'pending'),
  };
}

// ── graph helpers ─────────────────────────────────────────────────────

/** Graph node ids an event touches (node_id, else derived from agent/tool names). */
export function nodeIdsForEvent(ev) {
  const out = [];
  if (!ev) return out;
  if (ev.node_id) out.push(ev.node_id);
  const d = dataOf(ev);
  if (ev.agent_name) {
    out.push(ev.agent_name === 'Manager' ? MANAGER_LANE : `agent:${ev.agent_name}`);
    if (d.tool_name) out.push(`tool:${ev.agent_name}/${d.tool_name}`);
  }
  if (String(ev.event_type).startsWith('approval_')) out.push(HUMAN_LANE);
  return [...new Set(out)];
}

/**
 * A who-talked-to-whom graph for runs that carry none (schema 1.0, plain
 * sessions): agents, their tools, the manager and you, with hand-off/uses/reviews
 * edges labelled with how often they happened.
 */
export function deriveGraph(events) {
  const evs = sortEvents(events);
  const nodes = new Map();
  const edges = new Map();
  const node = (id, kind, label) => { if (!nodes.has(id)) nodes.set(id, { id, kind, label, parent: null, meta: {} }); return id; };
  const agentNode = (name) => (name === 'Manager' ? node(MANAGER_LANE, 'manager', 'Manager') : node(`agent:${name}`, 'agent', name));
  const edge = (source, target, kind) => {
    const id = `${source}->${target}:${kind}`;
    const e = edges.get(id) || { id, source, target, kind, label: null, count: 0 };
    e.count += 1;
    e.label = e.count > 1 ? `×${e.count}` : null;
    edges.set(id, e);
  };
  evs.forEach((ev) => {
    const d = dataOf(ev);
    if (ev.agent_name) agentNode(ev.agent_name);
    if (ev.event_type === 'agent_handoff' && (d.from_agent || ev.agent_name) && d.to_agent) {
      const kind = { delegate: 'delegates', route: 'routes', spawn: 'handoff' }[d.kind] || 'handoff';
      edge(agentNode(d.from_agent || ev.agent_name), agentNode(d.to_agent), kind);
    } else if (ev.event_type === 'tool_call_start' && ev.agent_name && d.tool_name) {
      const tool = node(`tool:${ev.agent_name}/${d.tool_name}`, 'tool', d.tool_name);
      edge(agentNode(ev.agent_name), tool, 'uses');
    } else if (ev.event_type === 'approval_requested') {
      const you = node(HUMAN_LANE, 'human', 'You');
      const target = d.tool && ev.agent_name ? node(`tool:${ev.agent_name}/${d.tool}`, 'tool', d.tool) : (ev.agent_name ? agentNode(ev.agent_name) : null);
      if (target) edge(you, target, 'reviews');
    }
  });
  return {
    schema: 'praisonai.graph/1',
    kind: 'derived',
    name: 'Who talked to whom',
    process: null,
    derived: true,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

/**
 * Own layered layout, left to right. Back edges (cycles such as loops) are
 * found by DFS and ignored for layering, then drawn underneath. depends_on edges
 * point from dependant to dependency, so they are reversed for layering.
 * Within a layer, order comes from a few barycentre sweeps (deterministic).
 */
export function layoutMap(graph, opts = {}) {
  const nodeW = opts.nodeWidth || 148;
  const nodeH = opts.nodeHeight || 56;
  const gapX = opts.gapX || 72;
  const gapY = opts.gapY || 28;
  const margin = opts.margin || 24;
  const rawNodes = graph && Array.isArray(graph.nodes) ? graph.nodes.filter((n) => n && n.id) : [];
  const index = new Map();
  const nodes = [];
  rawNodes.forEach((n) => {
    if (index.has(n.id)) return;
    index.set(n.id, nodes.length);
    nodes.push({ id: n.id, kind: n.kind || 'step', label: str(n.label) || stripPrefix(n.id), parent: n.parent || null, shape: SHAPES[n.kind] || 'rect' });
  });
  const rawEdges = graph && Array.isArray(graph.edges) ? graph.edges.filter((e) => e && index.has(e.source) && index.has(e.target)) : [];
  const edges = rawEdges.map((e, k) => {
    const reversed = e.kind === 'depends_on';
    return {
      id: e.id || `${e.source}->${e.target}:${e.kind}#${k}`,
      source: e.source,
      target: e.target,
      kind: e.kind || 'next',
      label: e.label == null ? null : str(e.label),
      u: index.get(reversed ? e.target : e.source),
      v: index.get(reversed ? e.source : e.target),
      back: false,
    };
  });
  const n = nodes.length;
  const out = Array.from({ length: n }, () => []);
  edges.forEach((e, k) => { if (e.u !== e.v) out[e.u].push(k); else e.back = true; });

  // DFS from sources (in definition order) to mark back edges
  const state = new Array(n).fill(0);
  const indeg = new Array(n).fill(0);
  edges.forEach((e) => { if (e.u !== e.v) indeg[e.v] += 1; });
  const roots = [...nodes.keys()].sort((a, b) => (indeg[a] === 0 ? 0 : 1) - (indeg[b] === 0 ? 0 : 1) || a - b);
  const visit = (start) => {
    const stack = [[start, 0]];
    state[start] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, k] = top;
      if (k < out[u].length) {
        top[1] += 1;
        const e = edges[out[u][k]];
        if (state[e.v] === 1) e.back = true;
        else if (state[e.v] === 0) { state[e.v] = 1; stack.push([e.v, 0]); }
      } else {
        state[u] = 2;
        stack.pop();
      }
    }
  };
  for (const r of roots) if (state[r] === 0) visit(r);

  // longest-path layering over forward edges (Kahn)
  const layer = new Array(n).fill(0);
  const fwdIn = new Array(n).fill(0);
  const fwdOut = Array.from({ length: n }, () => []);
  edges.forEach((e) => { if (!e.back && e.u !== e.v) { fwdIn[e.v] += 1; fwdOut[e.u].push(e.v); } });
  const hasIn = fwdIn.map((c) => c > 0);
  const queue = [...nodes.keys()].filter((i) => fwdIn[i] === 0);
  while (queue.length) {
    const u = queue.shift();
    for (const v of fwdOut[u]) {
      layer[v] = Math.max(layer[v], layer[u] + 1);
      if (--fwdIn[v] === 0) queue.push(v);
    }
  }
  // Pull pure sources (e.g. "You", who only reviews) next to their nearest target.
  for (let i = 0; i < n; i++) {
    if (nodes[i].kind === 'start' || hasIn[i] || !fwdOut[i].length) continue;
    layer[i] = Math.max(layer[i], Math.min(...fwdOut[i].map((v) => layer[v])) - 1);
  }
  const layerCount = n ? Math.max(...layer) + 1 : 0;

  // Long forward edges get one virtual waypoint per layer they cross, so they
  // are ordered like nodes and route between boxes instead of through them.
  const itemLayer = [...layer];
  const chains = new Map();
  const links = [];
  edges.forEach((e, k) => {
    if (e.back || e.u === e.v) return;
    const chain = [e.u];
    for (let L = itemLayer[e.u] + 1; L < itemLayer[e.v]; L++) {
      chain.push(itemLayer.length);
      itemLayer.push(L);
    }
    chain.push(e.v);
    chains.set(k, chain);
    for (let j = 0; j + 1 < chain.length; j++) links.push([chain[j], chain[j + 1]]);
  });
  const items = itemLayer.length;
  const layers = Array.from({ length: layerCount }, () => []);
  for (let i = 0; i < items; i++) layers[itemLayer[i]].push(i);
  const up = Array.from({ length: items }, () => []);
  const down = Array.from({ length: items }, () => []);
  for (const [a, b] of links) { down[a].push(b); up[b].push(a); }

  // barycentre ordering sweeps
  const pos = new Array(items).fill(0);
  layers.forEach((L) => L.forEach((i, k) => { pos[i] = k; }));
  for (let sweep = 0; sweep < 6; sweep++) {
    const fromLeft = sweep % 2 === 0;
    const order = fromLeft ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const L of order) {
      const bary = new Map(L.map((i) => {
        const nb = fromLeft ? up[i] : down[i];
        return [i, nb.length ? nb.reduce((acc, j) => acc + pos[j], 0) / nb.length : pos[i]];
      }));
      L.sort((a, b) => bary.get(a) - bary.get(b) || pos[a] - pos[b] || a - b);
      L.forEach((i, k) => { pos[i] = k; });
    }
  }

  const VH = 14; // height of a virtual waypoint slot
  const itemH = (i) => (i < n ? nodeH : VH);
  const colHeight = (L) => L.reduce((acc, i) => acc + itemH(i), 0) + Math.max(0, L.length - 1) * gapY;
  const height = margin * 2 + layers.reduce((m, L) => Math.max(m, colHeight(L)), 0);
  const centre = new Array(items);
  layers.forEach((L, li) => {
    let y = margin + (height - margin * 2 - colHeight(L)) / 2;
    const x = margin + li * (nodeW + gapX);
    L.forEach((i, k) => {
      if (i < n) Object.assign(nodes[i], { layer: li, order: k, w: nodeW, h: nodeH, x, y });
      centre[i] = [x + nodeW / 2, y + itemH(i) / 2];
      y += itemH(i) + gapY;
    });
  });

  const backDrop = 22;
  let backLane = height;
  const outEdges = edges.map((e, k) => {
    const s = nodes[index.get(e.source)];
    const t = nodes[index.get(e.target)];
    let points;
    let back = e.back;
    if (e.source === e.target) {
      points = [[s.x + s.w * 0.7, s.y + s.h], [s.x + s.w * 0.7, s.y + s.h + backDrop], [s.x + s.w * 0.3, s.y + s.h + backDrop], [s.x + s.w * 0.3, s.y + s.h]];
      back = true;
    } else if (chains.has(k)) {
      const chain = chains.get(k);
      const first = nodes[chain[0]];
      const last = nodes[chain[chain.length - 1]];
      points = [[first.x + first.w, first.y + first.h / 2], ...chain.slice(1, -1).map((i) => centre[i]), [last.x, last.y + last.h / 2]];
      if (index.get(e.source) !== chain[0]) points.reverse(); // drawn against layering (depends_on)
    } else {
      backLane += backDrop;
      const yb = Math.max(s.y + s.h, t.y + t.h) + (backLane - height);
      points = [[s.x + s.w / 2, s.y + s.h], [s.x + s.w / 2, yb], [t.x + t.w / 2, yb], [t.x + t.w / 2, t.y + t.h]];
      back = true;
    }
    return { id: e.id, source: e.source, target: e.target, kind: e.kind, label: e.label, back, points };
  });
  const width = n ? margin * 2 + layerCount * nodeW + Math.max(0, layerCount - 1) * gapX : margin * 2;
  return { nodes, edges: outEdges, width, height: Math.max(height, backLane) + (backLane > height ? margin : 0), layers: layerCount };
}

/**
 * The graph as recorded, completed with what actually happened: agents and
 * tools seen in the events but missing from the graph, and hand-offs the graph
 * does not draw. Agents from outside the graph (e.g. a hand-off to an agent
 * that is not a team member) are marked ``meta.outside`` so the map can group
 * them as "Outside the team". Without a recorded graph this is deriveGraph().
 */
export function observedGraph(graph, events) {
  const derived = deriveGraph(events);
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return derived;
  const nodes = graph.nodes.filter((n) => n && n.id).map((n) => ({ ...n, meta: { ...(n.meta || {}) } }));
  const edges = (Array.isArray(graph.edges) ? graph.edges : []).filter((e) => e && e.source && e.target).map((e) => ({ ...e }));
  const ids = new Set(nodes.map((n) => n.id));
  const agentByLabel = new Map();
  for (const n of nodes) if (n.kind === 'agent' || n.kind === 'manager') agentByLabel.set(n.label || stripPrefix(n.id), n.id);
  const resolve = (id) => {
    if (ids.has(id)) return id;
    const name = stripPrefix(id);
    if ((id.startsWith('agent:') || id.startsWith('manager:')) && agentByLabel.has(name)) return agentByLabel.get(name);
    return id;
  };
  const outside = new Set();
  const recorded = new Set(ids);
  for (const n of derived.nodes) {
    const id = resolve(n.id);
    if (ids.has(id)) continue;
    if (n.kind === 'human' && nodes.some((x) => x.kind === 'human')) continue;
    const owner = n.kind === 'tool' ? `agent:${n.id.slice(5).split('/')[0]}` : null;
    const isOutside = n.kind === 'agent' || n.kind === 'manager' || Boolean(owner && !recorded.has(resolve(owner)));
    nodes.push({ ...n, meta: { ...(n.meta || {}), observed: true, outside: Boolean(isOutside) } });
    ids.add(id);
    if (isOutside) outside.add(id);
  }
  const has = new Set(edges.map((e) => `${e.source}|${e.target}|${e.kind}`));
  const linked = new Set(edges.map((e) => `${e.source}|${e.target}`));
  for (const e of derived.edges) {
    const source = resolve(e.source);
    const target = resolve(e.target);
    if (!ids.has(source) || !ids.has(target)) continue;
    if (has.has(`${source}|${target}|${e.kind}`)) continue;
    // a "uses"/"reviews" link the graph already draws in another form is not news
    if ((e.kind === 'uses' || e.kind === 'reviews') && linked.has(`${source}|${target}`)) continue;
    edges.push({ ...e, id: `${source}->${target}:${e.kind}`, source, target, meta: { observed: true } });
    has.add(`${source}|${target}|${e.kind}`);
  }
  return { ...graph, nodes, edges, outside: [...outside] };
}

/**
 * layoutMap() for a run: the team/flow graph first, then the agents from
 * outside it as their own block underneath, framed as a group. Edges between
 * the two blocks are drawn straight. Returns layoutMap()'s shape plus
 * ``groups: [{id, label, x, y, w, h}]``.
 */
export function layoutRunMap(graph, events, opts = {}) {
  const g = observedGraph(graph, events);
  const outside = new Set(g.outside || []);
  if (!outside.size) return { ...layoutMap(g, opts), groups: [], graph: g };
  const inner = (set, keep) => ({
    nodes: g.nodes.filter((n) => keep(set.has(n.id))),
    edges: g.edges.filter((e) => keep(set.has(e.source)) && keep(set.has(e.target))),
  });
  const main = layoutMap(inner(outside, (x) => !x), opts);
  const out = layoutMap(inner(outside, (x) => x), opts);
  const gap = 40;
  const pad = 14;
  const dy = main.height + gap;
  const dx = 0;
  for (const n of out.nodes) { n.y += dy; n.x += dx; n.outside = true; }
  for (const e of out.edges) e.points = e.points.map(([x, y]) => [x + dx, y + dy]);
  const nodes = [...main.nodes, ...out.nodes];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cross = g.edges
    .filter((e) => outside.has(e.source) !== outside.has(e.target) && byId.has(e.source) && byId.has(e.target))
    .map((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      const down = t.y > s.y;
      return {
        id: e.id, source: e.source, target: e.target, kind: e.kind, label: e.label == null ? null : str(e.label), back: false, cross: true,
        points: [[s.x + s.w / 2, down ? s.y + s.h : s.y], [t.x + t.w / 2, down ? t.y : t.y + t.h]],
      };
    });
  const xs = out.nodes.map((n) => n.x);
  const group = {
    id: 'outside',
    label: `Outside the ${g.kind === 'flow' ? 'flow' : 'team'}`,
    x: Math.min(...xs) - pad,
    y: dy - pad + 6,
    w: Math.max(...out.nodes.map((n) => n.x + n.w)) - Math.min(...xs) + pad * 2,
    h: out.height - 12 + pad,
  };
  return {
    nodes,
    edges: [...main.edges, ...out.edges, ...cross],
    width: Math.max(main.width, out.width, group.x + group.w + 8),
    height: dy + out.height + 8,
    layers: Math.max(main.layers, out.layers),
    groups: [group],
    graph: g,
  };
}

/** End events that mean "this node finished one run", and which node that is. */
const RUN_ENDS = {
  step_end: (nid, ev) => nid === ev.node_id,
  task_end: (nid, ev) => nid === ev.node_id,
  agent_end: (nid) => nid.startsWith('agent:') || nid === MANAGER_LANE,
  tool_call_end: (nid) => nid.startsWith('tool:'),
};

/**
 * Each map node's state after the first ``upTo + 1`` events (sorted, as in
 * buildModel().events): ``{events, runs, state}`` where state is "running"
 * (started, not ended yet), "done", "failed" or "skipped" (from the last end's
 * ``data.status``). Nodes without an entry were not reached by then. The flow's
 * start/end nodes count as reached once the run started/ended.
 */
export function nodeStates(events, upTo = Infinity, nodes = []) {
  const out = new Map();
  const last = Math.min(events.length - 1, upTo);
  let ended = false;
  for (let i = 0; i <= last; i++) {
    const ev = events[i];
    const type = ev && ev.event_type;
    if (type === 'workflow_end' || type === 'session_end') ended = true;
    for (const nid of nodeIdsForEvent(ev)) {
      const st = out.get(nid) || { events: 0, runs: 0, open: 0, last: null };
      st.events += 1;
      if (PAIRS[type]) st.open += 1;
      else if (END_OF[type]) {
        st.open = Math.max(0, st.open - 1);
        if (RUN_ENDS[type] && RUN_ENDS[type](nid, ev)) {
          st.runs += 1;
          const status = str(dataOf(ev).status);
          st.last = status === 'failed' || dataOf(ev).error ? 'failed' : (status === 'skipped' ? 'skipped' : 'done');
        }
      }
      out.set(nid, st);
    }
  }
  for (const n of nodes || []) {
    if (out.has(n.id)) continue;
    if ((n.kind === 'start' && last >= 0) || (n.kind === 'end' && ended)) out.set(n.id, { events: 1, runs: 1, open: 0, last: 'done' });
  }
  for (const st of out.values()) {
    st.state = st.open > 0 ? 'running' : (st.last || 'done');
    delete st.open;
    delete st.last;
  }
  return out;
}

/** Words for edge kinds on the map (labels never rely on colour). */
export const EDGE_WORDS = Object.freeze({
  handoff: 'hands off',
  delegates: 'delegates',
  depends_on: 'depends on',
  next: 'then',
  routes: 'routes',
  parallel: 'in parallel',
  loop: 'loops',
  assigned: 'assigned',
  uses: 'uses',
  reviews: 'reviews',
});

export function edgeText(edge) {
  const word = EDGE_WORDS[edge.kind] || str(edge.kind);
  return edge.label ? `${word}: ${edge.label}` : word;
}

const api = {
  PALETTE, SHAPES, HUMAN_LANE, MANAGER_LANE, EDGE_WORDS,
  buildModel, narrate, layoutMap, layoutRunMap, observedGraph, deriveGraph, nodeIdsForEvent, nodeStates, pairEvents, sortEvents,
  eventId, formatDuration, formatCost, argPreview, truncate, stripPrefix, edgeText,
};
if (typeof globalThis !== 'undefined') globalThis.PraisonReplayCore = api;
export default api;
