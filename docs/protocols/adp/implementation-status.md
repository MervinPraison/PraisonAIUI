# ADP Implementation Status

Honest status of ADP v1alpha1 features against the PraisonAIUI reference implementation.

**Last updated:** August 2026

| Feature | Spec reference | Status | Notes |
|---------|----------------|--------|-------|
| JSON Schema validation in CLI | spec §6 | Planned | Schemas published; no `aiui validate --adp` yet |
| ADP envelope parsing (`apiVersion/kind/spec`) | spec §3 | Planned | Flat `aiui.template.yaml` works today |
| Component catalog validation (R6–R7) | spec §5 | Planned | Catalog split to `catalogs/default.catalog.json` |
| `$yaml:` / `$json:` file includes | spec §7 | Planned | Not implemented in compiler |
| Strict mode unknown-field rejection (R4) | validation-rules R4 | Planned | Pydantic allows extra fields on some models |
| Route-driven template resolution (R28) | validation-rules R28 | Gap | Frontend hardcodes `templates.docs` |
| Sidebar nav mode (R29) | validation-rules R29 | Gap | Filesystem-only sidebar today |
| Catalog ARIA roles at render (R30) | validation-rules R30 | Gap | No catalog-driven a11y in renderer |
| `navigation.tabs` rendering | spec §4.3 | Gap | Compiled to manifest but not consumed by React |
| DTCG token file validation (R26) | validation-rules R26 | Planned | Preset shorthand works via Tailwind |
| Published `$schema` URLs | README | Partial | Local schemas only; `https://adp.io/` is placeholder |

## What works today

- Flat `aiui.template.yaml` → Pydantic `Config` → compiler → JSON manifests → React SPA
- Components, templates, routes, theme presets, content scanning
- ADP example manifests validate against `application.schema.json` (standalone)
- Unit tests in `tests/unit/test_adp_schemas.py`

## Migration path

1. Add envelope normalisation layer before `Config.model_validate`
2. Wire `route-manifest.json` into frontend routing (R28)
3. Honour `navigation.tabs` and `content.docs.nav.mode` (R29)
4. Add `aiui validate --schema adp` using published JSON Schema
5. Apply catalog ARIA hints at render time (R30)

See [aiui-mapping.md](./aiui-mapping.md) for field-level compatibility.
