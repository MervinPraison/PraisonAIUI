# ADP Validation Rules

Cross-reference validation rules for Application Design Protocol manifests. These constraints cannot be expressed in JSON Schema alone and MUST be enforced by conforming compilers.

Rules use RFC 2119 keywords: MUST, MUST NOT, SHOULD, MAY.

Inspired by AWP validation rules R1–R32 pattern.

---

## Envelope rules

| Rule | Level | Description |
|------|-------|-------------|
| **R1** | MUST | `schemaVersion` MUST equal `1` for `apiVersion: adp.io/v1alpha1` |
| **R2** | MUST | `kind` MUST be `Application` for root manifests |
| **R3** | MUST | `metadata.name` MUST be unique within a deployment scope |
| **R4** | MUST NOT | Unknown top-level fields outside `x-adp-*` namespace in strict mode |

## Component rules

| Rule | Level | Description |
|------|-------|-------------|
| **R5** | MUST | Every `spec.components` entry MUST have a unique ID |
| **R6** | MUST | Every component `type` MUST exist in the published component catalog |
| **R7** | MUST | Component `props` MUST validate against catalog JSON Schema for that type |
| **R8** | MUST NOT | A component ID be referenced by `ref:` if it does not exist in `spec.components` |
| **R9** | SHOULD | Unused components (defined but never referenced) SHOULD emit a warning |

## Template rules

| Rule | Level | Description |
|------|-------|-------------|
| **R10** | MUST | Every `spec.templates` entry MUST declare a valid `layout` from the catalog |
| **R11** | MUST | Slot names in `templates.*.slots` MUST be valid for the declared layout |
| **R12** | MUST | Zone names in `templates.*.zones` MUST be valid for `FlexibleLayout` |
| **R13** | MUST NOT | A template declare both `slots` and `zones` for the same region |
| **R14** | MUST | Inline slot `{ type: X }` types MUST exist in the component catalog |
| **R15** | MUST | Slot `{ ref: id }` MUST resolve to a component in `spec.components` |

## Route rules

| Rule | Level | Description |
|------|-------|-------------|
| **R16** | MUST | Every route `template` MUST reference a key in `spec.templates` |
| **R17** | MUST | Routes MUST be ordered most-specific-first (longer/more precise patterns before wildcards) |
| **R18** | MUST | Route slot overrides MUST use valid slot names for the target template's layout |
| **R19** | SHOULD | At least one route SHOULD match the site root or docs base path |

## Content rules

| Rule | Level | Description |
|------|-------|-------------|
| **R20** | MUST | If `content.docs.dir` is declared, the directory MUST exist at compile time |
| **R21** | MUST | If `navigation.mode` is `manual`, `navigation.tabs` MUST be non-empty |
| **R22** | SHOULD | If `navigation.mode` is `auto`, a content source MUST be declared |

## File include rules

| Rule | Level | Description |
|------|-------|-------------|
| **R23** | MUST NOT | `$yaml:`, `$json:`, or `$text:` paths traverse outside the project root |
| **R24** | MUST | Included files MUST parse as valid YAML/JSON/text respectively |
| **R25** | MUST NOT | Circular file includes (A includes B includes A) |

## Theme rules

| Rule | Level | Description |
|------|-------|-------------|
| **R26** | MUST | If `theme.tokens` is declared, the referenced file MUST exist and validate against DTCG 2025.10 |
| **R27** | MUST NOT | Both `theme.preset` and `theme.tokens` be declared simultaneously |

## Renderer rules (runtime)

| Rule | Level | Description |
|------|-------|-------------|
| **R28** | MUST | Renderers MUST resolve the active template from `route-manifest.json` at runtime |
| **R29** | MUST | Renderers MUST honour `navigation.mode` when building sidebar |
| **R30** | MUST | Renderers MUST apply ARIA roles from catalog for each rendered component |

---

## Validation pipeline order

```
1. Parse YAML/JSON
2. Resolve $yaml/$json/$text includes (R23–R25)
3. JSON Schema validate (application.schema.json)
4. Cross-ref rules R1–R27
5. Component props validate against catalog (R6–R7)
6. Emit runtime manifests
7. Runtime conformance R28–R30 (renderer responsibility)
```

## Error format

Validation failures MUST report:

```json
{
  "rule": "R8",
  "path": "spec.templates.docs.slots.header.ref",
  "message": "Component ref 'missing_header' not found in spec.components",
  "severity": "error"
}
```

Warnings (R9) use `"severity": "warning"`.
