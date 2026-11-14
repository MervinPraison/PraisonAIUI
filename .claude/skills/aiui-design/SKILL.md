---
name: aiui-design
description: Design principles and workflow for PraisonAIUI's React UI (app shell, chat, plugin pages). Use when designing or restyling a page, choosing a layout for a new page type, reviewing UI for tokens, dark mode, phone width or accessibility, comparing our UI with a reference app, or when asked about layouts or the design direction.
---

# Design for PraisonAIUI

`src/frontend/DESIGN.md` is the contract (tokens, primitives, chat idiom,
checklist). `ARCHITECTURE.md` R14 enforces it and R6 keeps the default
`dashboard` style unchanged. Read DESIGN.md before any UI change.

## Principles

- **Tokens and primitives only.** Token utilities (`bg-background`, `text-tier-2`, `border-hairline`, `bg-fill-3`) or `var(--token)`; no hex, `rgb()` or raw palette classes. Primitives from `src/frontend/src/components/ui/`; call sites pass `variant`/`size`, `className` is for layout only.
- **Flat, not boxed.** Whitespace plus one hairline; no card-in-card; floating panels use `shadow-md`/`shadow-lg` and `border-hairline`.
- **Light, dark and phone.** Every change checked in both modes, comfortable and compact density, and at 390 px width. Dark is designed per token, not inverted.
- **Accessible.** WCAG AA text contrast (tiers 1-3), visible focus ring, `aria-label` on icon-only controls, real `<button>`/`<a href>`/`<label>`, `prefers-reduced-motion` honoured.
- **Quiet chrome.** lucide line icons, no emoji in navigation, titles or buttons; one accent; `Skeleton` or `Spinner`, never a bare "Loading…".
- **Data, not code, for page chrome.** Icons (`navIcon`), full-bleed (`page.layout`) and sidebar group order (`layout.groups`) come from the manifest (R1).

## Page types

Pick the type first; reuse the pattern of an existing page of that type.

| Type | Pattern |
|---|---|
| Conversation | DESIGN.md "Chat idiom": `max-w-reading` column, user bubble only, compact tool and reasoning rows, sticky composer; markdown only through `<Markdown>` |
| Dashboard (overview of numbers; not the `dashboard` style) | full width; KPI tiles with `tabular-nums`; charts from `--chart-1..5`; `Skeleton` per tile while loading |
| Settings and forms | rows of label plus help text and a control, grouped by whitespace and a hairline; `Input`/`Textarea`/`Select`; the form uses the width it is given |
| List + detail | list rows on `bg-row-hover`/`bg-row-active`; detail beside it on desktop; on a phone the detail replaces the list with a back control |
| Board | columns in an `overflow-x-auto` box, flat cards with a hairline, counts in `Badge` |
| Log viewer | mono text, tabular timestamps, level as soft status fills (`bg-danger-soft` …), filter bar on top; light mode stays light |
| Editor | full-bleed through `page.layout`; heavy editors load in a lazy chunk (R4, R10) |
| Gallery | responsive grid with fixed aspect ratios and alt text; remote images follow `markdown/urlPolicy.ts` click-to-load |
| Empty and error states | `EmptyState` from `shell/primitives.tsx` (`role="alert"` for failures) |

## Layouts (planned)

Today the app shell has one layout: a 240 px sidebar (collapsible to a 48 px
rail), a 48 px header and the page; "Chat + Canvas" is a page in
`builtin.chat`. **Selectable layouts are planned, not built**: a deployment
would pick a layout, with Chat + Canvas as the app-shell default. Five layout
directions and a "PraisonAI Pro" design system exist as design studies
outside the repo. Do not describe any of them as shipped; when one lands,
document it in DESIGN.md and `docs/features/react-shell.md`, and keep layout
code out of the boot path (R10).

## Workflow

1. Run the page: `aiui run app.py --style app` (the app shell), or the visual
   harness: `cd src/frontend && npm run dev`, then open `/dev/design-dev.html`.
2. Build it with tokens and primitives; add or extend a primitive in
   `components/ui/` rather than styling at the call site, and update DESIGN.md
   if a token, variant or primitive changes.
3. Check light, dark and 390 px; tab through it for focus order and rings.
4. Gates: `npm run size` and `npm run check:closure` (in `src/frontend`),
   `pytest tests/unit/test_light_mode_contrast.py`, and a Playwright spec in
   `src/frontend/e2e/specs/` for visible behaviour.
5. Walk DESIGN.md "Checklist for a UI change" and put the result in the PR.

## Baseline comparison against a reference app

Used to compare our UIs (the default `dashboard`, the `app` shell, apps built
on aiui) with a reference such as the Hermes Agent desktop app. Screenshots
and notes stay local and untracked (`.claude/ui-reset/` is git-ignored).

1. Seed every app with the same content: a few short chats and one rich turn
   with a table, a code block, a bold line, a reasoning step and a tool call.
2. Capture the same screens in each: chat (empty and mid-conversation),
   sessions, settings, logs, command palette and phone navigation, in light,
   dark and 390 px.
3. Write observations as visual facts per app (layout, empty state, composer,
   transcript, type and colour, settings, palette, mobile), no opinions.
4. List the most important differences, then turn each into a concrete change
   against a rule (R14, DESIGN.md) or a planned item. Copy no brand,
   wordmark or proprietary look from the reference.
