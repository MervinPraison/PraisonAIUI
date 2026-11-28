# Zero-Code YAML & Plugin Examples

> Run chat apps, A2UI surfaces, UI component pages, docs sites, and installable UI plugins from YAML.

PraisonAIUI has full **Python ↔ YAML ↔ CLI parity**—you can declare chat apps, UI component pages, live A2UI surfaces, notifications, and static docs sites directly in YAML without writing Python.

## Zero-Code YAML Chat & App Configs

Run any folder in [`examples/yaml/`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml) with `aiui run chat.yaml`:

| Example | What it demonstrates | Run |
|---|---|---|
| [01-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/01-chat) | Minimal zero-code YAML chat agent | `aiui run chat.yaml` |
| [02-profiles](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/02-profiles) | Multi-persona agent switching via `profiles:` | `aiui run chat.yaml` |
| [03-clean-chat](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/03-clean-chat) | Focused sidebar-free chat (`dashboard.sidebar: false`) | `aiui run chat.yaml` |
| [04-tools](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/04-tools) | Built-in tool registration in YAML | `aiui run chat.yaml` |
| [05-features](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/05-features) | Feature flags and dashboard options | `aiui run chat.yaml` |
| [13-playground](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/13-playground) | Multi-profile playground (`--style agents`) | `aiui run chat.yaml --style agents` |

## Zero-Code YAML App with A2UI, Rich Components & Notifications

Save as `app.yaml` and run `aiui run app.yaml`—editing the file updates blocks, badges, and surfaces live without restarting:

```yaml
style: app
chat:
  preview:
    enabled: true
    surfaceId: main
    width: "40%"
notifications:
  items:
    - title: "Workspace ready"
      type: success
      pinned: true
pages:
  - chat-canvas
  - canvas
  - id: live-surface
    title: Live A2UI
    group: A2UI
    surface:
      id: main
      theme:
        primaryColor: "#2563eb"
      components:
        - id: root
          component: Text
          text: { path: /headline }
          variant: h2
      data:
        headline: "Zero-code A2UI surface from YAML"
  - id: release-status
    title: Release Status
    group: Workspace
    components:
      - type: stepper
        active: 1
        steps:
          - { title: "Build" }
          - { title: "Verify" }
          - { title: "Ship" }
      - type: copy_field
        label: "Install Command"
        value: "pip install aiui"
```

## Docs Site YAML Templates (`aiui build`)

| Template | Focus | Run |
|---|---|---|
| [06-minimal](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/06-minimal) | 5-line YAML → static docs site | `aiui build && aiui serve` |
| [07-blocks](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/07-blocks) | Component blocks & custom widgets | `aiui build && aiui serve` |
| [08-colorful](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/08-colorful) / [09-corporate](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/09-corporate) / [10-dark-modern](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/10-dark-modern) | Themed documentation layouts | `aiui build && aiui serve` |
| [11-developer-portal](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/11-developer-portal) / [12-full-featured](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/yaml/12-full-featured) | OpenAPI reference, SEO, i18n, a11y, search | `aiui build && aiui serve` |

## Installable UI Plugin Package

- **[`examples/plugins/aiui-hello-plugin`](https://github.com/MervinPraison/PraisonAIUI/tree/main/examples/plugins/aiui-hello-plugin)** — Complete third-party Python + React plugin package using `praisonaiui.plugins` entry points and `@aiui/sdk`. See [UI Plugins](https://ui.praison.ai/docs/features/plugins.md) for the full SDK guide.

## Related pages

- [App & Dashboard Overview](https://ui.praison.ai/docs/app-ui/overview.md)
- [Apps, Components & A2UI Examples](https://ui.praison.ai/docs/examples/app-and-components.md)
- [UI Components Overview](https://ui.praison.ai/docs/components/overview.md)
