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
| PraisonAI Pro tokens (the layouts' system, see [below](#praisonai-pro-tokens)) | `src/styles/pro.css` |
| Pro fonts (self-hosted Geist and Geist Mono) | `src/styles/fonts.css` |
| Looks: variants of the Pro tokens a layout paints with (the Paper look of Chat + Canvas, see [below](#looks)) | `src/styles/paper.css` |
| Docs style chrome and article (see [below](#docs-style)) | `src/docs/docs.css` |
| Entry stylesheet (imports, class sources, prose rules) | `src/index.css` |
| Runtime theme API (presets → seeds, legacy HSL upgrade) | `src/themes.ts` |
| Primitives (shadcn on unified `radix-ui`) | `src/components/ui/*` |
| Server/build seed emitter | `src/praisonaiui/themes.py` `get_seed_theme_css()` |
| Legacy `--db-*` bridge (app shell only) | `src/legacy/bridge.css` |
| Visual harness | `dev/design-dev.html` (`npm run dev`, open `/dev/design-dev.html`) |

Tailwind scans this file as a class source, so a utility or a `@theme`
variable named here (as a class, or as `var(--name)`) is compiled into
`index.css`, which the dashboard links too. Name only what the bundle already
ships, or a family (`text-tier-1..4`, `bg-{danger,success}-soft`);
`test_seed_theme.py` checks it, and `npm run check:bundle` catches the rest.

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
- Display: `font-display` (`--aiui-font-display`) for wordmarks, page and
  chat titles, artifact titles and table row headers. It is the sans unless a
  [look](#looks) names a face of its own (Paper: Newsreader).
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
- Code blocks (chat, `markdown/CodeBlock.tsx`): a solid `bg-muted` header
  with a hairline under it, so code never shows through; a fence longer than
  12 lines (a layout may set `--aiui-code-lines`) shows 12 with a 24px fade
  and a "Show all N lines" pill; a line past the right edge fades there and
  the body scrolls sideways with a thin scrollbar; a wrap toggle sits next to
  copy and download, on by default below 640px.
- Known bundle cost: two copies of `marked` ship, 16.4.2 (through mermaid) and
  18.2.0 (through streamdown). Only the lazy diagram chunks load the mermaid
  copy, so the chat route and the docs first screen do not pay for it. An npm
  `overrides` entry pinning mermaid's `marked` to 18 is pending a mermaid smoke
  test (LIBMD-8).

## Page templates

Every page has a template: a layout pattern from the Pro page designs
(`ProList`, `ProBoard`, `ProLogs`, `ProEditor`, `ProGallery`, `ProOverview`,
`ProSettings` `.dc.html`). The template is data. Built-in pages get it from
`praisonaiui/builtin/page_types.py` (`PAGE_TYPE_BY_ID`; `catalog.py` does not
change). A plugin page declares `page_type`. It travels as `pageType` in the
shell manifest, never in `/api/pages`, and the shell puts it on the page root
as `data-aiui-page-type`. Styles key off the template and never off a page id
(ARCHITECTURE R1).

| Template | Built-in pages | Shape |
| --- | --- | --- |
| `list` | sessions, runs, agents, skills, memory, knowledge, approvals, jobs, cron, channels, mcp, nodes, guardrails, feedback, eval, training, replay, inbox, api, inspector, artifacts | Toolbar on a hairline (search, filters, sort, primary action). Dense table: 36px header on the sunken fill (12px/500, muted), 40px rows, tabular numbers. Selected row on the accent soft fill. Optional detail panel (360px+, facts grid, actions); on a phone it stacks under the table, and a tap scrolls it into view and focuses it (Esc or Close returns focus to the row). Pagination "1–8 of 42" with ↑/↓ and Enter hints |
| `board` | kanban, jobs-board, work | Columns 232–340px on the sunken fill, 12px radius, 8px padding. Title 14/600 with a count. Optional WIP limit, which turns warning when over. Cards on the card surface, 10px radius, 12px padding, small shadow. Keyboard moves (Space, arrows, Esc) with a live status bar |
| `log` | logs, debug, traces | Level toggles with counts (an off level is dashed and struck through). Search with "n of m" and previous/next match, plus "Only matching lines". Grid time 100px · level 64px · source 220px · message. The time cell is a time of day (`HH:MM:SS.mmm`, local): ISO 8601 stamps and epoch seconds/ms are converted (`model.logTime`), the full value is the cell's title, and anything longer is clipped with an ellipsis, never drawn over Level. Mono 12.5/20 rows that expand to their detail |
| `editor` | code-studio | Full height. File tree 200–240px, tabs 40px, run bar 44px, code with a 56px gutter, output panel 188px, aside 288–320px, status bar 28px. Panes meet at hairlines; bars and trees on the sunken fill |
| `gallery` | marketplace, theme-picker, templates | Category tabs (ink underline), search row, optional featured slot (16px radius). Auto-fill 220px tiles with 16px gaps: monogram or image, type tag, two-line description, stats, action, error line. Details drawer that pushes the grid |
| `overview` | overview, ops-overview, start, usage, telemetry, security | Centred 1200px measure. Joined KPI strip (hairline separators, 24/600 value, −0.02em). Panels on the card surface |
| `settings` | config, auth | Section cards (12px radius). One row per field, label 14/500 on the left, control (up to 340px) on the right. The YAML mode uses the editor's code surface |
| `chat` | chat, chat-canvas, canvas | The chat engine owns the page; no template styles |

**React and blocks.** `components/page/` holds the templates as components:
`ListDetail` (+ `ListPagination`), `Board`, `LogViewer`, `Editor` (+ `CodeView`,
`FileTree`) and `Gallery`. Their pure logic lives in `model.ts`, and `parts.tsx`
holds the toolbar search, the facts grid and the `Glyph` close and chevron
icons. Glyphs are drawn locally on purpose: importing lucide's from these
chunks would split them out of the chat route. Styles are plain token CSS
(`page.css`, classes `aiui-tpl-*`) in the templates' own lazy chunks, so
`index.css` does not grow. A template imports no block layer, shell, chat
engine or layout (`components/page/isolation.test.ts`). The blocks `board`
and `gallery` (`aiui.board()`, `aiui.gallery()` props) and the new
`list_detail`, `log_viewer` and `code_editor` render through the adapters in
`components/page/blocks/`; a board card that is another block (text, badge,
metric…) renders as that block, as the dashboard's board does. `blocks/coreBlocks.tsx` registers each adapter
lazily, so a template's chunk is fetched only when a page shows it.

**Legacy views.** `legacy/page-types.css` dresses the vanilla views in their
template. `legacy/LegacyViewHost.tsx` imports it, so it arrives with the lazy
legacy host chunk and never at boot (`bridge.css` is in the shell boot through
`runtime.ts`, so it cannot carry it). Every rule starts with
`html[data-aiui-shell='react'][data-aiui-tokens='pro'] [data-aiui-page-type=…]`,
so the styles apply under the selectable layouts only. The classic frame
(`layout: classic`) and the dashboard keep today's look. Rules name the
views' own classes and never an id or a page id. They use tokens only;
colours that arrive in inline styles are matched without their `#`.
`!important` is used only against inline styles. Under a layout, legacy
controls use the Pro accent: the primary clamped to a mid tone, so the white
text the views paint on it stays readable. A view's empty placeholder is
centred like `EmptyState` (an icon tile over its line), never a dashed box,
and a stat-card row fits 180px tiles (two a row on a phone).
`legacy/page-types.test.ts` enforces the scoping, the template names (read
from `page_types.py`) and the token rule. In every app-shell frame,
`legacy/bridge.css` gives legacy buttons and links the 2px focus ring and,
below 768px, lets grid and flex children shrink and scrolls `pre` and tables
inside their own box, so no legacy page scrolls sideways.

## Theming pipeline

```
YAML site.theme / set_theme / set_brand_color
  └─ Python themes.get_seed_theme_css(preset, radius, accent, density)
  │    ├─ server: <style id="aiui-server-theme">   (app style)
  │    └─ compiler: assets/theme.css                (aiui build)
  └─ Python themes.get_pro_seed_css(preset, accent)
       └─ server: <style id="aiui-server-pro-theme"> (app style, non-default accent only)
runtime themes.ts
  ├─ applyTheme(preset)       → seeds at :where(:root) (server/build seeds win)
  ├─ applyNamedTheme(soft…)   → seeds at html:root     (beats server seeds)
  └─ upgradeLegacyCustomCss() → rewrites HSL triples in #aiui-custom-css
styles/theme.css: seeds → tiers → shadcn vars → @theme utilities
styles/pro.css:   (html[data-aiui-tokens=pro] only) Pro palette + --seed-pro-* → the same vars
```

- The preset tables (`NEUTRAL_TINTS`, the 600/500 accent pairs) exist in both
  `themes.py` and `themes.ts`; `tests/unit/test_seed_theme.py` keeps them equal.
- **Breaking change (custom CSS).** `--primary: 221 83% 53%` (a bare HSL triple)
  is no longer a valid colour. Write `--primary: hsl(221 83% 53%)`, or better,
  set the seed: `--seed-accent: #2563eb`. `aiui validate` warns (code 5001) when
  `site.custom_css` sets a triple, and the React UI rewrites such CSS at
  runtime where it can.

## PraisonAI Pro tokens

Pro is the visual system of the selectable layouts (ADR 0003). Its spec is
the Pro design files (`.claude/ui-reset/design/canvas/project/Pro*.dc.html`,
the `renderVals()` palette, identical in all nine). It reuses the token
layer above: same utilities, same primitives, different values.

**When it applies.** `styles/pro.css` is scoped to
`html:is([data-aiui-shell="react"], [data-aiui-docs])[data-aiui-tokens="pro"]`:
the app shell, or the docs site ([Docs style](#docs-style)). `setTokenSystem('pro')`
(`proTokens.ts`, re-exported by `themes.ts`) sets the attribute and `setTokenSystem(null)` removes it. The
shell's layout host (`shell/LayoutHost.tsx`, which imports `pro.css` in the
shell chunk) switches Pro on while a layout frame is mounted and off for the
classic frame and the fallback. Without the attribute nothing in `pro.css`
matches, so the classic frame (`layout: classic`), the dashboard and every
other style render exactly as before. `theme.css` and `index.css` do not
mention Pro.

**Layers.** Everything is in `@layer base`, after `theme.css`, with a more
specific selector. So Pro beats the classic defaults, and unlayered CSS (the
server seed tags, plugin theme presets, `set_custom_css`) still beats Pro.

| Level | Names | Set by |
| --- | --- | --- |
| P0 palette | `--pro-<name>` (table below) | `pro.css` only. Mirrors `themes.py` `PRO_NEUTRALS` and `themes.ts`, kept equal by `test_seed_theme.py` |
| P1 accent seeds | `--seed-pro-{accent,accent-fg,soft,link,ring}`, unsuffixed, or with `-light` / `-dark` | the server (`-light`/`-dark`, from the theme config) and theme presets (unsuffixed, per mode). Default: indigo |
| mapped | the classic seeds, the `--ui-*` tiers and every shadcn variable | `pro.css`, from P0 and P1 |

Like the classic mode seeds, P0 and the P1 defaults are declared on `<html>`
(and the dark palette on `.dark` subtrees) only, so the server's unlayered
`:root` seeds reach every descendant. The mapping is declared again on
`[data-aiui-scope]` and `.dark`, so re-seed a scope with the unsuffixed
`--seed-pro-<role>`.

### Palette

| `--pro-*` | Light | Dark | Becomes |
| --- | --- | --- | --- |
| `background` | `#ffffff` | `#0e0e11` | `--background`, `--seed-paper`, `--ui-bg-app` |
| `foreground` | `#18181b` | `#ededf0` | `--foreground` and every `*-foreground` on a neutral surface, `--seed-ink` |
| `card` | `#ffffff` | `#16161a` | `--card`, `--popover`, `--seed-raised` |
| `sidebar` | `#f7f7f8` | `#09090b` | `--sidebar`, `--seed-sunken` |
| `sidebar-fg` | `#3f3f46` | `#c4c4cc` | `--sidebar-foreground` |
| `sidebar-accent` | `#ebebee` | `#1f1f25` | `--sidebar-accent`, `--ui-row-active` (active nav and list row) |
| `muted` | `#f4f4f5` | `#1d1d22` | `--muted`, `--secondary`, `--accent` (hover), `--ui-bubble-user` |
| `muted-fg` | `#52525b` | `#b4b4bd` | `--muted-foreground`, `--ui-text-2` |
| `subtle` | `#66666e` | `#8e8e98` | `--ui-text-3` (meta: times, counts, hints) |
| `border` | `#e4e4e7` | `#27272d` | `--border`, `--sidebar-border`, `--ui-hairline`, `--ui-stroke-2` |
| `input` | `#d4d4d8` | `#3a3a42` | `--input`, `--ui-stroke-1` |
| `code-bg` | `#fafafa` | `#121216` | `--ui-code-bg` |
| `success` / `-fg` / `-soft` | `#15803d` `#ffffff` `#ecfdf3` | `#34b27b` `#04210f` `#0f2a1e` | `--success(-foreground)`, `--ui-success-soft` |
| `warning` / `-fg` / `-soft` / `-line` | `#b45309` `#ffffff` `#fffbeb` `#f3d9a8` | `#fcd34d` `#1f1300` `#251c10` `#5f400f` | `--warning(-foreground)`, `--ui-warning-soft`, `--ui-warning-line` |
| `danger` / `-fg` / `-soft` / `-line` | `#dc2626` `#ffffff` `#fff5f5` `#f7c9c9` | `#f05252` `#1f0505` `#2e1416` `#5c2328` | `--destructive(-foreground)`, `--ui-danger-soft`, `--ui-danger-line` |
| `info` / `-soft` | `#2563eb` `#eff6ff` | `#4f8cf7` `#13213a` | `--info` (on it: the page colour), `--ui-info-soft`, `--ui-syntax-number` |
| `shadow-sm` / `-float` / `-overlay` | ink at 5–24% | black at 50–70% | `--ui-shadow-xs/-sm/-float/-overlay`, so `shadow-sm`, `shadow-md`, `shadow-lg` |
| `scrim` | ink at 36% | black at 60% | `--ui-scrim` (behind sheets and dialogs) |

One deliberate change from the design: light `danger-soft` is `#fff5f5`, not
`#fef2f2`. The design's "Failed" chip puts danger text on that fill, which
is 4.41:1; `#fff5f5` makes it 4.52:1. Do not put danger text on `bg-muted`
(4.39:1 in light mode); use the danger soft fill or the page.

### Accent

| Swatch | Light accent / link / ring | Dark accent / link / ring | Picked by |
| --- | --- | --- | --- |
| indigo (default) | `#4f46e5` / `#4338ca` / `#4f46e5` | `#5b5ef0` / `#a5b4fc` / `#818cf8` | no preset, a neutral preset (zinc is the default), `indigo`, or accent `#4f46e5` |
| blue | `#2563eb` / `#1d4ed8` / `#2563eb` | `#60a5fa` / `#93c5fd` / `#60a5fa` | preset `blue` or accent `#2563eb` |
| teal | `#0f766e` / `#115e59` / `#0f766e` | `#2dd4bf` / `#5eead4` / `#2dd4bf` | preset `teal` or accent `#0f766e` |
| graphite | `#18181b` / `#18181b` / `#52525b` | `#ededf0` / `#ededf0` / `#a1a1aa` | accent `#18181b` |

Each swatch also sets the on-accent text (`#ffffff` light, `#0e0e11` dark) and
the soft fill (`--ui-accent-soft`, for selected chips and avatar tiles).
One deliberate change from the design: the default indigo's dark accent is
`#5b5ef0` with white text (4.88:1; 3.95:1 against the page), not the
design's pale `#818cf8` with dark text, which made every filled button the
brightest thing on a dark screen. Its dark ring stays `#818cf8`. The
accent keys are the design's own picker values, so `theme.accent`,
`set_brand_color()` and `register_theme()` pick a swatch by its hex.

Any other accent is derived (`themes.py` `pro_accent`) by the design's
custom rule: the colour itself, a soft fill at hex alpha `14` (light) / `29`
(dark), and a link and ring moved toward the ink until they reach 4.6:1 and
3:1. Other colour presets (red … rose) derive from their 600 (light) / 500
(dark) pair. The server writes the result into
`<style id="aiui-server-pro-theme">`, which a default app does not get.

A viewer can also choose a swatch as a theme preset: `builtin.layouts`
registers `proThemePresets()` (Pro Indigo, Blue, Teal and Graphite, ids
`pro.<name>`) through `registerThemePreset` whenever a layout is on offer.
They set only `--seed-pro-*`, so the classic frame is unaffected.

### Type, spacing, radius

- Sans `"Geist"`, mono `"Geist Mono"`, each followed by the system stack
  (`--aiui-font-sans` / `--aiui-font-mono`). Self-hosted in
  `src/styles/fonts.css`: the variable fonts from `@fontsource-variable/geist`
  and `@fontsource-variable/geist-mono` (SIL OFL 1.1, 5.3.0), latin subset
  only, one woff2 each (29.4 kB sans, 23.1 kB mono; the "Pro fonts" budget in
  `.size-limit.mjs`), `font-display: swap`, no preload and no CDN. They are
  build assets, so `npm run sync`, the wheel and `aiui build` output carry
  them (the OFL text: `templates/frontend/LICENSE-fonts.txt`). `shell/LayoutHost.tsx` and `docs/docs.css` import `fonts.css` next
  to `pro.css`; a face downloads only when something is drawn in it, and
  only `pro.css` names these families, so the classic frame, the dashboard
  and the chat, agents and playground styles keep the system stack. Text
  outside the latin range falls back to the system stack, and italic is
  synthesised.
- Scale: the classic scale already matches the design: 12 `text-2xs` (kbd,
  counts), 13 `text-xs` (meta), 14 `text-sm` (chrome, nav, buttons), 15
  `text-base` (body), 17 `text-lg` (section titles), 20 `text-xl` (page
  titles), 24 `text-2xl` (KPI numerals). The design's 12.5px inline mono maps
  to `text-xs`. Body line height is 1.6 in Pro (`.aiui-app`; classic 1.55);
  the design's code blocks use 1.7.
  Weights 400 / 500 (labels, active nav) / 600 (titles, names). Titles use
  `-0.01em` tracking and KPI numerals `-0.02em`.
- Spacing: the 4px grid of the density scale. Controls are 32px (`default`),
  28px (`sm`, icon buttons in the sidebar) and 36px (`lg`, the New chat
  block). Gaps are 4 / 8 / 12 / 16 / 24.
- Layout: 256px sidebar (`--ui-sidebar-w` is `16rem` in Pro), 48px header,
  760px reading column.
- Radius: the classic ladder at the default `--radius` (8px) is the design's:
  `rounded-xs` 4 (kbd, inline code), `sm` 6 (avatar tiles), `md` 8
  (controls, nav rows), `lg` 10, `xl` 12 (cards, panels), `2xl` 16 (composer,
  user bubble), `full` (pills, dots). YAML `radius` still scales it.

### Porting a `.dc.html` design

The design files use shadcn names directly, so most `var(--x)` carry over
as the matching utility (`var(--muted)` → `bg-muted`). The others:

| Design | Use |
| --- | --- |
| `var(--ui-text-3)` | `text-tier-1..4` (tier 3) |
| `var(--ui-link)`, `var(--ui-accent-soft)`, `var(--ui-code-bg)` | `text-link`, `bg-accent-soft`, `bg-code` |
| `var(--ui-{success,warning,danger,info}-soft)` | `bg-{success,warning,danger,info}-soft` |
| `var(--ui-warning-line)`, `var(--ui-danger-line)`, `var(--ui-ring-soft)` | `var(--ui-…)` (Pro only; no utility yet) |
| `var(--syntax-fn)`, `var(--syntax-number)`, `var(--scrim)` | `var(--ui-syntax-fn)`, `var(--ui-syntax-number)`, `var(--ui-scrim)` |
| the design's small, float and overlay shadow variables | `shadow-sm`, `shadow-md` (float), `shadow-lg` (overlay) |
| the design's sans and mono font variables | `font-sans`, `font-mono` |
| inline `style` sizes | the variants and the scale above, never `px` at the call site |

### Guarantees

`tests/unit/test_light_mode_contrast.py` (`TestProContrast`) recomputes, in
both modes: foreground, `muted-fg`, `subtle` and `sidebar-fg` at 4.5:1 on
the page, card, sidebar, muted and active-row surfaces; semantic text on the
page, card and its own soft fill; every on-colour; and for every swatch,
every preset and a set of extreme custom accents, the on-accent text, the
link on every surface and on the soft fill, and a 3:1 focus ring.
`tests/unit/test_seed_theme.py` keeps `pro.css`, `themes.ts` (and `proTokens.ts`) and `themes.py`
equal and checks that every `pro.css` rule is scoped and layered.

### Looks

A look is a variant of the Pro tokens that a layout paints with by default:
its descriptor names it (`meta.look`), and while that frame is mounted the
layout host (`shell/LayoutHost.tsx`) sets `<html data-aiui-look="<name>">`
next to `data-aiui-tokens="pro"`. A look changes only the Pro palette
(`--pro-*`), the default accent seeds (`--seed-pro-*-light/-dark`) and the
font stacks; `pro.css` maps those onto shadcn and the `--ui-*` tiers, so
components draw through the same tokens. Its rules sit in `@layer base`,
scoped to `[data-aiui-tokens="pro"][data-aiui-look="<name>"]`, so the
server's unlayered seeds (`set_brand_color`, `theme.accent`), plugin theme
presets (Pro Indigo, …) and `set_custom_css` still win. The viewer can turn a
look off for plain Pro with the palette's "Switch look: Pro" (and back with
"Switch look: <Look>"), saved in this browser (`localStorage['aiui-look']`).

**Paper** (`src/styles/paper.css`, the Chat + Canvas layout, from
Canvas.dc.html): warm paper neutrals and a navy accent.

| Role | Light | Dark |
| --- | --- | --- |
| page / sidebar / card (`--pro-background` / `-sidebar` / `-card`) | `#f6f3ec` / `#eee9df` / `#fffdf8` | `#1a1814` / `#141210` / `#221f1a` |
| ink / text 2 / text 3 | `#1f1c17` / `#47423a` / `#6b655a` | `#efe9dd` / `#cfc7b8` / `#a39b8b` |
| hairline / stroke (`--pro-border` / `-input`) | `#e4ded2` / `#d6cebf` | `#302b24` / `#3e382f` |
| row active / user bubble / code | `#e4ded1` / `#ebe6db` / `#f4f0e7` | `#2c2924` / `#2b2720` / `#1c1a16` |
| accent / on-accent / soft / link | `#2d4f86` / `#ffffff` / `#e6ebf3` / `#2d4f86` | `#a9c1ea` / `#13161c` / `#262f3e` / `#b4caee` |
| success / warning / danger | `#3b6a35` / `#8a5a12` / `#a3362b` | `#8fc58b` / `#e4b465` / `#ef9282` |

Type: Newsreader (`font-display`), Source Sans 3 (`font-sans`) and JetBrains
Mono (`font-mono`), self-hosted from `@fontsource-variable` (OFL 1.1, latin
woff2, one file each, the "Paper fonts" budget), fetched only while the look
is on. Body line height 1.5. The brand tile is ink on paper with a serif "P" (the default mark only; a site logo stays). Chat + Canvas and Chat (the same frame) declare it, and the docs site wears it for preset `paper` ([Docs style](#docs-style)). Two tokens exist
only under Paper, so read them with a fallback: `--ui-panel-head` (panel
header fill) and `--ui-accent-line` (accent outline). `src/styles/paper.test.ts`
checks the scope and AA contrast of every text pair; text 3 is not used on
the row-active fill (4.31:1 in light mode).

## Docs style

The YAML-driven docs site (`style: docs`, `aiui build`; `style: custom`
shares its chrome) draws in the Pro tokens. `App.tsx` sets
`data-aiui-docs` and `data-aiui-tokens="pro"` on `<html>` for those two
styles, and `src/docs/docs.css` imports `pro.css`, so the docs site gets the
same palette, accent swatches, fonts, radii and hairlines as the layouts.
`docs.css` ships in the legacy App chunk (never in `index.css`), and every
rule is scoped to the `.aiui-docs` root, so the chat, agents and playground
styles keep the classic look. The build's `assets/theme.css` adds the
preset's Pro accent seeds (`themes.inject_theme_css`), so `site.theme.preset`
still picks the accent; custom CSS stays unlayered and wins.

**Preset `paper`** puts the docs site in the [Paper look](#looks): `App.tsx`
adds `data-aiui-look="paper"` next to the Pro attributes, and `docs.css`
imports `paper.css` (the same self-hosted font files as the shell, one
hashed woff2 per face). On top of the palette the look sets reading type,
the last block of `docs.css`: titles (`h1`, `h2`, the hero line, feature
titles, the 404 title) in Newsreader 500; the article in Source Sans 3 at
17px on 1.7 in a 40rem measure (`--docs-measure`, about 75 characters); the
lede 20px (below 640px: 16px text, an 18px lede, `h2` 24px); `h3` 19/600; code in JetBrains Mono 13px on 1.65 under the
canvas's panel-head fill; the brand tile ink on paper with a serif initial.
`aiui build` writes `data-aiui-look="paper"` into `index.html` and the
paper seeds into `assets/theme.css` (`themes.get_paper_first_paint_css`),
so the first paint, before the docs chunk, is already paper.

| Part | Contract |
| --- | --- |
| Header | 56px, sticky, the page colour at 82% with a blur, one hairline under it. Brand tile (24px, radius 7, the accent with the site initial, or the logo), section tabs with an ink underline on the hairline, a 32px field-shaped search button with a ⌘K key (an icon button on phones), links, the call to action (`Button` `sm`, hidden on phones), the theme menu (`Button` ghost `icon-sm`) |
| Sidebar | 256px on the sunken sidebar colour with a hairline. Group labels 13/600; rows 32px, 14px, radius 8, row hover, the active page on the active-row fill with weight 500 (`aria-current="page"`). Long titles wrap. The active page scrolls into view inside the column |
| Article | A 70ch column (plus gutters), 15px on 1.7 (the article's size and line height reach the markdown root, which otherwise carries the chat's 1.55). Title 30/600 at -0.022em, sections 22/600 with 48px above, subsections 17/600; the paragraph under the title is the lede (17px, secondary text). Links in the link colour with a 35% underline that firms up on hover. Inline code on the muted fill with a hairline, radius 5. Lists with tier-3 markers. Blockquotes: a 2px input-colour rule and secondary text, never italic |
| Code blocks | The Streamdown pipeline unchanged; one hairline panel, radius 12, on the code background, a 36px header row (language in tier-3, copy on the right), 13px mono on 1.7. Comments (the GitHub themes' `#6a737d`) take tier-3 text, which keeps 4.5:1 on every docs code fill. Fence meta (`title="app.py"`, a bare file name, `{1,3-4}`, `hl_lines`, `highlight`; `docs/codeMeta.ts`) is read by the docs-only `pre` override (`docs/DocsPre.tsx`, passed by Content.tsx, so the markdown chunk the chat shares is unchanged): the file name replaces the language in the header (mono 12/500, foreground) and highlighted lines get an 11% accent fill with a 2px accent edge, edge to edge, from a scoped `<style>` (it survives Shiki re-rendering the lines). Code groups (`<CodeGroup>` or tabs that each hold one fence): the tab strip is the panel's header on the panel-head fill, the block's own header row is hidden and its copy button sits in the strip |
| Tables | One hairline frame, radius 10, a soft muted header row (13/500, secondary text), hairlines between rows, 14px cells; wide tables scroll inside the frame |
| Components | Mintlify-style tags on their own line (`mkdocsPreprocess`) map onto blocks the docs sanitizer already allows: `<Note>`, `<Info>`, `<Tip>`, `<Check>`, `<Warning>`, `<Danger>` and `<Accordion>` onto `<aiui-admonition>`, `<Tabs>`/`<Tab>` onto `<aiui-tabs>`, and `<Steps>`/`<Step>`, `<CardGroup>`/`<Card>`, `<Frame>`, `<AccordionGroup>` onto `<div itemtype="aiui:…">` drawn by the docs-only `div` override (`docs/DocsBlocks.tsx`), so the markdown chunk the chat shares is unchanged. Steps: a 28px numbered circle on a hairline rail, title 600. Cards: hairline tiles on the card fill, radius 12, a 32px icon tile (the home icon set), title 600, body in secondary text, 1–4 columns (`cols`, one below 640px); a card with `href` is one link that lifts on hover. Frame: the image on a muted mat, radius 16, caption 14px secondary, centred. Accordion: a neutral disclosure (hairline, card fill, a chevron that turns), joined in a group. Images in articles zoom on click or Enter into a native modal `<dialog>` on the scrim (`docs/imageZoom.ts`); focus returns to the image |
| Callouts | MkDocs admonitions: the tone's soft fill, a tone hairline, radius 10, a 16px line icon in the tone (a CSS mask, so it needs no colour literal), title 600. Info (note, info, abstract…), success (tip, hint…), warning (warning, caution…), danger (danger, error, bug…), accent for the rest |
| Images | Block, radius 12, one hairline |
| Home hero image | Radius 12, hairline, float shadow, on the muted fill; `aspect-ratio: auto 16 / 10` reserves its box before it loads (no layout shift). The mode on screen gets `fetchpriority="high"`, the hidden mode's image `loading="lazy"` |
| On this page | 240px from 1280px wide; 13px tier-3 links on a hairline rail, the current section in the foreground with an accent bar (`aria-current="location"`). A heading is current once it rises into the top quarter of the window; at the bottom of the page the last one is. Below 1280px it folds into a disclosure above the article, drawn from the first frame while the page loads and kept when its Markdown has `##`–`####` sections (`docSource.hasSectionHeadings`), so it never pushes the article down |
| Page head | Above the title, one row: the section (eyebrow) on the left, the page actions on the right (`docs/PageActions.tsx`): "Copy page" (`Button` `outline` `sm`, fetches the page's published `.md` and copies it; "Copied" for 2 s, announced in a polite live region) and a `DropdownMenu` (`icon-sm` trigger "More page actions"): Copy page, View as Markdown, Open in ChatGPT, Open in Claude, each with a tier-3 line under its name (44px rows). On touch screens both buttons get a 44px hit area (a transparent `::after`), not a bigger look. External items are real links (`noopener noreferrer`). Not on the home page |
| Sidebar icons | A group's `icon:` (nav YAML) or a page's frontmatter `icon:` puts a 16px lucide line glyph (docs/docsHomeIcons.ts, drawn locally) before the title, 8px gap, tier 3; the current page's glyph takes the link colour. Unknown names draw nothing |
| Breadcrumb | The page head's eyebrow is a `nav` "Breadcrumb": the section on every width; below 768px it reads "Section › Page" (the page in tier 3, `aria-current="page"`, truncated before the page actions; the › is decorative) |
| Section links | `##`–`####` headings end with a copy-link anchor (`docs/headingAnchors.ts`, added as the headings render, so the markdown chunk the chat shares is unchanged; the lucide `link-2` glyph drawn locally, 24px, tier-3): hidden until the heading is hovered or the link focused, dimmed but visible where there is no hover, with a 44px hit area there. A click puts `#id` in the address bar, scrolls the heading to the top and copies the URL; the label turns to "Link to … copied" and the glyph to the success colour for 1.5 s |
| Page footer | Under the article, above previous / next (`docs/PageFooter.tsx`), on one hairline: "Was this page helpful?" with Yes / No (`Button` `outline` `sm`, locally drawn thumb glyphs; 44px hit area on touch) that turn into a polite status line, "No" offering a prefilled new issue; on the right "Last updated <date>" (`<time>`, "17 Nov 2026") and "Edit this page" with a pen glyph, in the link colour. Tier-3 text at 14px. Data: `editUrl` and `lastUpdated` per page in `docs-nav.json`, `pageFooter` in `ui-config.json` (`compiler/page_meta.py`) |
| Previous / next | Two hairline cards (radius 12) under the article, in sidebar reading order within the active tab: "Previous" / "Next" in tier-3 with a chevron, the title 15/500 |
| Footer | One hairline; the YAML `footer.links` columns, then the brand tile, the footer text and the footer component's links and `footer.socials` |
| Phone (< 768px) | The menu button opens a left sheet (288px, at most 85% of the width): brand, the section tabs as a segmented control, the nav tree (the active page scrolled into view), and the links and call to action at the bottom |
| Search | ⌘K / Ctrl+K or the search button open a command dialog (lazy chunk). Empty, it lists the pages by section; with a query it ranks page titles, then `##`/`###` headings, then section text from `search-index.json` (`aiui build`, `compiler/search_index.py`; fetched once, on first open; without it, titles only). A row: a line icon (page, heading, text), the title, the "Section › Page" crumb in tier-3 and a two-line snippet, matched words on the accent soft fill (`<mark>`, text runs, never HTML). A result opens the page at its heading (`docs/hashScroll.ts`, also for deep links). A page that handles `aiui:search-open` itself calls `preventDefault()` on it to take over |

Focus: links, plain buttons, tabs and disclosures get a 2px ring in the
ring colour with a 2px offset; primitives keep their own ring. Page source
fixes (`src/docs/docSource.ts`): YAML frontmatter never shows as text, and
relative link and image targets resolve against the page's own folder
(`quickstart.md` → `/docs/getting-started/quickstart`).

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
