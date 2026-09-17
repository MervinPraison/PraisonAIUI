# Application Design Protocol (ADP) — Research Report

**Version:** 1.0 (draft)  
**Date:** August 2026  
**Scope:** UI, layout, navigation, theming — declarative application design from text manifests  
**Status:** Research and recommendation; not yet a published standard

---

## 1. Executive summary

There is no single existing standard for **designing full application UI from a declarative text file**. Instead, the problem is addressed in fragments:

- **Docs-site generators** (Mintlify, PraisonAIUI, Hugo) declare navigation and layout in config files.
- **Form libraries** (JSON Forms, RJSF) declare layout trees from JSON Schema.
- **Agent UI protocols** (A2UI, AG-UI) declare streaming component surfaces for LLM-generated UI.
- **Catalog standards** (OpenUI, Backstage) declare component metadata without runtime layout.
- **Design token standards** (DTCG 2025.10) declare theming without structure.

**Recommendation:** Define an **Application Design Protocol (ADP)** that synthesises proven patterns from 46 surveyed standards into a UI-only manifest format.

PraisonAIUI already implements approximately 60% of this model. ADP formalises, extends, and publishes what exists today.

---

## 2. Problem statement

### 2.1 What we need

A protocol that lets a developer (or LLM) describe an application's visual design — pages, navigation, components, themes, routes — in **one or more text files**, without writing application code.

### 2.2 What exists today (fragmented)

| Need | Who solves it | Gap |
|------|---------------|-----|
| Docs site from config | Mintlify, PraisonAIUI, Docusaurus | No shared spec; Mintlify uses JSON, others use YAML or JS |
| Component catalog | OpenUI, A2UI | No layout or routing |
| Layout trees | JSON Forms uiSchema | Forms only, not app shells |
| Theming | DTCG, Material 3 | Tokens only, no pages |
| Agent-generated UI | A2UI | Runtime streaming, not human-authored static sites |
| Software metadata | Backstage | Catalog entities, not UI composition |

### 2.3 Design goals for ADP

1. **Human-readable** — editable without IDE plugins
2. **LLM-safe** — structural schema rejects unknown fields
3. **Portable** — same manifest renders on any ADP-compliant runtime
4. **Validatable** — fail fast at build time, not in the browser
5. **Extensible** — plugins add catalog entries, not inline code
6. **Accessible** — ARIA hints required in component catalog

---

## 3. Standards landscape — 46 protocols in 10 categories

Each entry describes **how UI/layout/navigation is declared** — the primary comparison dimension.

### Category A: Web platform baseline (5)

| Standard | Format | How UI/layout/navigation is declared | Schema | Versioning |
|----------|--------|--------------------------------------|--------|------------|
| **HTML + CSS** | `.html` + `.css` | Semantic elements; CSS Flexbox/Grid; `<nav>` + links | Living spec grammar | Browser Baseline |
| **Web Components + DSD** | HTML + JS | Custom element tree; slots; Declarative Shadow DOM | DOM IDL | Platform flags |
| **WAI-ARIA + APG** | HTML attributes | Landmarks, widget roles, keyboard patterns | WAI-ARIA 1.2 | Rec track |
| **DTCG Design Tokens** | JSON | Token groups: `$value`, `$type`, `{alias}` refs — **no layout** | DTCG 2025.10 | Date editions |
| **OpenUI** | YAML/JSON | Component catalog: `components{id: props}` — **no layout tree** | Prop definitions | Per-library version |

### Category B: Schema-driven forms and layout (3)

| Standard | Format | How UI/layout/navigation is declared | Schema | Versioning |
|----------|--------|--------------------------------------|--------|------------|
| **JSON Forms** | JSON Schema + UI Schema | `VerticalLayout`, `Control`, `Categorization` with `scope` pointers | JSON Schema + uiSchema | Package SemVer |
| **RJSF** | JSON Schema + uiSchema | Schema-tree mirroring; `ui:widget`, `ui:options` | React convention | Package SemVer |
| **Google A2UI** | JSONL stream | Flat adjacency-list; `createSurface`; catalog-constrained types | JSON Schema catalog | v0.9.1 / v1.0 RC |

### Category C: Docs-site generators (6)

| Standard | Format | How UI/layout/navigation is declared | Schema | Versioning |
|----------|--------|--------------------------------------|--------|------------|
| **Mintlify** | JSON (`docs.json`) | `navigation.groups[].pages[]`; `$schema` URL; `$ref` splitting | Published JSON Schema URL | Platform |
| **PraisonAIUI** | YAML | `components` → `templates{layout, slots, zones}` → `routes` | Pydantic (internal) | `schemaVersion: 1` |
| **Docusaurus** | JS config | `themeConfig.navbar`, plugin sidebar config | TypeScript types | Package SemVer |
| **Hugo** | TOML/YAML | `menu.main[]`, theme selection | Hugo schema | Release train |
| **Jekyll** | YAML | Frontmatter per page; `_data/` nav | Conventions | SemVer |
| **Gatsby** | JS/TS | `siteMetadata` + `plugins[]` | JS object | Major versions |

### Category D: Native declarative UI — reference only (5)

| Standard | Format | Serialised wire format? | Navigation model |
|----------|--------|-------------------------|------------------|
| **Jetpack Compose** | Kotlin | No | `NavHost` + routes |
| **SwiftUI** | Swift | No | `NavigationStack` |
| **Flutter** | Dart | No | `Router` / `Navigator` |
| **Qt QML** | `.qml` | Yes | `StackView`, bindings |
| **XAML** | XML | Yes (dialect-fragmented) | `Frame`, `NavigationView` |

### Category E: Design systems (2)

| Standard | Format | Theming model |
|----------|--------|---------------|
| **Material Design 3** | DTCG JSON | reference → system → component token tiers |
| **Bootstrap 5.3** | SCSS → CSS vars | Sass maps → `--bs-*` custom properties |

### Category F: Design-to-code bridges — not source-of-truth (3)

| Standard | Output | Why not ADP source |
|----------|--------|-------------------|
| **Figma MCP** | React+Tailwind context | Proprietary; bridge only |
| **Webflow export** | HTML/CSS/JS ZIP | No schema; paid export |
| **Framer export** | React bundles | Platform lock-in |

### Category G: Component documentation (1)

| Standard | Format | Navigation |
|----------|--------|------------|
| **Storybook CSF 3** | TS modules | Sidebar via `title` path hierarchy |

### Category H: Configuration and packaging (12)

| Standard | Format | Composition mechanism | ADP borrow |
|----------|--------|----------------------|------------|
| **Kubernetes CRD** | YAML | `apiVersion/kind/spec`; structural OpenAPI | Structural validation |
| **Helm** | YAML + templates | Subcharts; values merge; `values.schema.json` | Defaults + overrides |
| **Backstage catalog** | YAML | `$yaml:`/`$json:` includes; relation graph | Envelope + includes |
| **OpenAPI 3.1** | YAML/JSON | `$ref`, `components` registry | JSON Schema foundation |
| **AsyncAPI 3.x** | YAML/JSON | Channels → messages | Future event UI |
| **JSON Schema 2020-12** | JSON | `$ref`, `$defs`, conditionals | Validation dialect |
| **CloudEvents** | JSON envelope | Fixed envelope + opaque payload | Future event wrapper |
| **Docker Compose** | YAML | Multi-file merge; profiles | Override stacking |
| **CUE** | CUE | Unify schema + data | Power-user compile layer |
| **Jsonnet** | Jsonnet → JSON | `import` + merge | Theme variants |
| **Pkl** | `.pkl` | `amends`, mixins | Typed config model |
| **OCI Artifact** | JSON manifest | Multi-layer blobs | Bundle packaging |

### Category I: Agent and workflow protocols (7)

| Standard | Format | UI/state declaration | ADP borrow |
|----------|--------|---------------------|------------|
| **MCP** | JSON-RPC | Tool schemas — no UI layout | Future widget actions |
| **AG-UI** | Streaming JSON | EventType enum; snapshots + deltas | Streaming model |
| **A2A** | Proto → JSON-RPC | Agent Cards | Transport |
| **AWP** | Multi-file YAML | 7 layers; rules R1–R32 | Layer + validation model |
| **LangGraph** | workflow.yaml | Graph nodes + edges | Layout graph |
| **AutoGen** | ComponentModel JSON | `{provider, type, version, config}` | Pluggable components |
| **CrewAI** | JSONC/YAML | Agent arrays — weak schema | Anti-pattern |

### Category J: Application packaging (2)

| Standard | Format | Application declaration |
|----------|--------|------------------------|
| **OAM** | YAML | `Application` with `components[]`, `traits[]` |
| **CNAB** | bundle.json | Parameters, credentials, actions |

---

## 4. How they do it — mechanism comparison matrix

| Mechanism | Standards | How it works | ADP |
|-----------|-----------|--------------|-----|
| **Envelope document** | K8s, Backstage, OAM, AWP | `apiVersion` + `kind` + `metadata` + `spec` | Adopt |
| **Component registry + ref** | PraisonAIUI, OpenUI | Named map; templates use `ref:` | Adopt |
| **Layout + slots** | PraisonAIUI, JSON Forms | Layout type + named regions | Adopt (unified) |
| **Route → template** | PraisonAIUI, Flutter | URL glob → template | Adopt |
| **Navigation tree** | Mintlify, Storybook | Hierarchical groups → pages | Adopt |
| **Design token file** | DTCG, Material 3 | Token JSON with aliases | Adopt |
| **Catalog allowlist** | A2UI, OpenUI | Closed component vocabulary | Adopt |
| **Schema + uiSchema split** | JSON Forms, RJSF | Data vs presentation | Partial |
| **Streaming surfaces** | A2UI, AG-UI | Incremental JSON updates | Future |
| **Layered spec** | AWP, Helm | Separate files merged at compile | Adopt |
| **File includes** | Backstage, Mintlify | `$yaml:` / `$ref` external files | Adopt |
| **Structural pruning** | K8s CRD | Reject unknown fields | Adopt |
| **Validation rules R1–Rn** | AWP | Cross-ref beyond JSON Schema | Adopt |
| **JS executable config** | Docusaurus, Gatsby | Code config | Reject |
| **Visual canvas** | Figma, Webflow | Proprietary designer | Reject |
| **Code-only UI** | Compose, SwiftUI | No wire format | Out of scope |

---

## 5. Side-by-side: four closest analogues

| Dimension | PraisonAIUI | Mintlify | A2UI | Backstage |
|-----------|-------------|----------|------|-----------|
| **Authoring format** | YAML | JSON | JSON (stream) | YAML |
| **Envelope** | `schemaVersion` only | Flat JSON | Message `version` | `apiVersion/kind/metadata/spec` |
| **Navigation** | `navigation.tabs[]` + filesystem | `navigation.groups[]` | N/A | N/A (metadata catalog) |
| **Components** | `components{id: type, props}` | N/A | Catalog + adjacency list | Entity kinds |
| **Layout** | `templates{layout, slots, zones}` | Theme only | Surfaces | N/A |
| **Routes** | `routes{match, template}` | Page paths in nav | N/A | N/A |
| **Schema published** | Pydantic only | `$schema` URL | JSON Schema catalog | JSON Schema per kind |
| **Runtime** | React SPA | Hosted platform | Any renderer | Catalog API |
| **Primary use** | Docs sites | Docs sites | Agent-generated UI | Software inventory |

**Synthesis:** ADP combines PraisonAIUI's composition model, Mintlify's schema publishing, A2UI's catalog allowlist, and Backstage's envelope and file includes.

---

## 6. YAML vs alternatives — structured debate

### 6.1 The assumption

YAML is the best authoring format for application design manifests.

### 6.2 Counter-evidence

**Mintlify** — the closest commercial docs-site analogue — uses **JSON** (`docs.json`) with a published `$schema` URL for IDE autocomplete. This works well for flat-to-moderately-nested config but becomes verbose for deep layout trees.

**A2UI** uses **JSON** as both authoring and wire format because LLMs emit structured JSON reliably and ambiguity is unacceptable at runtime.

**Docusaurus and Gatsby** use **JavaScript/TypeScript** config for programmatic power — but this sacrifices portability and LLM generation safety.

### 6.3 Format comparison

| Format | Strengths | Weaknesses for ADP |
|--------|-----------|-------------------|
| **YAML** | Comments; readable nesting; LLM-friendly; PraisonAIUI continuity | Ambiguous typing; merge key footguns; no native DRY |
| **JSON** | Unambiguous; `$schema` IDE support; Mintlify-proven | No comments; verbose for layout trees |
| **TOML** | Clear flat tables (Hugo) | Poor for nested templates/zones |
| **CUE / Jsonnet / Pkl** | Typed composition without templating | Learning curve; not LLM-default |
| **HCL** | Modules, expressions | Ecosystem-bound; overkill for UI-only |
| **JS/TS** | Full programmatic power | Not portable; not LLM-safe |

### 6.4 Recommendation

```
Author (human/LLM) → YAML (default) or JSON (alternate)
        ↓
   ADP compiler/validator (JSON Schema 2020-12)
        ↓
   Normalised JSON manifest (runtime)
        ↓
   UI renderer (catalog-constrained)
```

- **Primary authoring:** YAML — best for nested `templates` / `zones` trees
- **Alternate authoring:** JSON — for teams preferring Mintlify-style `$schema` tooling
- **Never at runtime:** YAML — always compile to JSON before serve
- **Composition:** `$yaml:` file includes (Backstage), not Helm Go templates
- **Power users:** Optional CUE/Jsonnet compiles to YAML before validation

**Verdict:** YAML remains the recommended default, but ADP MUST accept JSON as an equivalent authoring format with identical semantics.

---

## 7. ADP design principles

1. **Declarative, not executable** — manifests describe intent; runtimes render; no inline code or templating logic in core spec.
2. **Schema-first** — JSON Schema 2020-12 is canonical; YAML is authoring convenience.
3. **Structural strictness** — unknown fields rejected in strict mode (K8s CRD pattern).
4. **Catalog allowlist** — component `type` must exist in published catalog (A2UI pattern).
5. **Envelope consistency** — every document uses `apiVersion`, `kind`, `metadata`, `spec`.
6. **Separation of concerns** — theme, navigation, components, templates, routes are distinct spec sections.
7. **Compile, don't interpret** — YAML → validated JSON manifest → static assets at build time.
8. **Accessibility by default** — catalog entries include ARIA role hints (WAI-ARIA pattern).
9. **Versioned protocol** — `schemaVersion` integer + `apiVersion` string; breaking changes bump version.
10. **Extension namespace** — `x-adp-*` prefix reserved; plugins register catalog layers.
11. **File composition** — `$yaml:` includes for modular configs (Backstage pattern).
12. **Route-driven rendering** — URL resolution selects template; no hardcoded layout in renderer.

---

## 8. Proposed ADP document model

```yaml
schemaVersion: 1
apiVersion: adp.io/v1alpha1
kind: Application

metadata:
  name: my-docs-site
  version: "1.0.0"
  labels: {}

spec:
  site:
    title: "My Site"
    description: "..."
  theme:
    preset: zinc          # or DTCG token ref
    radius: md
    darkMode: true
  navigation:
    mode: auto            # auto | manual
    tabs: [...]
  components:
    header_main:
      type: Header
      props: { logoText: "..." }
  templates:
    docs:
      layout: ThreeColumnLayout
      slots:
        header: { ref: header_main }
        main: { type: DocContent }
  routes:
    - match: "/docs/**"
      template: docs
  content:
    docs:
      dir: "./docs"
```

### Data flow

```
application.yaml → Parse → JSON Schema validate → Cross-ref rules (R1–R30)
        → Compile → ui-config.json + route-manifest.json + docs-nav.json
        → React / static renderer
```

---

## 9. PraisonAIUI alignment and gaps

### Already aligned

| PraisonAIUI today | ADP equivalent |
|-------------------|----------------|
| `schemaVersion: 1` | `schemaVersion` + `apiVersion` |
| `components` + `ref:` | `spec.components` + slot refs |
| `templates.layout` + `slots` | `spec.templates` |
| `routes` | `spec.routes` |
| `site.theme` | `spec.theme` |
| Compiler → JSON manifests | ADP compile pipeline |
| Pydantic validation | JSON Schema + cross-ref rules |

### Gaps to close

| Gap | ADP fix |
|-----|---------|
| No published JSON Schema | Publish `application.schema.json` |
| `navigation.tabs` compiled but not rendered | Mandate runtime consumption in spec |
| `route-manifest.json` not used for routing | Mandate route-driven template resolution |
| Dual slots + zones models | Unified: zones = ordered slot arrays |
| Closed hardcoded component types | Published `component-catalog.schema.json` |
| No envelope (`kind`, `metadata`) | Add Backstage-style envelope |

---

## 10. Migration path

Existing `aiui.template.yaml` files remain valid. Migration steps:

1. Add `apiVersion: adp.io/v1alpha1` and `kind: Application` (optional during transition).
2. Wrap top-level keys under `spec:` (compiler accepts both shapes during v1alpha1).
3. Rename `site` fields unchanged; map `navigation`, `templates`, `routes` as-is.
4. Publish catalog; register custom component types via plugin schema layers.

See [adp/aiui-mapping.md](./adp/aiui-mapping.md) for field-by-field mapping.

---

## 11. Open questions

1. **Should ADP standardise layout type names** (`ThreeColumnLayout`) or allow runtime-defined layouts?
2. **Should navigation support both filesystem-auto and manual tabs** in one spec, or require a mode switch?
3. **Should agent-driven surfaces (A2UI) be a separate `kind: Surface`** or embedded in Application?
4. **Should theme reference DTCG token files directly** or use simplified preset shorthand?

---

## 12. Appendix A — Standards index

| # | Standard | URL |
|---|----------|-----|
| 1 | A2UI | https://a2ui.org/ |
| 2 | AG-UI | https://docs.ag-ui.com/ |
| 3 | AWP | https://github.com/veegee82/agent-workflow-protocol |
| 4 | AsyncAPI | https://www.asyncapi.com/ |
| 5 | Backstage catalog | https://backstage.io/docs/features/software-catalog/descriptor-format |
| 6 | Bootstrap | https://getbootstrap.com/ |
| 7 | CloudEvents | https://cloudevents.io/ |
| 8 | CNAB | https://cnab.io/ |
| 9 | CrewAI | https://docs.crewai.com/ |
| 10 | CUE | https://cuelang.org/ |
| 11 | Docusaurus | https://docusaurus.io/ |
| 12 | DTCG Design Tokens | https://www.designtokens.org/ |
| 13 | Figma Code Connect | https://developers.figma.com/docs/code-connect/ |
| 14 | Framer | https://www.framer.com/ |
| 15 | Gatsby | https://www.gatsbyjs.com/ |
| 16 | Helm | https://helm.sh/ |
| 17 | Hugo | https://gohugo.io/ |
| 18 | Jekyll | https://jekyllrb.com/ |
| 19 | JSON Forms | https://jsonforms.io/ |
| 20 | JSON Schema | https://json-schema.org/ |
| 21 | Kubernetes CRD | https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/ |
| 22 | LangGraph | https://langchain-ai.github.io/langgraph/ |
| 23 | Material Design 3 | https://m3.material.io/ |
| 24 | MCP | https://modelcontextprotocol.io/ |
| 25 | Mintlify | https://mintlify.com/docs |
| 26 | OAM | https://oam.dev/ |
| 27 | OCI Artifact | https://opencontainers.org/ |
| 28 | OpenAPI | https://www.openapis.org/ |
| 29 | OpenUI | https://openuispec.org/ |
| 30 | Pkl | https://pkl-lang.org/ |
| 31 | PraisonAIUI | https://github.com/MervinPraison/PraisonAIUI |
| 32 | RJSF | https://rjsf-team.github.io/react-jsonschema-form/ |
| 33 | Storybook CSF | https://storybook.js.org/docs/api/csf |
| 34 | W3C ARIA APG | https://www.w3.org/WAI/ARIA/apg/ |
| 35 | Web Components | https://web.dev/articles/declarative-shadow-dom |
| 36 | Webflow | https://webflow.com/ |
| 37 | AutoGen | https://microsoft.github.io/autogen/ |
| 38 | A2A | https://google.github.io/A2A/ |
| 39 | Jsonnet | https://jsonnet.org/ |
| 40 | Docker Compose | https://docs.docker.com/compose/ |
| 41 | Qt QML | https://doc.qt.io/qt-6/qmlapplications.html |
| 42 | XAML | https://learn.microsoft.com/en-us/windows/apps/develop/platform/xaml/xaml-overview |
| 43 | Jetpack Compose | https://developer.android.com/develop/ui/compose |
| 44 | SwiftUI | https://developer.apple.com/xcode/swiftui/ |
| 45 | HTML + CSS | https://html.spec.whatwg.org/ |
| 46 | Flutter | https://flutter.dev/ |

---

## 13. Conclusion

ADP is feasible and largely prefigured by PraisonAIUI's existing architecture. The research across 46 standards yields a clear synthesis:

- **Envelope** from Backstage/K8s
- **Composition** from PraisonAIUI (components → templates → routes)
- **Catalog** from A2UI/OpenUI
- **Theming** from DTCG
- **Validation** from AWP (structural schema + R-rules)
- **Authoring** in YAML (default) with JSON alternate (Mintlify pattern)

**Status:** Research draft — see [adp/implementation-status.md](./adp/implementation-status.md) for implementation gaps.

The draft spec, JSON Schema files, and example manifests are published alongside this report in [`docs/protocols/adp/`](./adp/).
