# Application Design Protocol (ADP) — Normative Specification

**Version:** v1alpha1 (draft)  
**Status:** Draft — not yet normative  
**Date:** August 2026

This document uses [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119) keywords: MUST, MUST NOT, SHOULD, MAY.

---

## 1. Scope

ADP defines a declarative format for describing **application UI design**: site metadata, theming, navigation, reusable components, page templates, and URL routing. It does NOT define:

- Server-side APIs or data models
- Agent orchestration or workflow graphs
- Infrastructure or deployment configuration
- Executable code or templating logic in manifests

Implementations MUST treat ADP manifests as **data**, not code.

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Manifest** | A YAML or JSON document conforming to this spec |
| **Application** | The root `kind: Application` manifest describing a complete UI |
| **Component** | A named, reusable UI block with a `type` and `props` |
| **Template** | A layout definition assigning components to slots or zones |
| **Slot** | A named region within a layout (e.g. `header`, `main`) |
| **Zone** | An ordered list of widgets in a slot (WordPress-style) |
| **Route** | A URL pattern mapping to a template |
| **Catalog** | Published JSON Schema defining allowed component types |
| **Compiler** | Tool that validates and emits runtime JSON manifests |
| **Renderer** | Runtime that consumes compiled manifests and renders UI |

---

## 3. Document envelope

Every ADP manifest MUST include:

```yaml
schemaVersion: 1          # Integer; ADP envelope version
apiVersion: adp.io/v1alpha1
kind: Application         # Application | Theme | ComponentCatalog (future)

metadata:
  name: string            # Required; unique identifier
  version: string         # SHOULD use SemVer
  labels: object          # MAY contain key-value pairs
  annotations: object     # MAY contain tooling metadata

spec: object              # Required; kind-specific payload
```

### 3.1 Versioning policy

- `schemaVersion` — integer bumped on breaking envelope changes
- `apiVersion` — string group/version (e.g. `adp.io/v1alpha1`, `adp.io/v1`)
- `metadata.version` — application SemVer (independent of protocol version)
- Breaking changes MUST increment `apiVersion` (e.g. v1alpha1 → v1)
- Deprecated fields MUST include `deprecated: true` and SHOULD include `x-sunset` date

### 3.2 Authoring formats

Manifests MAY be authored as YAML (`.application.yaml`) or JSON (`.application.json`). Semantics MUST be identical. Runtimes MUST NOT consume YAML directly; compilers MUST normalise to JSON before validation.

---

## 4. Application spec

An `Application` spec MUST contain at minimum:

| Field | Required | Description |
|-------|----------|-------------|
| `site.title` | YES | Application display name |
| `templates` | YES | At least one template |
| `routes` | YES | At least one route |

All other fields are OPTIONAL.

### 4.1 Site (`spec.site`)

```yaml
site:
  title: string           # Required
  description: string     # Optional
  ui: shadcn              # UI framework hint; default shadcn
  routeBaseDocs: /docs    # Base path for documentation routes
```

### 4.2 Theme (`spec.theme`)

Theme MAY use preset shorthand or reference a DTCG token file:

```yaml
theme:
  preset: zinc            # Tailwind-style preset name
  radius: md              # none | sm | md | lg | xl
  darkMode: true
  # OR
  tokens: $yaml: ./theme.tokens.json   # DTCG 2025.10 file
```

### 4.3 Navigation

ADP separates **top tab bar** from **sidebar source**:

```yaml
navigation:
  tabs:                   # Top tab bar (Mintlify-style)
    - tab: Documentation
      groups:
        - group: Getting Started
          pages: [index, getting-started/installation]

content:
  docs:
    dir: ./docs
    nav:
      mode: auto           # auto | manual — sidebar source
      sort: filesystem
      collapsible: true
      maxDepth: 4
```

- **`navigation.tabs`** — top-level tab bar with grouped pages
- **`content.docs.nav.mode: auto`** — sidebar generated from filesystem scan
- **`content.docs.nav.mode: manual`** — sidebar driven by `navigation.tabs` groups
- Renderers MUST honour `content.docs.nav.mode` when building sidebar (R29)

### 4.4 Components (`spec.components`)

```yaml
components:
  header_main:
    type: Header          # MUST exist in component catalog
    props:
      logoText: PraisonAIUI
```

Rules:
- Component IDs MUST be unique within the manifest
- `type` MUST match an entry in the published component catalog
- `props` MUST validate against the catalog JSON Schema for that type

### 4.5 Templates (`spec.templates`)

```yaml
templates:
  docs:
    layout: ThreeColumnLayout
    slots:
      header: { ref: header_main }
      left: { ref: sidebar_docs }
      main: { type: DocContent }
      right: null           # Explicitly hide slot

  landing:
    layout: FlexibleLayout
    zones:
      hero:
        - type: HeroBanner
          props: { title: "Welcome" }
```

Rules:
- `layout` MUST be a known layout type in the catalog
- Each slot value MUST be `{ ref: id }`, `{ type: ComponentType }`, or `null`
- Zones MUST use zone names valid for `FlexibleLayout`
- A template MUST declare either `slots` or `zones`, not both (R13)

### 4.6 Routes (`spec.routes`)

```yaml
routes:
  - match: /docs/changelog
    template: changelog
    slots:                  # Optional per-route slot overrides
      right: null
  - match: /docs/**
    template: docs
```

Rules:
- Routes MUST be ordered most-specific-first
- `match` MUST be a glob pattern
- `template` MUST reference a key in `spec.templates`
- Renderers MUST resolve routes at runtime using compiled `route-manifest.json`

### 4.7 Content (`spec.content`)

```yaml
content:
  docs:
    dir: ./docs
    include: ["**/*.md", "**/*.mdx"]
    exclude: []
    nav:
      mode: auto
      sort: filesystem
      collapsible: true
      maxDepth: 4
```

---

## 5. Component catalog

Implementations MUST publish a `component-catalog.schema.json` (meta-schema) and a catalog instance such as [`catalogs/default.catalog.json`](./catalogs/default.catalog.json):

```json
{
  "name": "adp-default-catalog",
  "version": "1.0.0",
  "components": {
    "Header": {
      "description": "Site header with logo and navigation",
      "props": {
        "type": "object",
        "properties": { "logoText": { "type": "string" } },
        "required": ["logoText"],
        "additionalProperties": false
      },
      "aria": { "role": "banner" },
      "slots": ["header"]
    }
  },
  "layouts": {
    "ThreeColumnLayout": {
      "description": "Header + sidebar + main + TOC + footer",
      "slots": ["header", "left", "main", "right", "footer"]
    }
  }
}
```

Custom component types MUST be registered via plugin schema layers. Unknown types MUST cause validation failure in strict mode.

---

## 6. Compilation pipeline

A conforming compiler MUST:

1. Parse YAML or JSON manifest
2. Normalise to JSON
3. Validate against `application.schema.json` (JSON Schema 2020-12)
4. Validate cross-reference rules (see [validation-rules.md](./validation-rules.md))
5. Validate component props against catalog schema
6. Emit runtime manifests:
   - `ui-config.json` — site, components, templates, theme, navigation
   - `route-manifest.json` — ordered routes with template refs
   - `docs-nav.json` — filesystem-derived navigation (if mode auto)

---

## 7. File composition

Manifests MAY include external files using Backstage-style placeholders:

```yaml
theme:
  $yaml: ./theme.yaml

navigation:
  $yaml: ./navigation.yaml
```

Rules:
- Paths MUST be relative to the containing manifest
- Path traversal (`../../`) MUST be rejected
- Supported placeholders: `$yaml:`, `$json:`, `$text:`

---

## 8. Extensions

Vendor extensions MUST use the `x-adp-` prefix:

```yaml
spec:
  site:
    x-adp-customAnalytics: true
```

Implementations MUST preserve unknown `x-adp-*` fields. Non-prefixed unknown fields MUST be rejected in strict mode.

---

## 9. Conformance

An implementation is **ADP-conformant** if and only if it:

1. Accepts manifests with `apiVersion: adp.io/v1alpha1` and `kind: Application`
2. Validates all MUST-level requirements in this spec and validation-rules.md
3. Rejects manifests with unknown fields in strict mode
4. Emits runtime JSON manifests from valid Application specs
5. Resolves routes to templates at render time

---

## 10. Related documents

- [Research report](../application-design-protocol-report.md)
- [Implementation status](./implementation-status.md)
- [PraisonAIUI mapping](./aiui-mapping.md)
- [JSON Schema: application](./schema/application.schema.json)
- [JSON Schema: component catalog](./schema/component-catalog.schema.json)
- [JSON Schema: theme](./schema/theme.schema.json)
- [Examples](./examples/)
