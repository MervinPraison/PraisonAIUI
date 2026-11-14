# Application Design Protocol (ADP)

Declarative UI design standard for describing application layout, navigation, components, and theming from YAML or JSON manifests.

**Status:** v1alpha1 research draft — see [implementation-status.md](./implementation-status.md) for what is implemented today.

## Documents

| Document | Description |
|----------|-------------|
| [Research report](../application-design-protocol-report.md) | 46 standards compared; YAML vs JSON debate; design principles |
| [spec.md](./spec.md) | Normative specification (draft) |
| [validation-rules.md](./validation-rules.md) | Cross-reference rules R1–R30 |
| [aiui-mapping.md](./aiui-mapping.md) | PraisonAIUI field mapping |
| [implementation-status.md](./implementation-status.md) | Feature implementation tracker |

## Schemas

| File | Purpose |
|------|---------|
| [schema/application.schema.json](./schema/application.schema.json) | Root Application kind |
| [schema/component-catalog.schema.json](./schema/component-catalog.schema.json) | Catalog meta-schema |
| [schema/theme.schema.json](./schema/theme.schema.json) | Theme preset or DTCG tokens |
| [catalogs/default.catalog.json](./catalogs/default.catalog.json) | Default component and layout catalog |

## Examples

| File | Description |
|------|-------------|
| [examples/minimal.application.yaml](./examples/minimal.application.yaml) | Smallest valid app |
| [examples/docs-site.application.yaml](./examples/docs-site.application.yaml) | Full docs site |
| [examples/landing-page.application.yaml](./examples/landing-page.application.yaml) | Zone-based layout |

## Validate locally

```bash
pip install jsonschema pyyaml
pytest tests/unit/test_adp_schemas.py -v
```

## Quick start

```yaml
schemaVersion: 1
apiVersion: adp.io/v1alpha1
kind: Application

metadata:
  name: my-app
  version: "1.0.0"

spec:
  site:
    title: "My App"
  theme:
    preset: zinc
    darkMode: true
  templates:
    docs:
      layout: TwoColumnLayout
      slots:
        main: { type: DocContent }
  routes:
    - match: "/docs/**"
      template: docs
  content:
    docs:
      dir: "./docs"
```
