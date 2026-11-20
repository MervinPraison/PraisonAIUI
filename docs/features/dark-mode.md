# Dark Mode

> Enable and customize dark mode for your site.

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

## Colour mode order

The React styles served by `aiui run` (`chat`, the default, plus `agents`,
`playground`) and the app shell (`style: app`) pick the colour mode in this
order:

1. the viewer's choice, stored under `aiui-theme-preference` (`light`, `dark`
   or `system`);
2. the app's: `aiui.set_theme(dark_mode=True|False)`, else YAML
   `site.theme.mode` (`light`, `dark`, `system`) or `site.theme.darkMode`;
3. the OS (`prefers-color-scheme`) when neither chose one. The page follows the
   OS when it changes.

A static `aiui build` site has no server to report the app's choice, so it
uses `site.theme.darkMode` (dark by default) unless the viewer picked a mode.
With `site.theme.strict: true` a built site has no theme toggle and ignores
the viewer's stored choice ([Branding](https://ui.praison.ai/docs/features/theming.md#branding-a-docs-site)).

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

## Related pages

- [Theme System](https://ui.praison.ai/docs/features/theme-system.md)
- [How the UI Looks Are Built](https://ui.praison.ai/docs/features/css-architecture.md)
- [Theming](https://ui.praison.ai/docs/features/theming.md)
