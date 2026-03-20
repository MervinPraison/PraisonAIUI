# Theming

Customize the look and feel of your site with YAML configuration.

## Theme Presets

PraisonAIUI includes all 22 official [Tailwind CSS colors](https://tailwindcss.com/docs/colors) as theme presets:

```yaml
site:
  theme:
    preset: "zinc"     # Any Tailwind color name
    radius: "md"       # none | sm | md | lg | xl
    darkMode: true
```

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

Enable or disable dark mode:

```yaml
site:
  theme:
    darkMode: true   # true | false
```

The frontend includes a ThemeToggle component for light/dark/system modes.

## Theme Toggle Component

Add a theme toggle to your header:

```tsx
import { ThemeToggle } from '@praisonaiui/react'

function Header() {
  return (
    <header>
      <nav>...</nav>
      <ThemeToggle />
    </header>
  )
}
```

## Custom CSS Variables

Theme presets generate CSS variables you can override:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  --radius: 0.5rem;
}
```

## Advanced: Custom Frontend

For full customization, scaffold a React project:

```bash
aiui init --frontend
cd frontend
pnpm install
pnpm dev
```
