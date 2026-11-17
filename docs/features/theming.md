# Theming

Set the colour preset, corner radius and colour mode in YAML (`site.theme`) or
from Python (`aiui.set_theme()`).

## Theme Presets

PraisonAIUI includes all 22 official [Tailwind CSS colors](https://tailwindcss.com/docs/colors) as theme presets, plus `paper` (below):

```yaml
site:
  theme:
    preset: "zinc"     # Any Tailwind color name
    radius: "md"       # none | sm | md | lg | xl
    darkMode: true
```

The same settings from Python, which win over YAML:

```python
import praisonaiui as aiui

aiui.set_theme(preset="blue", dark_mode=True, radius="lg")
```

Two more keys apply to the React app shell (`style: app`) only: `accent` (any
CSS colour, overrides the preset's accent) and `density` (`compact`,
`comfortable` or `spacious`).

### The docs site look

A docs site (`style: docs`, the default for `aiui build`) uses the
PraisonAI Pro design: the same colours, type, radii and hairlines as the app
shell's layouts. The preset picks the accent: a neutral preset (`zinc`,
`slate`, `stone`, `gray`, `neutral`) or `indigo` gives the indigo accent,
`blue` and `teal` their Pro swatches, and any other colour its own accent,
derived so links and focus rings keep AA contrast. `site.custom_css` still
overrides everything. Details: `src/frontend/DESIGN.md`, "Docs style".

### The Paper preset

`preset: paper` is the look of the app's Chat and Canvas screen: warm paper
neutrals, a navy accent, Newsreader for titles, Source Sans 3 for text and
JetBrains Mono for code. This site uses it.

```yaml
site:
  theme:
    preset: "paper"
    mode: "system"   # light | dark | system; system follows the reader's OS
```

![The Paper look in light and dark: the Chat and Canvas screen with the comparison table and the script the agent wrote](../images/theme-comparison.png)

What it changes:

- **Docs sites** (`aiui build`) draw in the Paper look itself: the palette
  in both modes, serif titles, 17px text on a 1.7 line height in a 40rem
  column, and the mono for code. The page is paper from its first paint
  (`aiui build` marks `<html data-aiui-look="paper">` and writes the paper
  colours into `assets/theme.css`).
- **The app shell** (`style: app`) takes Paper's navy as its accent. The
  Paper palette and fonts there come with the layout: Chat and Canvas paints
  in Paper by default, the other layouts in plain Pro.
- **Other React styles** (`chat`, `agents`, `playground`) get the navy accent (`#2d4f86` light, `#a9c1ea` dark) on warm neutrals.

The fonts are self-hosted (latin woff2, the same files the app shell uses)
and download only when a page draws in them; nothing loads from a font CDN.

### Available Presets

**Neutral Tones**

| Preset | Description |
|--------|-------------|
| `zinc` | Clean gray (default) |
| `slate` | Cool blue-gray |
| `stone` | Warm neutral |
| `gray` | True gray |
| `neutral` | Balanced neutral |

**Color Accents**

| Preset | Description |
|--------|-------------|
| `red` | Bold red |
| `orange` | Warm orange |
| `amber` | Golden amber |
| `yellow` | Bright yellow |
| `lime` | Fresh lime |
| `green` | Classic green |
| `emerald` | Rich emerald |
| `teal` | Cool teal |
| `cyan` | Bright cyan |
| `sky` | Light sky blue |
| `blue` | Classic blue |
| `indigo` | Deep indigo |
| `violet` | Purple violet |
| `purple` | Rich purple |
| `fuchsia` | Vibrant fuchsia |
| `pink` | Soft pink |
| `rose` | Warm rose |

**Looks**

| Preset | Description |
|--------|-------------|
| `paper` | Warm paper, a navy accent, serif titles ([above](#the-paper-preset)) |

## Examples

### Minimal (Default)
```yaml
site:
  theme:
    preset: "zinc"
    radius: "md"
    darkMode: true
```

### Corporate (Light Mode)
```yaml
site:
  theme:
    preset: "blue"
    radius: "sm"
    darkMode: false
```

### Colorful (Rounded)
```yaml
site:
  theme:
    preset: "rose"
    radius: "xl"
    darkMode: true
```

### Developer Portal (Sharp)
```yaml
site:
  theme:
    preset: "emerald"
    radius: "none"
    darkMode: true
```

## Dark Mode

```yaml
site:
  theme:
    darkMode: true   # true | false
```

`site.theme.mode` (`light`, `dark` or `system`) wins over `darkMode`; `system`
follows the reader's OS. The React styles served by `aiui run` and docs sites
built with `aiui build` read it, and a viewer's own choice in the theme toggle
wins over both. The full order is in [Dark Mode](dark-mode.md#colour-mode-order).

## Theme Toggle Component

The React UI already shows a theme toggle in its header. There is no npm
package to install: inside this repository's frontend (`src/frontend`) the
component comes from the in-repo components barrel,
`src/frontend/src/components/index.ts`:

```tsx
import { ThemeToggle } from '@/components'

function Header() {
  return (
    <header>
      <nav>...</nav>
      <ThemeToggle />
    </header>
  )
}
```

A plugin page in the app shell (`--style app`) reads the current mode with
`useThemeMode()` from `@aiui/sdk` instead.

## Custom CSS Variables

Presets set CSS variables you can override with `site.custom_css` or
`aiui.set_custom_css()`. Each variable holds a complete CSS colour:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --radius: 0.5rem;
}
```

A bare HSL triple such as `--primary: 221 83% 53%` no longer works (`aiui
validate` warns, code 5001). In the app shell, set the seed instead
(`--seed-accent: hsl(221 83% 53%)`) and the derived colours follow in both
modes; see [React app shell: theme seeds](react-shell.md#theme-seeds-migration).

## Advanced: Custom Frontend

For full customization, scaffold a React project:

```bash
aiui init --frontend
cd frontend
pnpm install
pnpm dev
```

---

## Related Pages

- [CSS Architecture](css-architecture.md) — Deep dive into CSS layers, variables, and cascade order
- [Theme System](theme-system.md) — Light/dark mode and custom theme registration
- [Dark Mode](dark-mode.md) — Dark mode toggle configuration
- [Python API](../api/python.md) — `set_theme()`, `set_custom_css()`, `register_theme()`
