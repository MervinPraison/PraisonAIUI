# Theme System

> The theme feature (praisonaiui.features.theme) holds the dashboard's colour

The theme feature (`praisonaiui.features.theme`) holds the dashboard's colour
preset, mode (`dark` or `light`) and corner radius on the server, and serves
them as CSS custom properties (`--db-*`) over `/api/theme`. The vanilla
`dashboard` style and its chat page read these variables; the React app shell
bridges them to its own tokens.

## Quick Start

```bash
# Current state: preset, mode, radius, variables, presets, modes, radii
curl http://localhost:8000/api/theme

# Switch to light mode
curl -X PUT http://localhost:8000/api/theme \
  -H "Content-Type: application/json" \
  -d '{"mode": "light"}'

# Change preset and radius
curl -X PUT http://localhost:8000/api/theme \
  -H "Content-Type: application/json" \
  -d '{"preset": "blue", "radius": "lg"}'
```

`PUT /api/theme` accepts any of `preset` (one of the 22 presets or a registered
custom theme; an unknown name returns 400), `mode` and `radius`, and returns the
full state.

## Variables

Each mode sets a group of `--db-*` variables; the preset adds the accent and the
radius setting adds `--db-radius`. A few of them:

| Variable | Dark | Light | Usage |
|----------|------|-------|-------|
| `--db-bg` | `#18181b` | `#fafafa` | Page background |
| `--db-text` | `#ffffff` | `#18181b` | Primary text |
| `--db-text-dim` | `#a1a1aa` | `#71717a` | Secondary text |
| `--db-border` | `#3f3f46` | `rgba(0,0,0,0.08)` | Borders |
| `--db-card-bg` | `rgba(255,255,255,0.03)` | `rgba(0,0,0,0.02)` | Cards |
| `--db-hover` | `#27272a` | `rgba(0,0,0,0.04)` | Hover background |
| `--db-accent` | preset accent | preset accent | Buttons, links, highlights |
| `--db-accent-rgb` | preset `r,g,b` | preset `r,g,b` | Accent with alpha |
| `--db-accent-glow` | accent at 15% | accent at 15% | Focus and glow |

Sidebar, muted, popover, semantic (`--db-success`, `--db-warning`, `--db-error`,
`--db-info`) and scrollbar variables follow the same pattern. Override any of
them with `aiui.set_custom_css()`.

## Custom Themes

A custom theme is an accent colour. Register one from Python:

```python
import praisonaiui as aiui

aiui.register_theme("ocean", {"accent": "#0077b6"})
aiui.register_theme("sunset", {"accent": "#ff6b35", "accentRgb": "255,107,53"})
```

`accent` is any CSS colour; `accentRgb` is derived from a hex accent and is
required otherwise. An invalid value raises `ValueError`. The theme then appears
in the theme picker and in `/api/theme/presets`.

Or over HTTP:

```bash
curl -X POST http://localhost:8000/api/theme/register \
  -H "Content-Type: application/json" \
  -d '{"name": "ocean", "accent": "#0077b6"}'
```

A built-in preset name cannot be registered or deleted.

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/theme` | GET | Full theme state and CSS variables |
| `/api/theme` | PUT | Set `preset`, `mode` and/or `radius` |
| `/api/theme/presets` | GET | All presets with accents, split into `builtin` and `custom` |
| `/api/theme/register` | POST | Register a custom theme (`name`, `accent`, optional `accentRgb`) |
| `/api/theme/{name}` | DELETE | Delete a custom theme |

## Related

- [CSS Architecture](https://ui.praison.ai/docs/features/css-architecture.md) — CSS layers, variables and cascade order
- [Theming](https://ui.praison.ai/docs/features/theming.md) — YAML `site.theme` and `aiui.set_theme()`
- [Dark Mode](https://ui.praison.ai/docs/features/dark-mode.md) — How the colour mode is chosen
- [Python API](https://ui.praison.ai/docs/api/python.md) — `set_theme()`, `set_custom_css()`, `register_theme()`

## Related pages

- [How the UI Looks Are Built](https://ui.praison.ai/docs/features/css-architecture.md)
- [Theming](https://ui.praison.ai/docs/features/theming.md)
- [Dark Mode](https://ui.praison.ai/docs/features/dark-mode.md)
