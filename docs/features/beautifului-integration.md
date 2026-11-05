# BeautifulUI Integration Strategy

> **Epic:** [#292](https://github.com/MervinPraison/PraisonAIUI/issues/292) — BeautifulUI integration strategy for AI-native dashboard UX.
> This is the durable, agreed strategy that the linked child issues execute against.

[BeautifulUI](https://www.beautifului.dev/) (MIT, Shane Levine / Turbo) is a **copy-paste / shadcn-registry** library of React primitives for AI-native interfaces: thinking traces, streaming answers with inline sources, HITL approval cards, tool chips, task rows, context chunks, diff/records tables, prompt bars, and a reference chat harness.

There is **no published npm package** named `beautiful-ui`. It ships only as source consumed via the shadcn registry or manual copy.

## 1. Strategic decision

BeautifulUI is adopted as **vendored source**, not a runtime dependency, and is exposed to dashboard plugins **only through the existing `@praisonaiui/react` package** — never by importing upstream file paths directly. Rollout is **phased behind a feature flag**, keeping the current vanilla dashboard as the fallback until parity is proven.

Upstream stack (Next.js 15 · React 19 · Tailwind v4 · TypeScript) is closely aligned with PraisonAIUI's `src/frontend` (Vite · React 19 · Tailwind v4 · shadcn/Radix), so primitives port with adapter work rather than a runtime bridge.

## 2. Pillars

| # | Pillar | Decision |
|---|--------|----------|
| 1 | **Vendoring model** | Add primitives into `src/frontend` via `npx shadcn add https://www.beautifului.dev/r/<component>.json`, or manual copy from [github.com/slev12397/beautiful-ui](https://github.com/slev12397/beautiful-ui). Pin via lockfile plus a recorded registry URL / git SHA. No `beautiful-ui` npm dependency in production builds. |
| 2 | **Adapter layer** | Map PraisonAIUI chat / approval / trace **protocol events** to stable internal props. Primitives sit behind `@praisonaiui/react` exports; dashboard plugins consume those exports, not upstream paths. See [#294](https://github.com/MervinPraison/PraisonAIUI/issues/294). |
| 3 | **Hybrid rollout** | Mount React **islands** (or expand `@praisonaiui/react`) for high-value surfaces first — chat streaming/thinking/tools, then approvals. Vanilla chat (`templates/frontend/plugins/views/chat.js`) stays as the flag-gated fallback until parity is proven. |
| 4 | **Token strategy** | Merge BeautifulUI foundation CSS **selectively** into the existing shadcn theme generation (`praisonaiui/themes.py`). One design system per page — avoid two competing token sets. |
| 5 | **Icon licence** | Upstream `SidebarNav` uses the paid `@central-icons-react`. Port nav patterns with **lucide-react** (already in PraisonAIUI) instead. |

## 3. Phasing

1. **Spike** — evaluate primitives in the dev environment, confirm React 19 / Tailwind v4 alignment. [#293](https://github.com/MervinPraison/PraisonAIUI/issues/293)
2. **Architecture** — adapter layer + upstream pin policy. [#294](https://github.com/MervinPraison/PraisonAIUI/issues/294)
3. **CI gate** — frontend build + BeautifulUI compatibility check (no frontend build gate exists today). [#295](https://github.com/MervinPraison/PraisonAIUI/issues/295)
4. **Migrations** — chat streaming / thinking / tool chips ([#296](https://github.com/MervinPraison/PraisonAIUI/issues/296)), then the approval card ([#297](https://github.com/MervinPraison/PraisonAIUI/issues/297)).
5. **Docs** — upgrade playbook + MIT attribution. [#298](https://github.com/MervinPraison/PraisonAIUI/issues/298)

## 4. Risks

| Risk | Mitigation |
|------|------------|
| No semver npm package | Vendor the source; pin to a recorded registry URL / git SHA in the lockfile. |
| Upstream breaking registry JSON | Vendoring decouples builds from live registry; re-sync is a deliberate, reviewed step. |
| Icon licence (`@central-icons-react` is paid) | Use lucide-react for ported nav patterns; never vendor the paid package. |
| Two competing design systems on one page | Selective CSS token merge into `themes.py`; adapter-only prop surface. |
| React / Tailwind drift | Upstream (React 19 / Tailwind v4) already matches `src/frontend`; the CI gate catches drift. |

## 5. Out of scope

- Replacing the entire dashboard shell in one PR.
- PyPI packaging of BeautifulUI.
- iframe embedding of beautifului.dev.
- Depending on any unpublished npm package for production builds.

## 6. Acceptance criteria status

- [x] Written integration strategy agreed (vendoring + adapter + phased rollout) — this document.
- [x] Risks documented — section 4.
- [x] Child issues filed and prioritised — [#293](https://github.com/MervinPraison/PraisonAIUI/issues/293)–[#298](https://github.com/MervinPraison/PraisonAIUI/issues/298).
- [x] No requirement to depend on unpublished npm packages for production builds — pillar 1, out of scope.
