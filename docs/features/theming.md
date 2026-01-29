# Theming

Customize the look and feel of your site with YAML configuration.

## Theme Presets

PraisonAIUI includes 12 official [shadcn/ui](https://ui.shadcn.com/themes) theme presets:

```yaml
site:
  theme:
    preset: "zinc"     # zinc | slate | stone | gray | neutral |
                       # red | rose | orange | green | blue | yellow | violet
    radius: "md"       # none | sm | md | lg | xl
    darkMode: true
```

### Available Presets

| Preset | Description |
|--------|-------------|
| `zinc` | Clean, neutral gray (default) |
| `slate` | Cool blue-gray |
| `stone` | Warm neutral |
| `gray` | True gray |
| `neutral` | Balanced neutral |
| `red` | Bold red accent |
| `rose` | Soft pink-red |
| `orange` | Warm orange |
| `green` | Fresh green |
| `blue` | Classic blue |
| `yellow` | Bright yellow |
| `violet` | Purple accent |

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
    preset: "green"
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

The frontend includes a [ThemeToggle](#theme-toggle) component that allows users to switch between light/dark/system modes.

## Theme Toggle Component

Add a theme toggle to your header with the built-in component:

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

The toggle provides three options:
- **Light** - Force light mode
- **Dark** - Force dark mode  
- **System** - Follow OS preference

## Custom CSS Variables

Theme presets generate CSS variables that you can override:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --radius: 0.5rem;
}
```

## UI Framework Hint

The `ui` field provides a hint for component styling:

```yaml
site:
  ui: "shadcn"    # shadcn | mui | chakra
```

This is used by the runtime to apply appropriate styling conventions.

## Advanced: Custom Frontend

For advanced customization, scaffold a full React project:

```bash
aiui init --frontend
cd frontend
pnpm install
pnpm dev
```

This gives you full control over components, styling, and theming.
