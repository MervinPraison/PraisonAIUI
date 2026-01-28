# Dark Mode

Enable and customize dark mode for your site.

## Configuration

Enable dark mode in your configuration:

```yaml
site:
  theme:
    darkMode: true
```

## How It Works

When `darkMode: true`, the runtime:

1. Checks user's system preference (`prefers-color-scheme`)
2. Adds a toggle button to the Header component
3. Persists user preference in localStorage
4. Applies `data-theme="dark"` to the HTML element

## CSS Variables

Override dark mode colors in your CSS:

```css
[data-theme="dark"] {
  --md-default-bg-color: #0f172a;
  --md-default-fg-color: #f1f5f9;
  --md-primary-fg-color: #14B8A6;
}
```

## Manual Control

Control dark mode via the TypeScript SDK:

```typescript
import { useTheme } from 'praisonaiui/runtime';

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  
  return (
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      Toggle Theme
    </button>
  );
}
```

## Automatic Detection

The runtime automatically detects system preference:

```typescript
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
```
