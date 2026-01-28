# Theming

Customize the look and feel of your site.

## UI Framework

Choose your component library:

```yaml
site:
  ui: "shadcn"    # shadcn | mui | chakra
```

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
