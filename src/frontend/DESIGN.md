# PraisonAIUI design system

The visual and interaction contract for the React UI: the `app` shell, the React
chat, and the docs/chat/agents/playground styles. Read it before you add a
component, a page, an overlay or a style.

Rule of thumb: **one source per concern, tokens over literals, flat over boxed.**
If you reach for a hex colour, a raw Tailwind palette class (`bg-zinc-100`,
`text-gray-500`), a one-off shadow, a bespoke button or a hardcoded `px-*` on a
control, stop. There is already a token or a primitive for it.

This file holds two kinds of content:

- **Principles** are durable. They hold as components come and go.
- **Named contracts** (tokens, variants, sizes, primitive names) are the current
  API. Maintain them *with* the code: if you change a token, a variant or a
  primitive, update its entry here in the same change. A stale name in this
  file is a bug, like a stale type.

When a rule and the code disagree, fix whichever is wrong. Do not fork a
one-off at the call site.

Where things live:

| What | File |
| --- | --- |
| Token layer (seeds, tiers, shadcn vars, `@theme` utilities) | `src/styles/theme.css` |
| Entry stylesheet (imports, class sources, prose rules) | `src/index.css` |
| Runtime theme API (presets → seeds, legacy HSL upgrade) | `src/themes.ts` |
| Primitives (shadcn on unified `radix-ui`) | `src/components/ui/*` |
| Server/build seed emitter | `src/praisonaiui/themes.py` `get_seed_theme_css()` |
| Legacy `--db-*` bridge (app shell only) | `src/legacy/bridge.css` |
| Visual harness | `dev/design-dev.html` (`npm run dev`, open `/dev/design-dev.html`) |

## Principles

1. **Flat, not boxed.** No card-in-card and no divider borders inside a panel.
   Group with whitespace plus one hairline. Never nest rounded boxes.
2. **Floating panels float.** Popovers, menus, dialogs and toasts use a soft,
   layered, downward shadow (`shadow-md` / `shadow-lg`, i.e. `--ui-shadow-float`
   / `--ui-shadow-overlay`) and a 6–8% hairline (`border-hairline`), not heavy
   framed borders.
3. **Tokens only.** New code uses the token utilities below (`bg-background`,
   `text-muted-foreground`, `border-hairline`, `bg-fill-3`, `text-tier-2` …) or
   `var(--token)`. No hex, no `rgb()`, no raw palette classes. Text hierarchy
   comes from the alpha tiers (`--ui-text-1..4`), never from new colours.
4. **One primitive per concern.** `Button`, `Spinner`, `Skeleton`, `Empty`,
   `Kbd`, `Badge`, `Input`/`Textarea`, the native disclosure, `Sidebar`, `Toaster`. Use
   and extend them; do not fork them.
5. **Style lives in the primitive.** Call sites pass `variant` and `size`. They
   do not pass `h-*`, `px-*`, `py-*`, `rounded-*`, font sizes or icon sizes that
   re-specify what the variant owns. `className` is for layout (margin, flex,
   width), not chrome.
6. **Immediate feedback.** Hover paints instantly. State changes never wait on
   an animation. The UI updates first and reconciles with the server afterwards.
7. **Dark mode is designed, not inverted.** Every token has a deliberate dark
   value (deeper surfaces, heavier shadows, lightened links, dark on-colours).
   Check every change in both modes.
8. **Accessible by default.** WCAG AA text contrast, a visible 2px focus ring on
   every interactive element, `prefers-reduced-motion` honoured, and labels on
   icon-only controls (`aria-label`).

## Token layer

`styles/theme.css` is the single token source. It has three layers. Python, YAML
and runtime code only ever write **seeds**; everything else is derived with
`color-mix(in oklab, …)`, so one seed change restyles every surface in both
modes.

All defaults sit in `@layer base`. Unlayered CSS (the server's
`<style id="aiui-server-theme">`, the build-time `assets/theme.css`, user
`custom_css`) always wins without `!important`.

### L0 seeds (inputs)

| Seed | Light | Dark | Set by |
| --- | --- | --- | --- |
| `--seed-accent` | `var(--seed-accent-light, var(--seed-ink))` | `var(--seed-accent-dark, …)` | derived; set it directly to pin one accent for both modes |
| `--seed-accent-light` / `-dark` | unset | unset | colour presets: Tailwind **600** (light, AA on white) / **500** (dark) |
| `--seed-accent-fg` | unset | unset | optional explicit on-accent text colour |
| `--seed-tint` | `#71717a` (zinc) | same | neutral preset hue (zinc, slate, stone, gray, neutral) |
| `--tint-mix` | `2%` | `4%` | how much the tint colours neutral surfaces |
| `--accent-mix` | `0%` | same | how much the accent bleeds into fills and strokes (`4%` for colour presets) |
| `--seed-ink` | `#18181b` | `#ededef` | text and alpha tiers |
| `--seed-paper` | `#ffffff` | `#0e0e10` | page |
| `--seed-sunken` | `#f4f4f5` | `#09090b` | sidebar |
| `--seed-raised` | `#ffffff` | `#19191c` | popovers, cards |
| `--seed-danger` / `-success` / `-warning` / `-info` | `#dc2626` `#15803d` `#b45309` `#2563eb` | `#f05252` `#34b27b` `#e3a008` `#4f8cf7` | semantic colours (AA as text on every surface) |
| `--radius` | `0.5rem` | | YAML `radius: none\|sm\|md\|lg\|xl` → `0\|.3\|.5\|.75\|1rem` |
| `--density` | `1` | | `[data-density=compact]` `.875`, `spacious` `1.125` |
| `--font-size-base` | `0.9375rem` (15px) | | compact 14px, spacious 16px |
| `--aiui-font-sans` / `--aiui-font-mono` | system stacks (below) | | |

Neutral presets are monochrome: `--seed-accent: var(--seed-ink)` and
`--accent-mix: 0%`, so primary buttons are near-black in light mode and
near-white in dark mode.

### L1 tiers (derived, do not set)

Declared on `:root, .dark, [data-aiui-scope]`, so a nested `.dark` subtree or a
re-seeded `[data-aiui-scope]` recomputes them.

| Token | Value | Use |
| --- | --- | --- |
| `--ui-bg-app` | paper + tint | page background |
| `--ui-bg-sidebar` | 70% sunken | sidebar |
| `--ui-bg-card` | 70% raised | inline panels (rare, see Flat) |
| `--ui-bg-elevated` | raised | popovers, menus, dialogs |
| `--ui-text-1..4` | ink at 95 / 78 / 64 / 40% | primary, secondary, meta, disabled. 1–3 pass AA on every surface; 4 is for disabled text and decoration only |
| `--ui-fill-1..4` | ink at 11 / 8 / 5.5 / 3.5% (+ accent-mix) | control fills, strongest → faintest |
| `--ui-stroke-1..4` | ink at 16 / 10 / 6 / 4% | input outline, border, divider, faintest |
| `--ui-hairline` | ink at 6% (8% dark) | floating-panel and in-panel hairline |
| `--ui-row-hover` / `--ui-row-active` | fill-4 / accent 7% | list rows, sidebar items |
| `--ui-control-hover` / `-active` | fill-3 / fill-2 | ghost and outline controls |
| `--ui-accent-soft` / `-strong` | accent 12% / 85% | selected pills, emphasis |
| `--ui-link` | accent clamped to OKLCH L ≤ .5 (light), ≥ .74 (dark) | accent as text; always AA |
| `--ui-focus` | 70% accent + ink | focus ring (≥ 3:1 against the page) |
| `--ui-selection` | accent 24% | `::selection` |
| `--ui-bubble-user` | accent 6% | user chat bubble |
| `--ui-code-bg` | fill-4 | inline code |
| `--ui-{danger,success,warning,info}-soft` | semantic 12–14% | soft status fills |
| `--ui-shadow-xs/-sm/-float/-overlay` | layered, downward | elevation (heavier in dark) |

### L2 shadcn variables (full colours)

`--background --foreground --card(-foreground) --popover(-foreground)
--primary(-foreground) --secondary(-foreground) --muted(-foreground)
--accent(-foreground) --destructive(-foreground) --success(-foreground)
--warning(-foreground) --info(-foreground) --border --input --ring --sidebar
--sidebar-{foreground,primary,primary-foreground,accent,accent-foreground,border,ring}
--chart-1..5`.

They are **full colours**: consume them as `var(--primary)` or through Tailwind
(`bg-primary`). Wrapping them in `hsl()` is invalid (that was the pre-0.4 HSL
triple format). On-colour foregrounds (`--primary-foreground`,
`--destructive-foreground`, …) are computed automatically: black or white,
whichever reaches ≥ 4.5:1 (relative colour syntax, `@supports`-gated, with
static fallbacks). Charts 2–5 rotate the accent hue by 72° steps.

### Tailwind utilities from the tokens (`@theme inline`)

| Utility | Token |
| --- | --- |
| `bg-fill-1..4`, `border-stroke-1..4`, `border-hairline` | fills, strokes, hairline |
| `text-tier-1..4` | text tiers |
| `bg-row-hover`, `bg-row-active`, `bg-accent-soft` | row and selection states |
| `text-link`, `bg-bubble-user`, `bg-code` | link, chat bubble, inline code |
| `bg-{danger,success,warning,info}-soft` | soft status fills |
| `shadow-xs/sm/md/lg`, `shadow-float`, `shadow-overlay` | elevation |
| `max-w-reading` | 760px prose column (chat, docs) |
| `animate-shimmer` | text shimmer (`@keyframes aiui-shimmer`) |
| `text-2xs/xs/sm/base/lg/xl/2xl/3xl` | type scale below |
| `rounded-xs/sm/md/lg/xl/2xl…` | radius ladder below |

## Typography

- Sans: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (+ emoji).
  Mono: `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`.
- Scale: `text-2xs` 12px (micro: kbd, counters) · `text-xs` 13px (**meta**:
  timestamps, captions, durations) · `text-sm` 14px (**UI chrome**: buttons,
  menus, sidebar, inputs) · `text-base` 15px (**body**, = `--font-size-base`) ·
  `text-lg` 17px · `text-xl` 20px · `text-2xl` 24px · `text-3xl` 30px.
- Prose line-height 1.55. Headings use weight and size, not colour.
- Tabular numerals in tables, metrics and durations: inside `.aiui-app`,
  `table` and `[data-numeric]` get `tabular-nums` automatically; elsewhere add
  `tabular-nums`.
- Shell typography is applied by the `.aiui-app` class (font, size,
  line-height, smoothing), never on `html`/`body` (see Legacy isolation).

## Radius, density, layout

- Radius ladder is proportional to `--radius` (default 8px), so `radius: none`
  is square everywhere: `rounded-xs` 4 · `sm` 6 · **`md` 8 (controls)** · `lg` 10
  (menus) · **`xl` 12 (panels, dialogs, popovers)** · `2xl` 16.
- Density scales every spacing utility (`--spacing = .25rem × --density`), so
  `h-8` is **32px comfortable / 28px compact**. Controls are 32px tall by
  default (`Button` `default`, `Input`). Set `data-density` on `<html>` (or any
  subtree) at runtime; YAML/Python density is emitted as
  `html:not([data-density])` so a runtime choice wins.
- Shell: 240px sidebar (`--ui-sidebar-w`, icon + label, grouped, collapsible to
  a 48px icon rail), 48px header (`--ui-header-h`: page title, ⌘K button, mode
  toggle). Content max width: `max-w-reading` (760px) for chat and docs, full
  width for data pages.
- Code blocks and tables inside flex/grid need `min-w-0` on every flex/grid
  ancestor, or they overflow on mobile.
- Z ladder (use the tokens for app-level layers; local stacking stays
  `z-10`/`z-20`): `--z-sticky` 20 · `--z-header` 30 · `--z-sidebar` 40 ·
  `--z-overlay` 50 · `--z-modal` 60 · `--z-popover` 70 · `--z-toast` 80 ·
  `--z-tooltip` 90 · `--z-command` 100 · `--z-blocking` 1000. Shell code uses
  them (rail tooltip, floating menu button, skip link, toaster); the radix
  primitives in `components/ui` still use shadcn's `z-50` and stack in portal
  order, which is correct as long as only one modal layer is open.

## Motion

- Functional motion is ~120ms (`--ui-duration`, the default transition
  duration) with `--ui-ease`. Hover colour changes paint instantly (`Button`
  transitions only its focus ring).
- State changes never wait for an animation to finish (no awaiting exit
  animations before updating data).
- `prefers-reduced-motion: reduce` collapses animations and transitions in React
  documents. `Spinner` keeps turning slowly because it is the loading signal.
- Loading uses `Skeleton` (content placeholders) or `Spinner` (inline waits).
  **Never** render the bare text "Loading…".

## Primitives (named contracts)

### Button (`components/ui/button.tsx`)

Variants: `default` (primary, accent fill), `secondary` (soft fill, the default
non-primary look), `outline` (transparent + `border-input`), `ghost` (quiet,
tier-2 text), `destructive` (danger fill; soft danger in dark mode), `link`
(`text-link`).

Sizes: `xs` 24px · `sm` 28px · `default` 32px · `lg` 36px, and the square icon
family `icon-xs` 24 · `icon-sm` 28 · `icon` 32 · `icon-lg` 36. All scale with
density. Icons default to 16px (14px at `xs`/`sm`). Do not override heights,
padding or icon sizes at the call site.

### Others

| Primitive | Contract |
| --- | --- |
| `Spinner` | `size: sm \| default \| lg`, `tone: current \| muted`; `role=status`, `aria-label="Loading"` by default |
| `Skeleton` | `bg-fill-3` pulse; size it with layout classes only |
| `EmptyState` (`shell/primitives.tsx`) | the only empty state in the shell: icon tile, title, description, actions; `role="alert"` for failures |
| `Kbd`, `KbdGroup` | keyboard hints (`⌘K`, `Enter`); 20px tall, `text-2xs` |
| `Badge` | `default \| secondary \| outline \| destructive`; labels and counts. The chat tool row's status pill is hand-built in the chat chunk (it carries the run state colours) |
| `Input`, `Textarea` | 32px input, `border-input`, 2px focus ring; 16px text on mobile (no iOS zoom), 14px from `md` |
| Disclosures | chat tool and reasoning rows are a native disclosure: a button with `aria-expanded` and `aria-controls` pointing at its panel (id from `useId`), not radix Collapsible, which would cost the 140 kB chat-route budget (LIB-UI-7, LP-13). Sidebar groups are buttons with `aria-expanded` too |
| Shell sidebar (`shell/Sidebar.tsx`) | hand-built, not the shadcn `sidebar`: that one statically imports Sheet and Tooltip, which would put radix Dialog and Popper on the boot path (boot budget 150 kB). 240px, `⌘B` toggle, icon rail with its own tooltip (Escape dismisses it) when collapsed; the phone sheet (`shell/MobileNav.tsx`) is a lazy chunk |
| `ShellToaster` (`shell/ShellToaster.tsx`) | sonner toasts on `--popover` with `shadow-float`, `z-index: var(--z-toast)`; lazy (the first `notify()` mounts it), themed by next-themes (`attribute="class"`, `storageKey="aiui-theme-preference"`) |
| `Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `Select`, `Command` | floating surfaces: `border-hairline` + `shadow-md/lg`, radius `lg`/`xl` |

Generated shadcn files are ours. Add a component only when something imports
it (unused ones were removed with their dependencies: calendar, carousel,
chart, resizable, sidebar, …). Refresh with care: never run `shadcn add -o`
over existing components, keep `cn` from `@/lib/utils` (not the `cn` package;
it extends tailwind-merge with the theme's `shadow-float/overlay` and
`max-w-reading`), keep `radix-ui` pinned, and delete the
`:root/.dark --sidebar: hsl(…)` block the CLI appends to `index.css`.

## Chat idiom

- User messages: a subtle filled bubble (`bg-bubble-user`, radius `xl`),
  right-aligned. Assistant messages: full width, no bubble.
- Tool calls: compact collapsible rows (icon, mono name, status pill, duration
  in tabular numerals) that expand to args/result.
- Reasoning: a collapsible "Thought for Ns" row in tier-3 text.
- Approval: an inline card (one hairline, no shadow) with Approve (`default`)
  and Deny (`outline`) buttons.
- Composer: one rounded surface (radius `2xl`, hairline, `shadow-sm`) with an
  attach button, an auto-growing textarea, a send/stop toggle (`icon-sm`) and a
  `Kbd` hint. The composer is sticky and the thread scroll keeps the latest
  message visible.
- Markdown renders through the one `<Markdown variant="chat"|"docs">` (Streamdown)
  with these tokens; never style markdown elements ad hoc.
- Known bundle cost: two copies of `marked` ship, 16.4.2 (through mermaid) and
  18.2.0 (through streamdown). Only the lazy diagram chunks load the mermaid
  copy, so the chat route and the docs first screen do not pay for it. An npm
  `overrides` entry pinning mermaid's `marked` to 18 is pending a mermaid smoke
  test (LIBMD-8).

## Theming pipeline

```
YAML site.theme / set_theme / set_brand_color
  └─ Python themes.get_seed_theme_css(preset, radius, accent, density)
       ├─ server: <style id="aiui-server-theme">   (app style)
       └─ compiler: assets/theme.css                (aiui build)
runtime themes.ts
  ├─ applyTheme(preset)       → seeds at :where(:root) (server/build seeds win)
  ├─ applyNamedTheme(soft…)   → seeds at html:root     (beats server seeds)
  └─ upgradeLegacyCustomCss() → rewrites HSL triples in #aiui-custom-css
styles/theme.css: seeds → tiers → shadcn vars → @theme utilities
```

- The preset tables (`NEUTRAL_TINTS`, the 600/500 accent pairs) exist in both
  `themes.py` and `themes.ts`; `tests/unit/test_seed_theme.py` keeps them equal.
- **Breaking change (custom CSS).** `--primary: 221 83% 53%` (a bare HSL triple)
  is no longer a valid colour. Write `--primary: hsl(221 83% 53%)`, or better,
  set the seed: `--seed-accent: #2563eb`. `aiui validate` warns (code 5001) when
  `site.custom_css` sets a triple, and the React UI rewrites such CSS at
  runtime where it can.

## Legacy dashboard isolation

The default `dashboard` style (vanilla JS) also links `/assets/index.css`. It
must render exactly as before, so:

- Custom properties may be declared on `:root` (they are inert until read).
- Rules that paint elements (`html`/`body` colours, `color-scheme`, the `*`
  border/outline colour, `::selection`, reduced motion) are scoped with
  `:where(html[data-aiui-shell], html:has(script[src*="/assets/index.js"]), html:has(script[src*="/src/main.tsx"]))`,
  i.e. to documents that run React. Never add a bare `html`, `body` or `*` rule.
- Preflight's default font stays Tailwind's (`--default-font-family`); our
  stack is applied by `.aiui-app`.
- Do not change the meaning of a Tailwind utility that legacy plugin JS uses.
- The `--db-*` bridge for legacy views under the app shell lives in
  `legacy/bridge.css`, scoped to `html[data-aiui-shell='react']`.

`tests/unit/test_light_mode_contrast.py` guards these rules and recomputes the
WCAG ratios from the seeds, so a token edit that breaks AA fails CI.

## Checklist for a UI change

- [ ] Tokens and primitives only (no hex, no palette classes, no px overrides on controls).
- [ ] Checked in light and dark, comfortable and compact, at 390px width.
- [ ] Focus ring visible; icon-only controls have `aria-label`.
- [ ] No bare "Loading…"; no card-in-card.
- [ ] This file updated if a token, variant or primitive changed.
