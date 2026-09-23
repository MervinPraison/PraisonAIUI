# Spike #293 — BeautifulUI primitives in PraisonAIUI

Time-boxed evaluation proving BeautifulUI's AI-native primitives can build inside
PraisonAIUI's React 19 + Vite + Tailwind v4 toolchain and render against **mock,
PraisonAIUI-shaped** agent event streams.

**This folder is a spike. It is intentionally isolated from the shipped bundle:**
nothing here is imported by `src/main.tsx`, and none of it is synced into
`src/praisonaiui/templates/frontend`. Removing `src/frontend/src/spike/` and
`src/frontend/spike.html` fully reverts the spike.

## How to run

```bash
cd src/frontend
npm install
npm run dev          # then open http://localhost:5173/spike.html
```

`SpikePage.tsx` drives the three primitives from `mockEvents.ts`, which uses the
real `SSEEvent` contract from `src/types.ts` (`run_content` deltas,
`reasoning_step` / `tool_call_started` / `tool_call_completed`, and an
`approval_request` payload shaped like a row from `GET /api/approvals`).

## What was vendored (upstream pin)

- Registry index: `https://www.beautifului.dev/r/registry.json`
- Component JSON: `https://www.beautifului.dev/r/<name>.json`
- Upstream repo: `slev12397/beautiful-ui` @ **`44a274e598395ab61e7c96c26fda2758780253b7`** (2026-09-22)
- License: **MIT** (upstream repo)

| Primitive | Registry item | Source | Registry deps | npm deps |
|---|---|---|---|---|
| StreamingText | `streaming-text` | `beautifui/primitives/StreamingText.tsx` (10.3 KB) | foundation | **none** (`react` only) |
| ThinkingState | `thinking-state` | `beautifui/primitives/ThinkingState.tsx` (11.3 KB) | foundation | **none** (`react` only) |
| ApprovalCard | `approval-card` | `beautifui/primitives/ApprovalCard.tsx` (16.5 KB) | foundation, button, glide-menu | **none** (`react` only) |
| Button (dep) | `button` | `beautifui/atoms/Button.tsx` (2.0 KB) | foundation | `class-variance-authority` *(already a PraisonAIUI dep)* |
| GlideMenu (dep) | `glide-menu` | `beautifui/primitives/GlideMenu.tsx` (1.9 KB) | foundation | **none** (`react` only) |
| foundation | `foundation` | `beautifui/foundation.css` (17.5 KB) | — | `shadow-plugin` *(see deviation)* |

### npm packages pulled by the registry & licence check

For the three chosen primitives (+ their two registry deps) the registry pulls
**zero new runtime npm packages**. The only npm dependency any of them declares is
`class-variance-authority` (via `button`), which PraisonAIUI already ships.

- `liveline`, `glimm` — **not pulled.** These are referenced only by chart-style
  components (InsightCards) that we did not adopt. No licence review needed for this spike.
- `@central-icons-react` — **avoided.** All three primitives render icons as
  **inline SVG** (no icon package at all), so no `lucide-react` substitution was
  even required. This is the cleanest possible outcome for the icon concern.

## Deviations from a raw `shadcn add`

1. **`shadow-plugin` removed.** `foundation.css` imports `shadow-plugin/unprefixed`
   (an extra Tailwind plugin dependency). To keep the spike lightweight we replaced
   it with a small local `@theme` block defining the `--shadow-*` scale. Visual
   shadows are approximate but faithful.
2. **Unbalanced-brace fix (upstream bug).** The flattened `foundation.css` emits a
   **stray extra `}`** around `.records-footer-hint` (a `@media` block that lost its
   opening line in the registry export). This makes Tailwind v4 fail with
   `Missing opening {`. We removed the stray brace. **This is a real upstream blocker
   worth reporting to `beautiful-ui`.**
3. **Imports rewritten** from `@/components/*` to `@/spike/beautifui/*` so the spike
   stays isolated and cannot collide with the existing shadcn `components/ui/button.tsx`.
4. **`"use client"` directives dropped** (Vite SPA, not RSC).

## Build result

`vite build` of the spike entry (`spike.html`) succeeds:

```
✓ 39 modules transformed
spike.css   97.82 kB │ gzip: 17.48 kB   (Tailwind + foundation)
spike.js   247.94 kB │ gzip: 78.52 kB   (React runtime + 3 primitives + 2 deps)
```

- **Bundle size:** the primitives are cheap — self-contained TSX with no extra npm
  deps. The JS weight is dominated by the React runtime; the incremental cost of the
  three primitives is on the order of ~40 KB raw / low-teens KB gzip. The CSS is
  full Tailwind + the ~17 KB foundation token/keyframe layer.
- **Motion / `prefers-reduced-motion`:** foundation ships two
  `@media (prefers-reduced-motion: reduce)` guards (global animation kill-switch +
  a StreamText-specific one). Motion is handled responsibly out of the box.
- **Dark mode parity:** foundation defines its **own** token namespace (`--page`,
  `--canvas`, `--ink`, `--accent`, …) with its own `.dark` block, *separate* from
  PraisonAIUI's shadcn tokens (`--background`/`--foreground` via `hsl(var(--…))`).
  Good news: **no token collision** with the dashboard. Trade-off: the primitives do
  **not** automatically inherit `chat.css`/YAML-driven theme colours — they'd need a
  token bridge (map `--ink`→`--foreground`, `--surface`→`--card`, `--accent`→`--primary`)
  before they visually match the shipped chat surface in both themes.

## Assessment

**Fit score: 7/10** for a spike, with caveats for production migration.

**Blockers / gaps:**
- Upstream `foundation.css` brace bug (fixed here; report upstream).
- No automatic theme inheritance — needs a token bridge to match `chat.css` dark/light.
- Primitives embed **demo content** (ice-cream sales copy, fake sources). They accept
  props (`content`, `rows`, `questions`, `onSubmitted`, …) so they *can* be driven by
  real events — proven in `SpikePage` — but the built-in defaults must be replaced.
- PraisonAIUI already has native equivalents: `chat/ThinkingSteps.tsx`,
  `chat/ToolCallDisplay.tsx`, streaming in `chat/ChatMessages.tsx`. Adopting
  BeautifulUI should be weighed against enhancing these rather than duplicating them.

**Recommended primitive order for migration (lowest risk → highest):**
1. **StreamingText** — pure token-stream UX, `react`-only, maps 1:1 to `run_content`.
2. **ThinkingState** — reasoning/tool trace, `react`-only, maps to
   `reasoning_step` + `tool_call_*`; overlaps existing `ThinkingSteps.tsx`.
3. **ApprovalCard** — highest value (HITL) but most surface: pulls `button` +
   `glide-menu` and needs wiring to `POST /api/approvals/{id}/resolve`.
