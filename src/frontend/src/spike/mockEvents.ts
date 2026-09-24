/* Spike #293 — PraisonAIUI-shaped mock event stream.
 *
 * These events use the real `SSEEvent` contract from `@/types` so the spike
 * proves the BeautifulUI primitives can render against the *actual* event
 * vocabulary the chat surface emits (see src/praisonaiui/templates/frontend/
 * plugins/views/chat.js and RunEventType in src/frontend/src/types.ts).
 *
 * Nothing here talks to a live socket — that is an explicit non-goal of the
 * spike. The timeline below is replayed by SpikePage with setTimeout to
 * emulate SSE deltas / tool lifecycle / a HITL approval request.
 */
import type { SSEEvent } from "@/types";

/** A scripted SSE frame plus the delay (ms) before it fires. */
export type MockFrame = { at: number; event: SSEEvent };

/** approval_request payload shaped like a row from GET /api/approvals. */
export type ApprovalRequest = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  questions: { q: string; type: "radio" | "check"; options: string[] }[];
};

/* SSE-style text deltas — streamed word-by-word as `run_content`. */
const ANSWER =
  "Pistachio is your fastest-growing flavor — sales are up 23% this month " +
  "and margins beat vanilla by 8 points. Stone-fruit flavors trend in the same range.";

function contentDeltas(startAt: number, stepMs = 55): MockFrame[] {
  const words = ANSWER.split(" ");
  return words.map((w, i) => ({
    at: startAt + i * stepMs,
    event: { type: "run_content", token: w + " ", content: w + " " } as SSEEvent,
  }));
}

const LAST_DELTA_AT = 300 + ANSWER.split(" ").length * 55;

/* Reasoning + tool lifecycle, mapped to ThinkingState rows. */
export const REASONING_STREAM: SSEEvent[] = [
  { type: "reasoning_started" },
  { type: "reasoning_step", step: "Reading flavor briefs", step_number: 1 },
  { type: "tool_call_started", name: "sql.query", tool_call_id: "t1", args: { table: "sales" } },
  { type: "tool_call_completed", name: "sql.query", tool_call_id: "t1", formatted_result: "6 flavors" },
  { type: "reasoning_step", step: "Comparing tasting notes", step_number: 2 },
  { type: "tool_call_started", name: "trends.lookup", tool_call_id: "t2", args: { window: "30d" } },
  { type: "tool_call_completed", name: "trends.lookup", tool_call_id: "t2", formatted_result: "+23%" },
  { type: "reasoning_completed" },
];

/* approval_request payload — the /api/approvals shape a HITL gate would push. */
export const APPROVAL_REQUEST: ApprovalRequest = {
  id: "appr_9f2",
  tool: "menu.publish",
  args: { flavors: 3, season: "winter" },
  questions: [
    { q: "How many flavors should we launch?", type: "radio", options: ["Three (core line)", "Five (full case)", "Just one hero"] },
    { q: "Which mix-ins should we stock?", type: "check", options: ["Chocolate chips", "Waffle bits", "Sprinkles"] },
  ],
};

/** Full scripted timeline for the streaming panel. */
export function streamingTimeline(): MockFrame[] {
  return [
    { at: 0, event: { type: "run_started" } as SSEEvent },
    ...contentDeltas(300),
    { at: LAST_DELTA_AT + 100, event: { type: "run_completed" } as SSEEvent },
  ];
}

/* ── Adapters: PraisonAIUI events → BeautifulUI primitive props ── */

/** run_content deltas → StreamingText tokens (`cite` marks a source chip slot). */
export function tokensFromDeltas(frames: MockFrame[]): { text: string; cite?: boolean }[] {
  return frames
    .filter((f) => f.event.type === "run_content")
    .map((f) => ({ text: (f.event.token ?? f.event.content ?? "").trim() }));
}

/** reasoning_step / tool_call_* → ThinkingState rows. */
export function rowsFromReasoning(events: SSEEvent[]): { primary: string; secondary?: string; mono?: boolean }[] {
  const rows: { primary: string; secondary?: string; mono?: boolean }[] = [];
  for (const e of events) {
    if (e.type === "reasoning_step" && e.step) rows.push({ primary: e.step });
    else if (e.type === "tool_call_started" && e.name) rows.push({ primary: e.name, mono: true });
    else if (e.type === "tool_call_completed" && e.name)
      rows.push({ primary: e.name, secondary: e.formatted_result, mono: true });
  }
  return rows;
}
