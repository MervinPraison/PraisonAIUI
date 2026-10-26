// node --test tests/js/replay-core.test.mjs
// Pure-function tests for the PraisonAI Replay model (no DOM, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const coreUrl = pathToFileURL(path.join(root, 'src/praisonaiui/templates/frontend/plugins/views/replay-core.js'));
const core = await import(coreUrl.href);
const { buildModel, narrate, layoutMap, deriveGraph, formatCost, formatDuration } = core;

function load(name) {
  const text = fs.readFileSync(path.join(root, 'tests/fixtures/replay', `${name}.jsonl`), 'utf8');
  const events = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const ws = events.find((e) => e.event_type === 'workflow_start');
  return { events, graph: ws && ws.data && ws.data.graph ? ws.data.graph : null };
}

// ── buildModel: lanes ────────────────────────────────────────────────

test('team run: You and Manager lanes come first, agents follow graph order', () => {
  const { events, graph } = load('team_handoff');
  const m = buildModel(events, graph);
  assert.deepEqual(m.lanes.map((l) => l.id), ['human:you', 'manager:Manager', 'agent:Researcher', 'agent:Writer']);
  assert.deepEqual(m.lanes.map((l) => l.shape), ['diamond', 'square', 'circle', 'circle']);
  assert.equal(m.lanes[0].label, 'You');
});

test('parallel branches of one agent become sub-lanes labelled by step', () => {
  const { events, graph } = load('flow_parallel_loop');
  const m = buildModel(events, graph);
  const subs = m.lanes.filter((l) => l.parent === 'agent:Fetcher');
  assert.deepEqual(subs.map((l) => [l.id, l.branch, l.label]), [
    ['agent:Fetcher#gather/0', 'gather/0', 'news'],
    ['agent:Fetcher#gather/1', 'gather/1', 'papers'],
  ]);
  const tools = m.blocks.filter((b) => b.kind === 'tool' && b.agent === 'Fetcher');
  assert.deepEqual(tools.map((b) => b.lane), ['agent:Fetcher#gather/0', 'agent:Fetcher#gather/1']);
  // the two branches overlap in time: that is why they need their own rows
  assert.ok(tools[1].start < tools[0].end);
});

test('a 1.0 legacy file still yields lanes, blocks and a hand-off', () => {
  const { events } = load('legacy_v10');
  const m = buildModel(events, null);
  assert.deepEqual(m.lanes.map((l) => l.id), ['human:you', 'agent:Assistant', 'agent:Checker']);
  assert.deepEqual(m.blocks.map((b) => `${b.kind}:${b.label}`), ['llm:gpt-4o-mini', 'tool:calculator', 'llm:gpt-4o-mini', 'llm:gpt-4o-mini']);
  assert.equal(m.arrows.length, 1);
  assert.equal(m.arrows[0].kind, 'handoff');
  assert.equal(m.chapters.length, 0);
});

// ── buildModel: arrows ───────────────────────────────────────────────

test('delegate and hand-off arrows connect the right lanes', () => {
  const { events, graph } = load('team_handoff');
  const m = buildModel(events, graph);
  const flows = m.arrows.map((a) => `${a.kind}:${a.from}->${a.to}`);
  assert.deepEqual(flows, [
    'delegate:manager:Manager->agent:Researcher',
    'handoff:agent:Researcher->agent:Writer',
    'ask:agent:Writer->human:you',
    'answer:human:you->agent:Writer',
  ]);
  assert.equal(m.arrows[0].label, 'delegates');
  assert.equal(m.arrows[3].label, 'approved');
});

test('route arrows from a flow', () => {
  const { events, graph } = load('flow_parallel_loop');
  const m = buildModel(events, graph);
  assert.deepEqual(m.arrows.map((a) => [a.kind, a.from, a.to]), [['route', 'agent:Editor', 'agent:Publisher']]);
});

// ── buildModel: xN collapse ──────────────────────────────────────────

test('three consecutive web_search calls collapse to one block x3', () => {
  const { events, graph } = load('team_handoff');
  const m = buildModel(events, graph);
  const ws = m.blocks.filter((b) => b.label === 'web_search');
  assert.equal(ws.length, 1);
  assert.equal(ws[0].count, 3);
  assert.equal(ws[0].members.length, 3);
  assert.ok(Math.abs(ws[0].cost - 0.006) < 1e-9);
  assert.ok(Math.abs(ws[0].durationMs - 3200) < 1e-6);
  // every member's events map to the collapsed block
  const lines = m.narration.filter((n) => n.text.includes('web_search'));
  assert.equal(lines.length, 3);
  assert.ok(lines.every((n) => n.blockId === ws[0].id));
});

test('loop passes collapse: polish chapter x3 and Editor LLM block x3', () => {
  const { events, graph } = load('flow_parallel_loop');
  const m = buildModel(events, graph);
  const polish = m.chapters.filter((c) => c.nodeId === 'step:polish');
  assert.equal(polish.length, 1);
  assert.equal(polish[0].count, 3);
  assert.equal(polish[0].depth, 1);
  const editor = m.blocks.filter((b) => b.agent === 'Editor');
  assert.equal(editor.length, 1);
  assert.equal(editor[0].count, 3);
  assert.equal(editor[0].tokens, 490 + 540 + 590);
});

test('non-adjacent repeats are not collapsed', () => {
  const { events, graph } = load('team_handoff');
  const m = buildModel(events, graph);
  const researcherLlm = m.blocks.filter((b) => b.agent === 'Researcher' && b.kind === 'llm');
  assert.equal(researcherLlm.length, 2); // llm, tool x3, llm
  assert.ok(researcherLlm.every((b) => b.count === 1));
});

// ── buildModel: chapters, approvals, totals, live ────────────────────

test('chapters carry depth, rows and the chosen route', () => {
  const { events, graph } = load('flow_parallel_loop');
  const m = buildModel(events, graph);
  const byNode = Object.fromEntries(m.chapters.map((c) => [c.nodeId, c]));
  assert.equal(byNode['step:gather'].depth, 0);
  assert.equal(byNode['step:news'].depth, 1);
  assert.notEqual(byNode['step:news'].row, byNode['step:papers'].row); // overlapping -> own rows
  assert.equal(byNode['step:decide'].route, 'publish');
  assert.equal(m.chapterRows, 3);
});

test('approval sits in the You lane with its decision', () => {
  const { events, graph } = load('team_handoff');
  const m = buildModel(events, graph);
  const ap = m.blocks.find((b) => b.kind === 'approval');
  assert.equal(ap.lane, 'human:you');
  assert.equal(ap.status, 'approved');
  assert.equal(ap.approvalId, 'appr-0001');
  assert.equal(m.pending.length, 0);
});

test('a run cut before the decision has one pending approval and open blocks', () => {
  const { events, graph } = load('team_handoff');
  const cut = events.slice(0, events.findIndex((e) => e.event_type === 'approval_decided'));
  const m = buildModel(cut, graph);
  assert.equal(m.pending.length, 1);
  assert.equal(m.pending[0].approvalId, 'appr-0001');
  assert.equal(m.pending[0].open, true);
  const half = events.slice(0, events.findIndex((e) => e.event_type === 'tool_call_end'));
  const m2 = buildModel(half, graph);
  const running = m2.blocks.find((b) => b.kind === 'tool');
  assert.equal(running.open, true);
  assert.equal(running.status, 'running');
  assert.match(m2.narration.at(-1).text, /^Researcher is asking web_search for 'solar sail facts'…$/);
});

test('totals per agent and for the run', () => {
  const { events, graph } = load('team_handoff');
  const m = buildModel(events, graph);
  assert.equal(m.totals.llm_calls, 5);
  assert.equal(m.totals.tool_calls, 4);
  assert.ok(Math.abs(m.totals.cost_usd - 0.006741) < 1e-9);
  const r = m.totals.agents['agent:Researcher'];
  assert.ok(Math.abs(r.cost_usd - (0.000072 + 0.006 + 0.000228)) < 1e-9);
  assert.equal(r.tool_calls, 3);
  assert.ok(Math.abs(m.totals.duration_ms - 12250) < 1e-6);
});

test('sub-lane work rolls up to the parent agent total', () => {
  const { events, graph } = load('flow_parallel_loop');
  const m = buildModel(events, graph);
  const f = m.totals.agents['agent:Fetcher'];
  assert.equal(f.tool_calls, 2);
  assert.ok(Math.abs(f.cost_usd - 0.001) < 1e-9);
  assert.equal(m.totals.agents['agent:Fetcher#gather/0'], undefined);
});

test('unknown event types and fields are tolerated and skipped', () => {
  const { events, graph } = load('flow_parallel_loop');
  assert.ok(events.some((e) => e.event_type === 'context_rebalance'));
  const m = buildModel(events, graph);
  assert.ok(!m.narration.some((n) => n.type === 'context_rebalance'));
  assert.equal(m.events.length, events.length);
});

test('duplicates (same session:seq, e.g. after an SSE reconnect) are dropped; order follows sequence_num', () => {
  const { events, graph } = load('legacy_v10');
  const shuffled = [...events].reverse().concat(events.slice(0, 3));
  const m = buildModel(shuffled, graph);
  assert.equal(m.events.length, events.length);
  assert.deepEqual(m.events.map((e) => e.sequence_num), events.map((e) => e.sequence_num));
});

test('empty input is fine', () => {
  const m = buildModel([], null);
  assert.equal(m.blocks.length, 0);
  assert.equal(m.narration.length, 0);
  assert.deepEqual(m.lanes.map((l) => l.id), ['human:you']);
});

// ── narrate ──────────────────────────────────────────────────────────

const ev = (event_type, data = {}, extra = {}) => ({ event_type, data, agent_name: 'Researcher', timestamp: 100, sequence_num: 1, session_id: 's', ...extra });

test('narrate: tool call with its end gives duration and cost', () => {
  const start = ev('tool_call_start', { tool_name: 'web_search', tool_args: { query: 'X' } });
  const end = ev('tool_call_end', { tool_name: 'web_search', duration_ms: 1200 }, { cost_usd: 0.002, timestamp: 101.2 });
  assert.equal(narrate(start, end), "Researcher asked web_search for 'X' — 1.2 s, $0.002.");
  assert.equal(narrate(start), "Researcher is asking web_search for 'X'…");
  const failed = ev('tool_call_end', { tool_name: 'web_search', duration_ms: 300, error: 'HTTP 500' });
  assert.equal(narrate(start, failed), "Researcher asked web_search for 'X' — failed after 300 ms: HTTP 500.");
});

test('narrate: hand-off kinds', () => {
  assert.equal(
    narrate(ev('agent_handoff', { from_agent: 'Researcher', to_agent: 'Writer', reason: 'Facts gathered.' })),
    "Researcher handed off to Writer: 'Facts gathered'.",
  );
  assert.equal(narrate(ev('agent_handoff', { from_agent: 'Manager', to_agent: 'Writer', kind: 'delegate' }, { agent_name: 'Manager' })), 'Manager delegated to Writer.');
  assert.equal(narrate(ev('agent_handoff', { from_agent: 'A', to_agent: 'B', kind: 'route' })), 'A routed to B.');
  assert.equal(narrate(ev('agent_handoff', { from_agent: 'A', to_agent: 'B', kind: 'spawn' })), 'A spawned B.');
  assert.equal(narrate(ev('agent_handoff', { from_agent: 'A', to_agent: 'B', kind: 'weird' })), 'A handed off to B.');
});

test('narrate: LLM response with model, tokens, cost', () => {
  const r = ev('llm_response', { duration_ms: 900, model: 'gpt-4o-mini' }, { prompt_tokens: 120, completion_tokens: 40, cost_usd: 0.0004 });
  assert.equal(narrate(r), 'Researcher thought with gpt-4o-mini — 900 ms, 160 tokens, $0.0004.');
});

test('narrate: approvals, human and automatic', () => {
  const req = ev('approval_requested', { approval_id: 'a1', tool: 'write_file', risk: 'high', kind: 'tool_call' }, { agent_name: 'Writer' });
  assert.equal(narrate(req), 'Writer asked you to approve write_file (high risk).');
  assert.equal(narrate(ev('approval_decided', { approved: true, approver: 'user', modified: true }), req), 'You approved write_file with edited arguments.');
  assert.equal(narrate(ev('approval_decided', { approved: true, approver: 'env' }), req), 'write_file was approved automatically (env).');
  assert.equal(narrate(ev('approval_decided', { approved: false, approver: 'user', reason: 'Not now' }), req), "You denied write_file: 'Not now'.");
  assert.equal(narrate(ev('approval_decided', { approved: false, approver: 'timeout' }), req), 'write_file was denied: no answer before the timeout.');
});

test('narrate: tasks, steps, routes, workflow', () => {
  assert.equal(narrate(ev('task_start', { name: 'research', agent: 'Researcher' })), "Task 'research' went to Researcher.");
  assert.equal(narrate(ev('task_end', { status: 'failed', duration_ms: 2500, retries: 2 }, { node_id: 'task:research' })), "Task 'research' failed after 2.5 s, 2 retries.");
  assert.equal(narrate(ev('step_end', { route: 'publish' }), ev('step_start', { name: 'decide' })), "Step 'decide' chose route 'publish'.");
  assert.equal(narrate(ev('step_end', { status: 'cached' }, { node_id: 'step:fetch' })), "Step 'fetch' reused a cached result.");
  assert.equal(narrate(ev('step_start', { name: 'gather', pattern: 'parallel' })), "Step 'gather' fanned out in parallel.");
  assert.equal(narrate(ev('workflow_start', { kind: 'team', name: 'Brief', process: 'hierarchical' })), "Team 'Brief' started (hierarchical).");
  assert.equal(narrate(ev('workflow_end', { status: 'completed', duration_ms: 125000 })), 'The run completed after 2 min 05 s.');
});

test('narrate: unknown and quiet events give empty strings', () => {
  assert.equal(narrate(ev('context_snapshot')), '');
  assert.equal(narrate(ev('something_new')), '');
  assert.equal(narrate(null), '');
  assert.equal(narrate(ev('message_added', { role: 'assistant', content: 'hi' })), '');
  assert.equal(narrate(ev('message_added', { role: 'user', content: 'Hello!' }, { agent_name: '' })), "You said: 'Hello'.");
});

test('narrate is deterministic', () => {
  const { events, graph } = load('team_handoff');
  const a = buildModel(events, graph).narration.map((n) => n.text);
  const b = buildModel(events, graph).narration.map((n) => n.text);
  assert.deepEqual(a, b);
  assert.ok(a.includes("Researcher asked web_search for 'solar sail facts' — 1.2 s, $0.002."));
});

test('formatters', () => {
  assert.equal(formatDuration(850), '850 ms');
  assert.equal(formatDuration(1200), '1.2 s');
  assert.equal(formatCost(0.002), '$0.002');
  assert.equal(formatCost(0.00001), '<$0.0001');
  assert.equal(formatCost(1.5), '$1.50');
  assert.equal(formatCost(0), '');
});

// ── layoutMap / deriveGraph ──────────────────────────────────────────

test('layoutMap: layers flow left to right and every node gets a box', () => {
  const { graph } = load('team_handoff');
  const lay = layoutMap(graph);
  const byId = Object.fromEntries(lay.nodes.map((n) => [n.id, n]));
  assert.equal(lay.nodes.length, graph.nodes.length);
  assert.ok(byId['start:begin'].layer < byId['manager:Manager'].layer);
  assert.ok(byId['manager:Manager'].layer < byId['task:research'].layer);
  // depends_on (write depends on research) puts research first
  assert.ok(byId['task:research'].layer < byId['task:write'].layer);
  assert.ok(byId['agent:Researcher'].layer < byId['agent:Writer'].layer);
  for (const n of lay.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= lay.width && n.y + n.h <= lay.height, n.id);
  }
  assert.deepEqual([...new Set(lay.nodes.map((n) => n.shape))].sort(), ['chevron', 'circle', 'diamond', 'flag', 'note', 'rounded', 'square']);
});

test('layoutMap: no two nodes overlap', () => {
  for (const name of ['team_handoff', 'flow_parallel_loop']) {
    const lay = layoutMap(load(name).graph);
    for (let i = 0; i < lay.nodes.length; i++) {
      for (let j = i + 1; j < lay.nodes.length; j++) {
        const a = lay.nodes[i];
        const b = lay.nodes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, `${a.id} overlaps ${b.id}`);
      }
    }
  }
});

test('layoutMap: a loop edge is a back edge, routed underneath, labels kept', () => {
  const lay = layoutMap(load('flow_parallel_loop').graph);
  const back = lay.edges.filter((e) => e.back);
  assert.deepEqual(back.map((e) => e.id), ['step:polish->step:review_loop:loop']);
  assert.equal(back[0].points.length, 4);
  const routes = lay.edges.filter((e) => e.kind === 'routes').map((e) => e.label).sort();
  assert.deepEqual(routes, ['archive', 'publish']);
  assert.equal(core.edgeText(lay.edges.find((e) => e.kind === 'routes' && e.label === 'publish')), 'routes: publish');
});

test('layoutMap: deterministic and tolerant of bad input', () => {
  const g = load('flow_parallel_loop').graph;
  assert.deepEqual(layoutMap(g), layoutMap(g));
  const empty = layoutMap(null);
  assert.equal(empty.nodes.length, 0);
  const dangling = layoutMap({ nodes: [{ id: 'agent:A', kind: 'agent' }], edges: [{ source: 'agent:A', target: 'nope', kind: 'next' }] });
  assert.equal(dangling.edges.length, 0);
});

test('deriveGraph: who talked to whom for a 1.0 file', () => {
  const g = deriveGraph(load('legacy_v10').events);
  assert.equal(g.derived, true);
  assert.deepEqual(g.nodes.map((n) => n.id).sort(), ['agent:Assistant', 'agent:Checker', 'tool:Assistant/calculator']);
  assert.deepEqual(g.edges.map((e) => e.id).sort(), [
    'agent:Assistant->agent:Checker:handoff',
    'agent:Assistant->tool:Assistant/calculator:uses',
  ]);
  const lay = layoutMap(g);
  assert.equal(lay.nodes.length, 3);
});

test('deriveGraph counts repeats and includes you for approvals', () => {
  const { events } = load('team_handoff');
  const g = deriveGraph(events);
  const ws = g.edges.find((e) => e.id === 'agent:Researcher->tool:Researcher/web_search:uses');
  assert.equal(ws.label, '×3');
  assert.ok(g.nodes.some((n) => n.id === 'human:you' && n.kind === 'human'));
  assert.ok(g.edges.some((e) => e.kind === 'delegates' && e.source === 'manager:Manager'));
});

test('module also registers itself on globalThis for the standalone build', () => {
  assert.equal(typeof globalThis.PraisonReplayCore.buildModel, 'function');
});
