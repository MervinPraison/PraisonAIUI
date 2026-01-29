# Theming

Customize the look and feel of your site.

## Component Styling

PraisonAIUI components are **UI-agnostic** — they use semantic CSS classes (e.g., `aiui-header`, `aiui-layout-main`) that you style with your own CSS framework or custom styles.

```css
/* Example: Style with your preferred approach */
.aiui-header {
  background: var(--brand-primary);
  padding: 1rem 2rem;
}

.aiui-header-cta {
  background: var(--accent);
  border-radius: var(--radius);
}
```

## UI Framework Hint

The `ui` field is a **hint** for theming presets, not a hard dependency:

```yaml
site:
  ui: "shadcn"    # shadcn | mui | chakra (theming hint)
```

This can be used by your CSS to apply framework-specific token presets.

## Theme Configuration

```yaml
site:
  theme:
    radius: "md"           # none | sm | md | lg | full
    brandColor: "indigo"   # Any Tailwind color
    darkMode: true
```

## Dark Mode

Enable dark mode support:

```yaml
site:
  theme:
    darkMode: true
```

See [Dark Mode](dark-mode.md) for more details.

## Custom CSS

Add custom styles in your Next.js app:

```css
/* globals.css */
:root {
  --brand-primary: #0D9373;
}
```
