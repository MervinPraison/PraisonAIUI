# PraisonAIUI → ADP Field Mapping

Field-by-field mapping from current `aiui.template.yaml` (`Config` model in `src/praisonaiui/schema/models.py`) to ADP `Application` spec.

**Compatibility:** Flat `aiui.template.yaml` files work with the PraisonAIUI compiler today. ADP envelope format is **planned** — see [implementation-status.md](./implementation-status.md).

---

## Envelope (new in ADP)

| ADP field | PraisonAIUI today | Status | Change |
|-----------|-------------------|--------|--------|
| `schemaVersion: 1` | `schemaVersion: 1` | Implemented | Compatible |
| `apiVersion: adp.io/v1alpha1` | Not present | Planned | Add when envelope parser lands |
| `kind: Application` | Not present | Planned | Add when envelope parser lands |
| `metadata.name` | Not present | Planned | Derive from `site.title` slug |
| `metadata.version` | Not present | Planned | Recommend SemVer |

## Top-level → spec wrapper

| PraisonAIUI (flat) | ADP (envelope) | Status | Change |
|--------------------|----------------|--------|--------|
| `site:` | `spec.site:` | Planned | Wrap under `spec` |
| `site.theme` | `spec.theme:` | Planned | Promote theme to spec level |
| `navigation:` | `spec.navigation:` | Partial | Tabs compiled; not rendered |
| `navbar:` | `spec.navbar:` | Partial | Compiled; not rendered |
| `footer:` | `spec.footer:` | Partial | Compiled; not rendered |
| `search:` | `spec.search:` | Partial | Compiled; not rendered |
| `content:` | `spec.content:` | Implemented | Same |
| `components:` | `spec.components:` | Implemented | Same |
| `templates:` | `spec.templates:` | Implemented | Same |
| `routes:` | `spec.routes:` | Partial | Compiled; routing not honoured |
| `dependencies:` | `spec.dependencies:` | Implemented | Same |
| `logo:` (top-level) | Future ADP field | Implemented | Top-level on `Config`, not under `site` |
| `style:`, `chat:`, `auth:`, `dashboard:` | Not in ADP v1alpha1 | N/A | Separate kinds in future |

## Navigation fields

| Field | PraisonAIUI | ADP | Status | Notes |
|-------|-------------|-----|--------|-------|
| `navigation.tabs[]` | Mintlify-style tabs | `spec.navigation.tabs` | Partial | Compiled, not rendered |
| `content.docs.nav.mode` | `NavConfig.mode` | Same | Gap | Defined but unused by compiler |
| Top-level `navigation.mode` | Not present | Removed from ADP | N/A | Use `content.docs.nav.mode` instead |

## Theme fields

| Field | PraisonAIUI | ADP | Status |
|-------|-------------|-----|--------|
| `site.theme.preset` | Implemented | `spec.theme.preset` | Planned (envelope) |
| `site.theme.radius` | Implemented | Same | Same |
| `site.theme.darkMode` | Implemented | Same | Same |
| `theme.tokens` | Not present | DTCG file ref | Planned |

## Component fields

| Field | PraisonAIUI | ADP | Status |
|-------|-------------|-----|--------|
| `components.{id}.type` | String literal | Catalog allowlist | Planned (R6) |
| `components.{id}.props` | `dict[str, Any]` | Catalog schema | Planned (R7) |

## Template fields

| Field | PraisonAIUI | ADP | Status |
|-------|-------------|-----|--------|
| `templates.{id}.layout` | String | Catalog enum | Same values |
| `templates.{id}.slots` | `{ ref \| type }` | Same | Same |
| `templates.{id}.zones` | Widget arrays | Same | Same |
| Slots + zones on same template | Allowed | R13: one or the other | Stricter in ADP |

## Route fields

| Field | PraisonAIUI | ADP | Status |
|-------|-------------|-----|--------|
| `routes[].match` | Glob string | Same | Same |
| `routes[].template` | Template key | Same | Same |
| Runtime route resolution | Not implemented | R28 required | Gap |

## Migration example

### Today (PraisonAIUI)

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

### Target (ADP)

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
  content:
    docs:
      dir: "./docs"
```

## Breaking vs compatible changes

| Change | Breaking? | Mitigation |
|--------|-----------|------------|
| Add envelope fields | No | Envelope parser normalises to flat `Config` |
| Catalog validation | Soft break | Warn first, error in strict mode |
| Route runtime resolution | No (fix) | Frontend change |
| R13 slots/zones exclusivity | Soft break | Warn on violation |
| Remove chat/dashboard from ADP | No | Separate kinds in future |
