# OpenAPI

> Point the docs site at an OpenAPI spec; aiui build loads, bundles and checks it.

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
the [API field components](https://ui.praison.ai/docs/features/writing-docs.md#api-fields): the endpoint bar with [Try it](#try-it), server URL,
deprecation notice, path / query / header / cookie parameters, request body,
each response ([schemas](#schemas) with `oneOf`/`anyOf` tabs, constraints and conditional
requirements), [request examples](#request-examples) in several languages, [response examples](#response-examples), callbacks and a link to the spec. They publish like hand-written pages: agent `.md`, `llms.txt`,
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
(`get-pets-id`). `x-aiui: {href: /reference/pets}` sets the whole path (kebab-cased, `..`
dropped; see [page settings](#page-settings-in-the-spec)). A slug already taken (by a hand-written page or another endpoint) gets `-2`, `-3`.
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

### Request examples

The side column shows the request as code, one tab per language: cURL, Python and
JavaScript by default. A pick is remembered, so every endpoint page opens on the reader's
language. Each sample is built at build time from the spec: the server URL (variables set to
their defaults; a relative or missing server is joined to `https://api.example.com`), path
parameters (their example, else a `{name}` placeholder), required query, header and cookie
parameters and any with an example, the first security requirement as a placeholder
(`Bearer <token>`, `Basic <encoded-value>`, an API key `<api-key>` in its header, query or
cookie) and the body (its first example, else one made from the schema without `readOnly`
fields). JSON, form-urlencoded and plain-text bodies work in every language; `multipart/form-data`
in cURL, Python and JavaScript (a `format: binary` field is sent as a file).

```yaml
api:
  openapi: openapi.yaml
  examples:
    languages: [curl, python, go]   # or all; [] shows only the spec's own samples
```

Languages: `curl`, `python`, `javascript`, `go`, `java`, `ruby`, `php`, `csharp`, `rust`,
`swift` (also `shell`, `node`, `js`, `py`, `c#`, `dotnet`, ...). `aiui validate` names an
unknown one.

Your own samples, from an SDK say, go in the operation's `x-codeSamples` (or `x-code-samples`).
They come first, in their order; one in a generated language replaces that sample, any other
language adds a tab. `label` is the tab title (default: the language's name).

```yaml
x-codeSamples:
  - {lang: python, label: Python SDK, source: "client.pets.list(limit=10)"}
  - {lang: kotlin, source: "client.pets().list(10)"}
```

The agent `.md` export, `llms-full.txt` and the page source keep every sample as a fence.

### Try it

Under the title, every endpoint page has an endpoint bar (method, path, copy) and **Try it**: a
request form with a server menu (operation, path, then spec `servers`) and an input per server
variable, an input per path, query, header and cookie parameter (`enum` and boolean as menus,
arrays comma-separated, empty `required` ones named before sending) and the body to edit
(`multipart/form-data` as a JSON object of its fields). Inputs start with `x-default`, else the
example (`example`, `examples`, `default`, `const`, first `enum` value); the body with its first
example, else one made from the schema. Beside them: the curl command for exactly what will be
sent, live, with copy, and after Send the status, time, size, headers and body (JSON
pretty-printed). A relative or missing server URL means the site the docs are served from.

```yaml
api:
  playground:
    display: interactive   # simple: the bar without Try it; none: method and path as plain text;
                           # auth: Try it only for readers signed in to the aiui server
  examples:
    prefill: true          # false: inputs start empty, the example as placeholder
```

With `auth`, the bar asks `GET /api/auth/status` once per page load and shows Try it only when it
answers `authenticated: true` (an `aiui serve` or `create_app` site whose reader is signed in;
without sign-in configured, every reader counts as signed in). On a static host it acts like
`simple`.

Webhooks have no Try it. Front matter `playground:` (same values) sets the display of one
[`openapi:` or `api:` page](#endpoints-on-your-own-pages), `x-aiui` `metadata.playground` of
one generated page.

The request goes straight from the reader's browser to your API: no proxy, so it works on a
static host and keys never pass through a third party, and the browser's CORS rules apply. The
API must allow the docs site's origin (`Access-Control-Allow-Origin`; for custom headers or a
JSON body, a preflight `OPTIONS` with `Access-Control-Allow-Headers`). A blocked request says it
"did not reach the API" (the curl command still works in a terminal). Response headers other
than the CORS-safelisted ones show only when listed in `Access-Control-Expose-Headers`; a cookie
parameter goes only into the curl command (a browser sends just the cookies it holds).

`aiui build` writes each page's form data to `openapi/try/<page>.json`; the form is a lazy chunk
loaded on the first hover, focus or click of Try it. In the page source the bar is
`<ApiPlayground method="GET" path="/pets" src="/openapi/try/....json" />` (without `src`, the bar
alone, usable on a hand-written page); the agent `.md` keeps `` `GET` `/pets` ``.

#### Authentication

An operation's `security` (else the spec's) becomes an **Authorization** section on its page (a
field per scheme, required when every alternative needs it, OAuth2 scopes listed) and inputs in
Try it: `apiKey` in a header, query or cookie, `http` `bearer` (and any other scheme name),
`http` `basic` (username and password, base64-encoded for you), `oauth2` and `openIdConnect` (paste
an access token; sent as `Bearer`). With several alternatives a menu picks one (`{}` in the list
adds "None"); `security: []` turns it off; `mutualTLS` is left out (a browser cannot send it).
A scheme's `x-default` prefills its input.

```yaml
components:
  securitySchemes:
    token: {type: http, scheme: bearer, bearerFormat: JWT, x-default: test-token}
    key: {type: apiKey, in: query, name: api_key}
security: [{token: []}, {key: []}]
```

Values are kept in the browser tab's `sessionStorage` per docs site (gone when the tab closes,
never `localStorage`) and sent only with the request itself. The curl command shows them as
`********` until **Show values**; the request examples on the page keep placeholders
(`Bearer <token>`).

#### Files and streams

- `multipart/form-data`: a file input per part with `format: binary` / `byte` or a
  `contentMediaType`; the chosen file replaces that field (curl `--form 'photo=@cat.png'`).
- A body that is a file (`application/octet-stream`, `image/*`, `audio/*`, `video/*`, PDF, or a
  `format: binary` schema): one file input, sent as the body (curl `--data-binary`).
- A JSON field with `format: byte` or `contentEncoding: base64` / `base64url`: a file input
  that writes the file's encoding into the body.
- A `text/event-stream`, NDJSON or JSON Lines response is shown as it arrives: server-sent events
  as a list (event name, id, data with JSON pretty-printed), other streams as text. **Stop**
  ends it; reading stops at 10 MB; a broken connection says "Stream interrupted."

**(planned)**: method and `kind: badge` pills in the
sidebar, a choice picker for `any` fields, `api.optional`, and showing image, audio and video responses inline.

## Endpoints on your own pages

Name an operation in a page's front matter and the page shows it: the endpoint bar and Try it
under your `#` title, your Markdown, then the generated parameters, body, responses and
request and response examples.

```markdown
---
openapi: "GET /users"
---

# Listing users

Paging works like this...
```

- `"GET /users"` looks in every spec the config names; `"admin.yaml POST /users"` in that file
  (its name is enough; a file only pages name is loaded, relative to `aiui.yaml`, and published);
  `"webhook user-created"` names a webhook.
- `title`, `description` and search keywords come from the operation unless the page sets them;
  the spec's description shows only when the page has no text of its own.
- The operation gets no generated page of its own: your page replaces it.
- `playground: simple` (or `none`) on the page changes its Try it display.

### Pages without a spec

`api:` makes an endpoint page from the page alone: the bar, and Try it with an input per
`<ParamField>` (`placeholder`, else `default`, as the example), per `{param}` in the path, and a
JSON body of the `body` fields.

```markdown
---
api: "POST /v1/users"
---

<ParamField body="name" type="string" placeholder="Ada" required>The name.</ParamField>
```

```yaml
api:
  server: https://api.example.com     # or a list: a menu in Try it
  auth: {method: key, name: X-API-Key}  # bearer (default), basic, key or none: Try it's Authorization inputs
```

### Endpoints in navigation

A `pages:` entry can be an operation: `"GET /users"`, `"admin.yaml POST /users"` or
`"webhook user-created"`. Without a file it comes from the nearest group or tab with `openapi`,
else `api.openapi`, else any spec. When a spec's own group (or `api.openapi`) lists operations,
only the listed ones get pages, each where it is listed, and no tag groups are added. An entry
for an operation a page shows (`openapi:` front matter) links that page.

```yaml
navigation:
  groups:
    - group: Users
      openapi: openapi.yaml
      pages: [guides/users, "GET /users", "POST /users", "webhook user-created"]
```

`aiui validate` names a reference that matches no operation (7012).

### Page settings in the spec

An operation's `x-aiui` sets its generated page: `metadata` is front matter (`title`,
`sidebarTitle`, `description`, `playground`, `tag`, `og:*`, ...), `content` is Markdown shown
above the description (any docs component works) and `href` the page URL. The `x-mint` key
other docs tools write is read too; `x-aiui` wins where both set a value.

```yaml
x-aiui:
  metadata: {title: Create a user, sidebarTitle: Create, tag: NEW}
  content: "<Note>Needs an admin key.</Note>"
```

From Python, `praisonaiui.compiler.openapi.load_spec("openapi.yaml")` returns an `ApiSpec`
(`ok`, `issues`, `document`, `operations`, `dereference(node)`).

## Related pages

- [API Reference page and OpenAPI document](https://ui.praison.ai/docs/features/api-reference.md)
- [PraisonAIUI → ADP Field Mapping](https://ui.praison.ai/docs/protocols/adp/aiui-mapping.md)
- [Sessions API Reference](https://ui.praison.ai/docs/api/sessions.md)
