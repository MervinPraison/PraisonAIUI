# PraisonAIUI → ADP Field Mapping

Field-by-field mapping from current `aiui.template.yaml` (`Config` model in `src/praisonaiui/schema/models.py`) to ADP `Application` spec.

**Compatibility:** Existing `aiui.template.yaml` files remain valid. ADP adds envelope fields; PraisonAIUI compiler can accept both shapes during v1alpha1 transition.

---

## Envelope (new in ADP)

| ADP field | PraisonAIUI today | Change |
|-----------|-------------------|--------|
| `schemaVersion: 1` | `schemaVersion: 1` | Compatible |
| `apiVersion: adp.io/v1alpha1` | Not present | **Add** (optional during transition) |
| `kind: Application` | Not present | **Add** (optional during transition) |
| `metadata.name` | Not present | **Add** — derive from `site.title` slug |
| `metadata.version` | Not present | **Add** — recommend SemVer |

## Top-level → spec wrapper

| PraisonAIUI (flat) | ADP (envelope) | Change |
|--------------------|----------------|--------|
| `site:` | `spec.site:` | Wrap under `spec` |
| `theme:` (in site) | `spec.theme:` | **Promote** to top-level spec (also in site.theme today) |
| `navigation:` | `spec.navigation:` | Wrap; add `mode` field |
| `navbar:` | `spec.navbar:` | Compatible |
| `footer:` | `spec.footer:` | Compatible |
| `search:` | `spec.search:` | Compatible |
| `content:` | `spec.content:` | Compatible |
| `components:` | `spec.components:` | Compatible |
| `templates:` | `spec.templates:` | Compatible |
| `routes:` | `spec.routes:` | Compatible |
| `seo:` | `spec.seo:` | Compatible |
| `i18n:` | `spec.i18n:` | Compatible |
| `a11y:` | `spec.a11y:` | Compatible |
| `dependencies:` | `spec.dependencies:` | Compatible (future catalog field) |
| `style:` | Not in ADP v1alpha1 | **Out of scope** — chat/dashboard modes are separate kinds |
| `chat:` | Not in ADP v1alpha1 | **Out of scope** — future `kind: ChatApplication` |
| `auth:` | Not in ADP v1alpha1 | **Out of scope** |
| `dashboard:` | Not in ADP v1alpha1 | **Out of scope** |
| `widgets:` | Not in ADP v1alpha1 | **Out of scope** |
| `layout:` | Not in ADP v1alpha1 | **Out of scope** — chat layout positioning |

## Site fields

| Field | PraisonAIUI | ADP | Notes |
|-------|-------------|-----|-------|
| `site.title` | Required | Required | Same |
| `site.description` | Optional | Optional | Same |
| `site.ui` | `shadcn\|mui\|chakra` | Same enum | Same |
| `site.theme` | Nested in site | Promoted to `spec.theme` | ADP separates theme from site metadata |
| `site.routeBaseDocs` | `/docs` default | Same | Same |
| `site.customCss` | Optional | `spec.site.customCss` | Same |
| `site.plugins` | List of plugin names | Same | Same |
| `site.logo` | Optional | Future ADP field | Not yet in schema |

## Theme fields

| Field | PraisonAIUI | ADP | Notes |
|-------|-------------|-----|-------|
| `theme.preset` | Tailwind color name | Same enum | Same |
| `theme.radius` | `none\|sm\|md\|lg\|xl` | Same | Same |
| `theme.darkMode` | Boolean | Same | Same |
| `theme.tokens` | Not present | DTCG file ref | **New** — optional DTCG 2025.10 reference |

## Navigation fields

| Field | PraisonAIUI | ADP | Notes |
|-------|-------------|-----|-------|
| `navigation.tabs[]` | Mintlify-style tabs | Same structure | Same |
| `navigation.mode` | Implicit (filesystem) | Explicit `auto\|manual` | **New** — ADP requires explicit mode |

## Component fields

| Field | PraisonAIUI | ADP | Notes |
|-------|-------------|-----|-------|
| `components.{id}.type` | String literal | Must be in catalog | **Stricter** — catalog validation |
| `components.{id}.props` | `dict[str, Any]` | Validated against catalog schema | **Stricter** |

## Template fields

| Field | PraisonAIUI | ADP | Notes |
|-------|-------------|-----|-------|
| `templates.{id}.layout` | String | Catalog enum | Same values |
| `templates.{id}.slots` | `{ ref \| type }` | Same | Same |
| `templates.{id}.zones` | Widget arrays | Same | Same |
| Slots + zones coexistence | Allowed | R13: MUST NOT same region | **Stricter** in ADP |

## Route fields

| Field | PraisonAIUI | ADP | Notes |
|-------|-------------|-----|-------|
| `routes[].match` | Glob string | Same | Same |
| `routes[].template` | Template key | Same | Same |
| `routes[].slots` | Optional overrides | Same | Same |
| Runtime resolution | Compiled but not used | R28: MUST resolve at runtime | **Gap fix required** |

## Migration example

### Before (PraisonAIUI)

```yaml
schemaVersion: 1

site:
  title: "My Docs"
  theme:
    preset: zinc

templates:
  docs:
    layout: TwoColumnLayout
    slots:
      main: { type: DocContent }

routes:
  - match: "/docs/**"
    template: docs
```

### After (ADP)

```yaml
schemaVersion: 1
apiVersion: adp.io/v1alpha1
kind: Application

metadata:
  name: my-docs
  version: "1.0.0"

spec:
  site:
    title: "My Docs"

  theme:
    preset: zinc

  templates:
    docs:
      layout: TwoColumnLayout
      slots:
        main: { type: DocContent }

  routes:
    - match: "/docs/**"
      template: docs
```

## Breaking vs compatible changes

| Change | Breaking? | Mitigation |
|--------|-----------|------------|
| Add envelope fields | No | Compiler accepts flat or enveloped |
| Promote theme to spec | No | Compiler reads both locations |
| Catalog validation | Soft break | Warn first, error in strict mode |
| Route runtime resolution | No (fix) | Frontend change, not config change |
| Slots+zones coexistence rule | Soft break | Warn on R13 violation |
| Remove chat/dashboard from ADP | No | Separate kinds in future |

## Compiler compatibility strategy

During v1alpha1 transition, PraisonAIUI compiler SHOULD:

1. Accept flat `aiui.template.yaml` (current format)
2. Accept enveloped ADP `*.application.yaml` (new format)
3. Normalise both to same internal `Config` model
4. Emit identical runtime manifests regardless of input format
5. Log ADP validation warnings without failing build (until strict mode flag)
