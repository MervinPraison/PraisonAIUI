# BeautifulUI Upgrade Playbook

How PraisonAIUI vendors [BeautifulUI](https://www.beautifului.dev/) React primitives so
upgrades are **repeatable** and licence obligations are **explicit**.

!!! info "Related planning"
    Epic [#292](https://github.com/MervinPraison/PraisonAIUI/issues/292) (integration
    strategy) and the adapter/pin policy in
    [#294](https://github.com/MervinPraison/PraisonAIUI/issues/294).

## 1. What BeautifulUI is

BeautifulUI (MIT, © Shane Levine / Turbo) is a library of React primitives aimed at
**AI-native interfaces** — thinking traces, streaming answers with inline sources,
human-in-the-loop approval cards, tool chips, task rows, context chunks, and a reference
chat harness.

**It is a shadcn registry + copy-paste library — not an npm package.** There is no
published `beautiful-ui` package. You install components by resolving a registry URL, and
the source is copied into your tree (like any other shadcn/ui primitive).

- Website & registry: <https://www.beautifului.dev/>
- Upstream source: <https://github.com/slev12397/beautiful-ui>

Upstream stack (Next.js 15 · React 19 · Tailwind CSS v4 · TypeScript) is closely aligned
with PraisonAIUI's `src/frontend` (Vite · React 19 · Tailwind v4 · shadcn/Radix), which is
why copy-paste vendoring works without a framework shim.

## 2. One-time foundation setup

PraisonAIUI already carries the shadcn/ui foundation that BeautifulUI primitives depend on:

- **shadcn config** — `src/frontend/components.json` (`style: new-york`,
  `baseColor: neutral`, `iconLibrary: lucide`, `cssVariables: true`). Its `registries`
  map is where pinned BeautifulUI registry URLs are added (see §3).
- **Theme tokens** — `src/praisonaiui/themes.py` generates the shadcn CSS variables
  (`--background`, `--foreground`, `--primary`, `--radius`, …) at build time for all 22
  official presets, offline. BeautifulUI's foundation CSS (upstream `app/globals.css`)
  must only contribute **new** tokens/utilities; it must **not** redefine variables that
  `themes.py` already owns, or theme switching and dark mode break.

**Rule:** when merging upstream `app/globals.css`, diff it against the variables emitted by
`themes.py` and keep only the additive slices (new keyframes, component-scoped utilities).
Record what was merged in the pin doc (§3).

## 3. Adding or updating a primitive

1. **Install with a pinned registry URL** from `src/frontend/`:
   ```bash
   npx shadcn add https://www.beautifului.dev/r/<component>.json
   ```
   The registry resolves dependencies and CSS slices. Commit the resulting
   `package-lock.json` change in the same PR.
2. **Re-export through the adapter** — add the component to
   `src/frontend/src/components/index.ts` (`@praisonaiui/react`). Consumers never import
   the raw vendored path (see §4).
3. **Update the pin record** — create/update `docs/frontend/BEAUTIFULUI_UPSTREAM.md` with:
   the upstream **git SHA**, the **date**, the **registry base URL**, and the **component
   list** vendored so far. This file is the single source of truth for "what version are
   we on". (It is created the first time a real primitive is vendored — do not add it
   empty.)
4. **Rebuild & sync the bundle** — the committed frontend bundle must be regenerated:
   ```bash
   cd src/frontend && npm run build
   # then sync dist/{index.html,assets/,icon.svg} → src/praisonaiui/templates/frontend/
   ```
   (See `AGENTS.md` → "Frontend Build".)
5. **Run frontend CI** — `.github/workflows/ci.yml` (ruff + pytest) must pass, plus the
   frontend build step.

## 4. Adapter boundary

Consumers import from **`@praisonaiui/react` only** — never from raw vendored paths such as
`@/components/ui/...` or any upstream module.

```tsx
// ✅ stable PraisonAIUI contract
import { Button, ThemeToggle } from '@praisonaiui/react'

// ❌ leaks upstream/shadcn paths across the codebase
import { Button } from '@/components/ui/button'
```

This keeps the upstream surface behind one file (`components/index.ts`), so a BeautifulUI
bump changes vendored source but not consumer imports.

## 5. Rollback

- BeautifulUI-backed views mount behind a **feature flag**; the **vanilla dashboard views**
  (`src/praisonaiui/templates/frontend/plugins/*`) remain the fallback and are kept working.
- To roll back a bad bump: revert the vendoring PR (source + `BEAUTIFULUI_UPSTREAM.md` +
  rebuilt bundle move together in one commit), and disable the flag. No consumer import
  changes are needed because everything routes through the adapter (§4).

## 6. Licence

BeautifulUI is **MIT, © Shane Levine**. The full licence text is retained in
[`THIRD_PARTY_NOTICES.md`](https://github.com/MervinPraison/PraisonAIUI/blob/main/THIRD_PARTY_NOTICES.md)
at the repository root. Any PR that vendors or bumps BeautifulUI source must keep that
notice present and current.

## 7. Commercial icons — do not vendor

Do **not** use `@central-icons-react` without a licence — it is commercial. PraisonAIUI
standardises on **`lucide-react`** (`iconLibrary: lucide` in `components.json`). If an
upstream BeautifulUI primitive imports commercial icons, swap them for lucide equivalents
during vendoring.
