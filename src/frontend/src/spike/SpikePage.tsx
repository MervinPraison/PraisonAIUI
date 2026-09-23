/* Spike #293 — BeautifulUI primitives driven by PraisonAIUI-shaped mock events.
 *
 * Dev-only harness. Run with `npm run dev` and open /spike.html. This page is
 * NOT imported by the shipped library entry (main.tsx) and is NOT synced into
 * src/praisonaiui/templates/frontend — per the issue's non-goals it must not
 * touch the production bundle.
 */
import { useEffect, useState } from "react";
import StreamingText from "@/spike/beautifui/primitives/StreamingText";
import ThinkingState from "@/spike/beautifui/primitives/ThinkingState";
import ApprovalCard from "@/spike/beautifui/primitives/ApprovalCard";
import {
  streamingTimeline,
  tokensFromDeltas,
  rowsFromReasoning,
  REASONING_STREAM,
  APPROVAL_REQUEST,
} from "@/spike/mockEvents";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ font: "600 13px/1.4 ui-monospace, monospace", opacity: 0.6, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function SpikePage() {
  const [dark, setDark] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Emulate the SSE timeline so we exercise real delta pacing (logs only —
  // the primitives below are fed the fully-resolved token/row arrays).
  useEffect(() => {
    const frames = streamingTimeline();
    const timers = frames.map((f) =>
      setTimeout(() => setLog((l) => [...l.slice(-4), `${f.event.type}: ${f.event.token ?? ""}`]), f.at),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const tokens = tokensFromDeltas(streamingTimeline());
  const rows = rowsFromReasoning(REASONING_STREAM);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ font: "700 20px/1.2 system-ui" }}>BeautifulUI spike</h1>
          <p style={{ opacity: 0.6, fontSize: 13 }}>Issue #293 · mock PraisonAIUI event streams</p>
        </div>
        <button onClick={() => setDark((d) => !d)} style={{ padding: "6px 12px", borderRadius: 8 }}>
          {dark ? "☀ light" : "🌙 dark"}
        </button>
      </header>

      <Panel title="StreamingText ← run_content deltas">
        <StreamingText content={tokens} loop={false} sources={[]} followUps={[]} />
      </Panel>

      <Panel title="ThinkingState ← reasoning_step / tool_call_*">
        <ThinkingState rows={rows} active="Thinking" done={`Ran ${rows.length} steps`} />
      </Panel>

      <Panel title="ApprovalCard ← approval_request (/api/approvals)">
        <ApprovalCard
          questions={APPROVAL_REQUEST.questions}
          onSubmitted={(answers) =>
            // In production this maps to POST /api/approvals/{id}/resolve.
            setLog((l) => [
              ...l.slice(-4),
              `resolve ${APPROVAL_REQUEST.id}: ${JSON.stringify(answers)}`,
            ])
          }
        />
      </Panel>

      <Panel title="event log (last 5)">
        <pre style={{ font: "12px/1.5 ui-monospace, monospace", opacity: 0.7, whiteSpace: "pre-wrap" }}>
          {log.join("\n") || "…"}
        </pre>
      </Panel>
    </div>
  );
}
