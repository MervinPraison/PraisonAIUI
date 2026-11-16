# Theming

Set the colour preset, corner radius and colour mode in YAML (`site.theme`) or
from Python (`aiui.set_theme()`).

## Theme Presets

PraisonAIUI includes all 22 official [Tailwind CSS colors](https://tailwindcss.com/docs/colors) as theme presets:

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

The React styles served by `aiui run` also read `site.theme.mode` (`light`,
`dark` or `system`), and a viewer's own choice in the theme toggle wins over
both. The full order is in [Dark Mode](dark-mode.md#colour-mode-order).

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
