---
title: OpenAPI
description: Point the docs site at an OpenAPI spec; aiui build loads, bundles and checks it.
---

# OpenAPI

Name your spec in `aiui.yaml`; `aiui validate` and `aiui build` load and check it.

```yaml
api:
  openapi: openapi.yaml   # or https://api.example.com/openapi.json
```

- A file (relative to `aiui.yaml`) or an `http(s)` URL; `http://localhost:8080/openapi.json` works with no flag.
- JSON or YAML, OpenAPI 3.0, 3.1 and 3.2. Swagger 2.0 is an error.
- A `$ref` to another file (`paths/pets.yaml`, `../common.yaml#/components/schemas/Error`)
  resolves relative to the file naming it, URLs too, and is bundled in: no pre-bundling.
  Recursive schemas, across files too, stay finite.
- 3.0 specs are normalised to 3.1 rules for rendering (`nullable`, boolean
  `exclusiveMinimum`/`exclusiveMaximum`, schema `example`); the published file keeps your version.

`openapi` also goes on a navigation tab or group: a path or URL, `{source, directory}` or a
list of either. A spec named twice loads once. `directory`: where its endpoint pages go **(planned)**.

```yaml
navigation: {tabs: [{tab: API, openapi: [v2.yaml, {source: admin.yaml, directory: api/admin}]}]}
```

## Checks

Each problem names its file, line and JSON pointer (`openapi.yaml:42: $ref '#/x' does not
resolve (at #/components/schemas/Pet/properties/owner)`). Errors fail `validate` and
`build`: an unreadable file or URL, YAML/JSON syntax, a missing or unsupported `openapi`
version, `info` without `title`/`version`, a `$ref` that does not resolve, a path not
starting with `/`, a duplicate `operationId`. Warning: a `{param}` with no path parameter.

## Output

`aiui build` writes `openapi/<slug>.json` (the spec bundled into one file; `<slug>`: file name,
`-2` on a clash) and `openapi/index.json` (`{"specs": [{source, file, title, openapi, version, operations}]}`).
Endpoint pages (honouring `x-hidden`, `x-excluded`, `deprecated`), schema rendering,
code samples and a Try-it playground build on this **(planned)**.

From Python, `praisonaiui.compiler.openapi.load_spec("openapi.yaml")` returns an `ApiSpec`
(`ok`, `issues`, `document`, `operations`, `dereference(node)`).
