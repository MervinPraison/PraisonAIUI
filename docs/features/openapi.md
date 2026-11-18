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
list of either. A spec named twice loads once. `directory`: the URL folder of its endpoint pages
(default `api-reference`).

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

`aiui build` writes `openapi/<slug>.json` (the spec bundled into one file, `x-excluded`
operations removed; `<slug>`: file name, `-2` on a clash), `openapi/index.json`
(`{"specs": [{source, file, title, openapi, version, operations}]}`), an "OpenAPI specs"
section in `llms.txt` and an [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) API catalog at
`/.well-known/api-catalog` (each API's base URL, spec and first endpoint page).

## Endpoint pages

Every operation and 3.1 webhook gets a docs page, generated at build time as Markdown with
the [API field components](writing-docs.md#api-fields): method and path, server URL,
deprecation notice, path / query / header / cookie parameters, request body,
each response ([schemas](#schemas) with `oneOf`/`anyOf` tabs, constraints and conditional
requirements), [response examples](#response-examples), callbacks and a link to the spec. They publish like hand-written pages: agent `.md`, `llms.txt`,
`llms-full.txt`, sitemap and site search (which also matches `METHOD /path`, the
`operationId` and every parameter and body field name).

| Spec | Result |
|---|---|
| `api.openapi` only | an "API Reference" group at the end of the sidebar |
| `openapi` on a tab | its tag groups join the tab ("API Reference" for untagged operations) |
| `openapi` on a group | its tag groups go inside that group |
| `tags` | one sidebar group per operation's first tag; label: `x-group`, `x-displayName`, `summary`, then `name`; 3.2 `parent` nests groups; a tag with another `kind` (`badge`) makes no group |
| untagged webhook | a "Webhooks" group |
| `x-hidden: true` | page built and routable, not in the sidebar or indexes |
| `x-excluded: true` | no page, and removed from the published spec |
| `deprecated: true` | a deprecation notice |

URL: `/docs/<directory>/<tag name>/<slug>`, the slug from the `operationId` (`listPets` ->
`list-pets`, so rewording a summary keeps the URL), else the summary, else method and path
(`get-pets-id`). `x-mint: {href: /reference/pets}` sets the whole path (kebab-cased, `..`
dropped). A slug already taken (by a hand-written page or another endpoint) gets `-2`, `-3`.
The title is the `summary` as written, else the `operationId` in words. `aiui validate`
warns about a duplicate tag, an unknown `parent` and a `parent` cycle.

### Schemas

Each field shows what the schema says, at build time, in the page Markdown (so agents and
search see it too):

| Schema | On the page |
|---|---|
| `$ref`, `allOf` | followed and merged into one field list |
| `oneOf` / `anyOf` | tabs, one per choice, titled by its `title`, else its `$ref` name, else its type, else "Option n"; at the top of a body or response too |
| `nullable: true`, `type: [x, "null"]`, `anyOf: [X, {type: "null"}]` | `x \| null` in the type; the field still expands to X's properties |
| `object[]`, nested objects | properties nested under "Show properties", a recursive schema stops one level down |
| `enum`, `const` | "Available options: `card`, `bank`", "Allowed value: `card`" |
| `minimum`/`maximum` (exclusive too), `minLength`/`maxLength`, `minItems`/`maxItems`, `pattern` | "Required range: `1 <= x < 100`", "Required string length: `16 - 19`", "Required array length: `>= 1` elements", "Pattern: `^[0-9]+$`" |
| `examples` / `example` on a field | "Example: `5`" (short values) |
| `additionalProperties`, `not` | "Additional properties: `string`", "Must not match: `integer`" |
| `if`/`then`/`else`, `dependentRequired`, `dependentSchemas` (also inside `allOf`) | a pill on each affected field: "required if method = card", "required unless method = card", "required if owner is set"; an `if` that tests more than sibling `const` / `enum` / `required` shows "conditionally required" |

```yaml
api:
  openapi: openapi.yaml
  params: {expanded: all}   # nested properties start open (default: closed)
```

### Response examples

The side column's response example has one tab per status code, content type (when a response
has several) and named example (its `summary`, else its key). This gives the tabs
`200 · application/json · A small cat`, `200 · application/json · big` and `200 · application/xml`:

```yaml
responses:
  "200":
    content:
      application/json:
        examples:
          small: {summary: A small cat, value: {name: Tom}}
          big: {value: {name: Garfield}}
      application/xml: {example: "<cat/>"}
```

Per content type: the `examples` map (`value`, 3.2 `dataValue` / `serializedValue`, or the
`externalValue` URL), else `example`, else for JSON an example built from the schema. JSON is
pretty-printed (a JSON string too); XML, HTML, YAML and CSV are highlighted; other types are text.

**(planned)**: an Authorization section, method and `kind: badge` pills in the sidebar, request
examples (cURL and more languages), a Try-it playground (choice picker for `any` fields,
`api.optional`, and showing image, audio and video responses inline).

From Python, `praisonaiui.compiler.openapi.load_spec("openapi.yaml")` returns an `ApiSpec`
(`ok`, `issues`, `document`, `operations`, `dereference(node)`).
