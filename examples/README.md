# PraisonAIUI Examples

Example configurations showcasing different site designs, all using the shared `docs/` folder.

## Examples

| Example | Description | Theme |
|---------|-------------|-------|
| [minimal](./minimal) | Bare minimum setup | Default |
| [dark-modern](./dark-modern) | Sleek dark theme | Emerald, rounded |
| [corporate](./corporate) | Professional business | Blue, light mode |
| [colorful](./colorful) | Vibrant and playful | Rose, full radius |
| [full-featured](./full-featured) | All features enabled | Indigo, dark |
| [developer-portal](./developer-portal) | API-first dev docs | Cyan, sharp |

## Usage

```bash
# From any example folder
cd examples/dark-modern

# Validate config
aiui validate

# Build manifests
aiui build

# Start dev mode
aiui dev
```

## Config Structure

Each example contains:
- `aiui.template.yaml` - Site configuration pointing to `../../docs`

All examples use the same docs content but with different:
- Color schemes
- Border radius styles
- Header/footer components
- Navigation settings
- SEO/i18n/a11y configurations
