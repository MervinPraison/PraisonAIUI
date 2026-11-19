# Changelog

## Unreleased

### Breaking changes

- **`aiui run app.py` opens the React app shell.** A plain chat app (a
  `@reply`, no `--style`, no `set_style()`, no YAML `style:`) now runs in
  `style: app` with the new `chat` layout: the Chat and Canvas frame without
  the canvas. `--style chat` (or `aiui.set_style("chat")`) keeps the classic
  chat. Apps that auto-detect as `agents` or `dashboard` are unchanged, and
  `create_app()` and PraisonAI keep Chat and Canvas as the app shell default.
  See [Layouts](docs/features/layouts.md).

- **Theme variables are complete colours, not bare HSL triples.** shadcn
  variables such as `--primary` used to hold `221 83% 53%`, which the
  stylesheet wrapped in `hsl()`. They now hold any CSS colour:
  `--primary: hsl(221 83% 53%)`, or better, set the seed
  (`--seed-accent: hsl(221 83% 53%)`) and every derived colour follows in both
  modes. `aiui validate` warns (code 5001) when `site.custom_css` sets one of
  these variables to a bare triple. See
  [React app shell → Breaking change](docs/features/react-shell.md#breaking-change-bare-hsl-triples).
- **Cross-origin access is opt-in.** The server no longer sends
  `Access-Control-Allow-Origin: *`, and it refuses cross-site WebSocket
  handshakes and cross-site `POST`/`PUT`/`PATCH`/`DELETE` requests. Set
  `AIUI_ALLOWED_ORIGINS` (comma-separated, or `*`) for a frontend served from
  another origin. See [Deployment → Cross-site requests](docs/features/deployment.md#cross-site-requests).
- **Local servers check the `Host` header.** A server reached on a loopback or
  private address answers only IP addresses, `localhost`, `*.local`, its own
  hostname and the names in `AIUI_ALLOWED_HOSTS` (DNS rebinding guard). A
  reverse proxy on the same machine that forwards a public host name to a
  loopback-bound server (nginx → `127.0.0.1:8082` with
  `proxy_set_header Host $host`) must now set `AIUI_ALLOWED_HOSTS` to that
  name. See [Deployment → Host names](docs/features/deployment.md#host-names-dns-rebinding).
- **Self-signup is off under `require_auth`.** `POST /register` needs a session
  unless `create_app(allow_signup=True)` or YAML `auth.allowSignup` is set.
- **App shell: full-bleed comes from `page.layout`.** The shell no longer keeps
  a list of page ids that fill the viewport. An app that registers its own
  `explorer` (or any) legacy page that needs the full viewport must pass
  `layout='full-bleed'`.
- **The frontend package is private.** `src/frontend/package.json` is no longer
  publishable and `build:lib` is removed; import UI components from the
  in-repo barrel `src/frontend/src/components/index.ts`, and write app-shell
  plugins against `@aiui/sdk`.

### Security

- `AUTH_ENFORCE=true` gates every route and every WebSocket, deny by default
  (it used to gate `/api/*` only, leaving `/sessions`, `/run`, `/v1/*`, `/agui`
  and others open).
- URL-token mode (`AIUI_REQUIRE_TOKEN`) and `require_auth=True` / YAML
  `auth.requireAuth` now gate WebSocket handshakes; `require_auth` no longer
  exempts every path.
- Under `require_auth=True` / YAML `auth.requireAuth`, `POST /register` is
  closed by default: it registers only the first user, or a signed-in user
  adding an account, unless YAML `auth.allowSignup: true` opens sign-up to
  anyone. It used to give any visitor a token that passed the auth check.
  See [Deployment → Self-registration](docs/features/deployment.md#self-registration-under-requireauth).
- WebSocket clients exchange the stored key for a single-use ticket
  (`POST /api/auth/ws-ticket`); `?token=` values are redacted from the logs.
- Only the connection that started a turn in a session may stop it or answer
  its prompts, over WebSocket and over `POST /api/chat/abort`.
- Plugin HTTP routes (`/api/plugins/<name>/*`) follow the same default-deny
  policy as plugin browser code for remote and auth-enforced servers.
- The dashboard's Knowledge, Guardrails, Traces, Security and Telemetry views
  escape the records they show (file names, guardrail descriptions, violation
  messages, span names, agent ids). Markup stored in those records used to run
  in the dashboard. The views' `esc()` helper now escapes quotes too, so it is
  safe inside attribute values.
- Inline JSON in HTML has one escaper, `praisonaiui.utils.json_for_html`, used
  by the app shell, the standalone replay page and built docs sites. The docs
  JSON-LD block, which used to inline page titles unescaped, now uses it too.
- `/dashboard-plugins/<name>/<path>` serves only files inside that plugin's
  folder. A `..` path could reach a sibling folder whose name started with the
  plugin's name.
- **Behaviour change:** the `/api/jobs` proxy no longer forwards aiui's own
  credentials (`Authorization`, cookies, `X-API-Key`, `?token=`) to the jobs
  server, and refuses paths with `.`/`..` segments (400), which could reach
  any path on the upstream host. A jobs server that needs a credential gets
  one from `set_jobs_proxy(url, token=...)`. See
  [PraisonAI package integration](docs/features/praisonai-package-integration.md).
- **Behaviour change:** Video Studio project ids must be one folder name,
  `projectPath` must lie inside the projects folder, and render `out` must be
  a plain file name, so requests cannot write outside the projects folder.
- **Behaviour change:** `POST /api/knowledge/add-file` reads only files in the
  chat attachments folder or a folder listed in `AIUI_KNOWLEDGE_ROOTS`; other
  paths get 400. It used to ingest any file the server could read.
- **Behaviour change:** request bodies are capped. A body over
  `AIUI_MAX_BODY_MB` (default 25 MiB; `0` turns it off) gets 413 before it is
  buffered, and the paths that need no credentials (`/api/auth/login`,
  `/login`, `/register`, `/api/protocol/negotiate`) take at most 64 KiB.
  Anyone could make the server hold an unbounded body in memory through the
  public login routes. Chat attachments over their 10 MB limit are refused
  before the file is read into memory, and a malformed login body gets 400
  instead of 500. See [Deployment → Environment Variables](docs/features/deployment.md#environment-variables).
- **Behaviour change:** under `AUTH_ENFORCE` and `require_auth`, a
  `static_dir` folder is no longer public as a whole. Code, styles, fonts and
  images still are, and pages are served as the app shell without their
  content. Markdown and JSON (a search index) need credentials, as they already
  did in URL-token mode. The React UIs send the stored access token with their
  requests, and the docs app shows the sign-in prompt to a reader who has not
  signed in. `AIUI_PUBLIC_STATIC_DIR=1` restores a public folder. A docs site
  served from `static_dir` with style `docs` now gets its built navigation and
  routes (they used to come back empty). See
  [Deployment → Auth Enforcement](docs/features/deployment.md#auth-enforcement).
- **Behaviour change:** OAuth sign-in returns only to a path on the same
  server (an off-site `return_url` falls back to `/`), and the session token
  arrives in the URL fragment (`#token=`) instead of the query string (`?token=`),
  so it never reaches a server log or a `Referer`. The dashboard reads both.
  The OAuth routes now answer without credentials in every auth mode, so
  sign-in can start under `require_auth`. See
  [Deployment → OAuth sign-in](docs/features/deployment.md#oauth-sign-in).

### New

- **Voice input in the chat.** An app that sets a realtime manager able to
  transcribe (`aiui.set_realtime_manager(OpenAIRealtimeManager())`) gets a
  microphone button in the composer: record, stop, and the text lands in the
  message box to read over and send. Keyboard accessible (Escape discards),
  with clear messages for a blocked or missing microphone; its code loads only
  for such an app. Built on `RealtimeProtocol.transcribe(audio, mime_type)`
  (optional; `OpenAIRealtimeManager` implements it with OpenAI speech to text,
  `transcribe_model=`), `GET /api/realtime/voice` and
  `POST /api/realtime/transcribe`. See
  [Voice input](docs/features/realtime-voice-input.md).
- **Docs sites load less JavaScript.** The chat, agents and playground
  layouts load only for their style, so a docs page's first load is 53.6 KB
  (gzip) smaller: 24 files instead of 33.
- **Docs sidebar icons and a phone breadcrumb.** A nav group's `icon:` (the
  navigation YAML already accepted it but nothing drew it) or a page's
  frontmatter `icon:` shows a line icon before its title; on phones the page
  head reads "Section › Page". ui.praison.ai gives its groups icons. See
  [Navigation → Sidebar Icons](docs/features/navigation.md#sidebar-icons).
- **Docs pages load their text with the page.** `aiui build` writes each
  page's Markdown into its HTML, so the first visit needs no request for it
  (the app reads it once and falls back to fetching).
- **Docs home hero preload.** `aiui build` writes `<link rel="preload" as="image">`
  for the home page's hero (one per colour mode, with a `prefers-color-scheme`
  media query), so the browser finds the image in the HTML instead of waiting
  for the app. See
  [Content sources → Home page](docs/features/content-sources.md).
- **Docs page actions and section links.** Above each docs page, "Copy page"
  copies its Markdown; the menu adds View as Markdown, Open in ChatGPT and
  Open in Claude. Section headings get a link icon that copies the section's
  URL. See [Writing docs pages → Page actions](docs/features/writing-docs.md#page-actions).
- **Docs search finds sections and text**, not only page titles. `aiui build`
  writes `search-index.json` (headings and text per page); the search dialog
  ranks titles, headings and text, shows "Section › Page" with the matched
  words and opens the page at the section. Links with a `#section` now open
  the page scrolled there. See
  [Writing docs pages → Search](docs/features/writing-docs.md#search).
- **Docs components**: `<Note>`, `<Info>`, `<Tip>`, `<Check>`, `<Warning>`,
  `<Danger>`, `<Steps>`/`<Step>`, `<CardGroup>`/`<Card>` (icon, link),
  `<Tabs>`/`<Tab>`, `<Accordion>`/`<AccordionGroup>` and `<Frame>` (caption),
  in the usual MDX tag syntax. Images in docs zoom on click. See
  [Writing docs pages](docs/features/writing-docs.md).
- **Docs code blocks: file names, highlighted lines, code groups.**
  ```` ```python title="app.py" {1,3-4} ```` (or `app.py {2}`, `hl_lines`,
  `highlight`) puts the file name in the block's header and tints the lines;
  `<CodeGroup>` shows several fences as tabs with one copy button. Comments
  in docs code now keep 4.5:1 contrast in light and dark. See
  [Writing docs pages → Code blocks](docs/features/writing-docs.md#code-blocks).
- **Docs page footer**: "Edit this page" (`content.docs.editLink.pattern`
  with `:path`), the date of the page's last commit
  (`content.docs.lastUpdated`, read from git by `aiui build`) and "Was this
  page helpful?" (`content.docs.feedback.issues`; a "No" opens a prefilled
  issue, nothing is stored). ui.praison.ai turns all three on. See
  [Writing docs pages → Page footer](docs/features/writing-docs.md#page-footer).
- **Theme preset `paper`** (the look of the Chat and Canvas screen) and
  `site.theme.mode: light | dark | system` for `aiui build`. A docs site with
  `preset: paper` draws in warm paper, a navy accent, Newsreader titles and
  Source Sans 3 text at 17px on 1.7, from its first paint; ui.praison.ai uses
  it and follows the reader's OS. New page:
  [Writing docs pages](docs/features/writing-docs.md). See
  [Theming → The Paper preset](docs/features/theming.md#the-paper-preset).
- **`aiui.yaml` is the default config file name.** `aiui init` writes
  `aiui.yaml`, and `aiui validate`, `build` and `serve` read it when no
  `--config` is given. `aiui.template.yaml` still works: when it is the only
  one there it is used, with a one-line hint on stderr to rename it; when both
  exist, `aiui.yaml` wins. `aiui dev` accepts either name in each example. See
  [Config file name](docs/concepts/configuration.md#config-file-name).
- App shell: a React Cron page inside the layouts: schedules in words and as
  cron, next and last run, an enabled switch, Run now, and a schedule builder.
- Docs sites: frontmatter `layout: home` on `docs/index.md` draws a hero
  (name, headline, tagline, call-to-action buttons, a light and a dark image)
  and a feature grid above the page, in the VitePress shape. See
  [Content sources → Home page layout](docs/features/content-sources.md#home-page-layout).

- Docs sites: `content.docs.nav.mode: manual` builds the sidebar from the YAML
  tab groups, in the listed order, with nested groups and a frontmatter
  `nav_title` for short sidebar titles; pages it does not list stay built and
  searchable. The default (`auto`, one section per folder) is unchanged. See
  [Navigation](docs/features/navigation.md#a-sidebar-you-list-mode-manual).

- `style: app` (opt-in React shell); see
  [React app shell](docs/features/react-shell.md).
- App shell: Knowledge is a React page inside a layout (ProList): a stat
  strip with the store's status in plain words, search with marked snippets
  and relevance, Add knowledge for text or files (drag and drop, per-file
  progress), a detail panel with Delete; the classic frame keeps the legacy
  view. See [Layouts](docs/features/layouts.md#react-pages-inside-every-layout).
- App shell: built-in sidebar icons and group order come from the manifest
  (`navIcon` on each page, `layout.groups`); `set_dashboard(groups=...)` or
  YAML `dashboard.groups` overrides the group order and folding.
- `@aiui/sdk` exports `getPageId`, `usePageId`, `useThemeMode` and `dismiss`.
- The shell manifest reports `site.feedbackEnabled`, so the chat hides
  feedback buttons when feedback is switched off.
- Docs sites (`style: docs`, `aiui build`) use the PraisonAI Pro design: the
  app shell's colours, type, radii and hairlines, a working search
  (⌘K / Ctrl+K), previous / next links, the YAML footer columns and a phone
  drawer with the section tabs. Frontmatter no longer shows as text, and
  relative links and images resolve against the page's folder.
- The Pro type is self-hosted: Geist and Geist Mono (SIL OFL 1.1, latin
  woff2, about 53 kB) ship in the wheel and load only on Pro pages (the
  layouts and the docs site). No font CDN.
- Publishing controls for `aiui build`, all zero-config: frontmatter
  `hidden: true` (and `hidden: true` on a nav group or tab) keeps a page
  built and reachable by URL but out of the sidebar, pager, search, sitemap
  and `llms*.txt`; `seo.indexing: all` indexes hidden pages too. An optional
  `.aiuiignore` next to `aiui.yaml` adds to `content.docs.exclude`.
  `seo.trailingSlash: true` ends canonicals, `og:url`, sitemap and llms
  links in `/`. `seo.contentSignals` adds a robots.txt `Content-Signal`
  line. A `robots.txt` or `sitemap.xml` next to `aiui.yaml` is published as
  is. See `docs/features/seo.md`.
- OpenAPI specs: `api: {openapi: openapi.yaml}` or `openapi:` on a navigation tab or group
  (path, URL, list or `{source, directory}`; JSON/YAML; 3.0, 3.1, 3.2). Other-file `$ref`s are
  bundled, 3.0 is normalised to 3.1, `aiui validate`/`build` report errors as file:line, and
  `aiui build` writes `openapi/<slug>.json` + `openapi/index.json` ([OpenAPI](docs/features/openapi.md)).
- Docs sites can be published under a path prefix: a GitHub project site
  (`user.github.io/repo`) or `example.com/docs` behind a proxy. `aiui build
  --base-path /docs` or `site.basePath`, else the path of `seo.siteUrl`;
  `--base-path auto` detects a GitHub Pages project site in Actions (and sets
  the site URL for the sitemap). `aiui serve` previews the build under its
  prefix. The app resolves every URL through one helper (`src/lib/url.ts`,
  `<meta name="aiui-base">`), and the bundle's chunks and fonts now load
  relative to the file that names them. A build without a prefix is
  unchanged. See [GitHub Pages](docs/getting-started/github-pages.md).
- Docs component tags work anywhere, as in MDX: one line, list items,
  self-closing, multi-line attributes, indented bodies. An unknown tag keeps
  its text and `aiui build` / `aiui validate` warn with file and line;
  `{/* … */}` comments are hidden; `## Title {#id}` pins an anchor. One table
  (`DOCS_TAGS`, `markdown/docsTags.ts`) defines every docs component.
- Docs code blocks take the usual fence options: multi-word titles, `lines`,
  `wrap`, `expandable`, `nocopy`, `icon=`, `highlight={1-2,5}`, `focus=`,
  and `// [!code ++]` / `[!code --]` / `[!code highlight]` / `[!code focus]`
  comments (with `:N` ranges), which never reach the page or the clipboard.
  `<CodeBlock>` takes the same options as attributes. Flags were shown as
  file names before. Chat code blocks are unchanged. See
  [Writing docs pages](docs/features/writing-docs.md#code-block-options).
- Docs layout components: `<Columns cols>` / `<Column>` (stack on phones);
  card `horizontal`, `img`, `cta`, `arrow`, `color`; step `titleSize`
  (titles join "On this page"), `stepNumber`, `icon`, `id`; accordion
  `description`, `icon`, `id`; tab `icon`, `id`, `defaultTabIndex`,
  `borderBottom`; `<CodeGroup dropdown>` (attributes no longer break a code
  group). Tabs and code groups sync by title across the page and remember
  the reader's pick on later pages (`sync={false}` opts out); "On this page"
  lists only the shown tab's headings; `#id` in the URL opens the tab or
  accordion it names, and the accordion around a linked heading. See
  [Writing docs pages](docs/features/writing-docs.md#columns).
- AI-ready docs: `/docs/<page>.md` is agent-ready Markdown (components as
  plain Markdown, page links as absolute `.md` URLs; the site renders
  `<page>.source.md`); `llms.txt` by nav group, `llms-full.txt` converted, both
  without a site URL too; `markdown.instructions`; `<Visibility for>`; `.mdx`
  in search; `rel="alternate"` links; `Accept: text/markdown` on `aiui serve`.
  See [AI-ready docs](docs/features/ai-ready-docs.md).

- Docs API fields: `<ParamField path|query|body|header>` and
  `<ResponseField name>` rows (type such as `string[]` or `object`,
  `required`, `deprecated`, `default`, `pre` / `post` labels), each with its
  own link (`#param-user_id`, `#response-user-address` for a nested field);
  `<Expandable title defaultOpen>` for nested properties.
  `<RequestExample>` / `<ResponseExample>` (tabs, or `dropdown`) and
  `<Panel>` move to a sticky column in place of "On this page" on wide
  screens and follow the article on phones. See
  [Writing docs pages](docs/features/writing-docs.md#api-fields).

- Docs search is full text and forgiving: every word of a section is indexed
  (the 600-character cap is now 6,000 per section), ranking is BM25 with
  stems, prefixes and one-typo matches, and question words drop out. New
  front matter `keywords` (matched, never shown), `boost` (0.1 to 10; also
  on a navigation group) and `searchable: false`; new `search.prompt` and
  `search.maxResults`. A `?q=` link opens search prefilled, and on sites
  with header tabs chips filter the results by tab. `aiui validate` now
  warns that `search.provider` is ignored. See [Writing docs
  pages](docs/features/writing-docs.md#search).

- **Broken link check.** `aiui docs check-links` finds broken page links,
  `#anchor`s, images, `<Card href>`s and nav entries, prints `file:line` with
  a "did you mean" fix and exits 1 for CI (`--external` checks URLs too).
  `aiui validate --strict` and the new `aiui build --strict` fail on them. See
  [Writing docs pages](docs/features/writing-docs.md#check-links).
- **Sidebar groups.** `navigation.pages` / `groups` list the docs sidebar at
  the root; groups take `root`, `expanded`, `tag` and `directory: card |
  accordion`; groups fold (remembered per reader); `interaction.drilldown`;
  `styling.eyebrows: breadcrumbs` with a `BreadcrumbList`; `nav.sort`,
  `collapsible`, `directory` and `indexFiles` take effect; validate warns about
  unknown nav pages and keys that do nothing. See
  [Navigation](docs/features/navigation.md).
- **API reference pages from OpenAPI.** `aiui build` writes one docs page per
  operation and webhook (parameters, body, responses, callbacks) in the
  sidebar where the spec is named, grouped by tag
  (`x-group`, `x-displayName`, 3.2 `parent`), with `x-hidden` / `x-excluded`;
  they reach `llms.txt`, the agent `.md` export and site search. Specs are
  listed in `llms.txt` and `/.well-known/api-catalog` (RFC 9727). See
  [OpenAPI](docs/features/openapi.md#endpoint-pages).
- **`aiui validate` checks the pages**: front matter, alt text, duplicate pages and titles, heading
  levels, empty pages, accent contrast (7000-7006, 7101) at `file:line`, `--format json`
  ([CLI](docs/api/cli.md#aiui-validate)). **`$ref` splits `aiui.yaml`**; `aiui schema` and the
  `$schema` line `aiui init` writes give editor autocomplete ([Configuration](docs/concepts/configuration.md#split-the-config-with-ref)).
- **Page front matter (common docs keys).** `description` shows under the title
  (and `title` becomes the `#` heading when the body has none);
  `sidebarTitle` (alias of `nav_title`, now in the generated sidebar too);
  `icon` takes an emoji or image URL as well as a lucide name; `tag` badges;
  `deprecated: true`; `mode: wide | center | custom | frame`;
  `hideFooterPagination`; `noAnchor`; `url:` makes the page an external
  sidebar link (no route, sitemap, `llms.txt` or search entry), and nav groups
  take `{label, href}` links; `lastUpdatedDate` and `timestamp: false/true`
  per page; any other scalar key reaches custom JS (`aiui:content-loaded`
  `detail.meta`) and CSS (`data-fm-*` on the article). A shallow clone now
  keeps the date of pages changed inside its history. See [Writing docs
  pages](docs/features/writing-docs.md#front-matter).
- **API schemas and response examples.** Endpoint pages show `oneOf`/`anyOf` as tabs
  (titled by `title` or `$ref` name), nullable types, constraints (ranges, lengths, pattern,
  `const`, examples, `additionalProperties`, `not`) and `if`/`then`/`else`,
  `dependentRequired` and `dependentSchemas` as "required if method = card" pills, and a
  response example tab per status code, content type and named example (`examples` with
  `summary`). `api.params.expanded: all` opens nested properties. Enum options no longer
  show JSON quotes. See [OpenAPI](docs/features/openapi.md#schemas).
- **More docs components**: `<Callout icon color>` (any hex or a theme token), inline `<Badge>`
  and `<Tooltip>`, `<Frame hint caption>` in Markdown, `<Tree>` from a plain Markdown list (or
  `<Tree.Folder>` / `<Tree.File>`, arrow keys, `highlight`), `<Prompt>` with Copy and Open in
  ChatGPT / Claude / Cursor, `<Tile>`, `<Color>` swatches with light/dark values, and
  `<colgroup><col width>` in HTML tables. See [Writing docs](docs/features/writing-docs.md#more-components).
- **Reusable snippets and `{{variables}}`.** `<Snippet file="install.md" pkg="aiui" />`
  includes `docs/snippets/install.md` with `{pkg}` filled in; snippets nest, and the
  MDX `import X from '/snippets/x.mdx'` + `<X />` form and MkDocs `--8<-- "x.md"`
  work as is. Top-level `variables:` in `aiui.yaml` fills `{{name}}` in pages, code and
  front matter titles. Expanded at build time, so the page, its `.md`, `llms-full.txt`
  and search all see the text; `snippets/` is not published as pages. `aiui validate`
  reports unknown variables (7007) and missing or looping snippets (7008, which fail
  the build). See [Writing docs](docs/features/writing-docs.md#reusable-snippets-and-variables).
- **SEO overrides, site-wide tags and structured data.** Frontmatter sets any
  `og:*`, `twitter:*` or `article:*` tag, `canonical`, `robots` and
  `keywords` for a page, in the built HTML and after client navigation alike.
  `seo.metatags` adds tags to every page (`google-site-verification`, ...)
  and `seo.paths` to the pages under a folder (a `robots: noindex` folder
  also leaves the sitemap, `llms.txt` and search). `twitter:card` is
  `summary_large_image` when there is an image, `og:site_name` is set, and
  the template's `og:type` is replaced instead of repeated. Each page has one
  JSON-LD `@graph`: Organization (`seo.organization`), WebSite with a
  SearchAction, TechArticle and BreadcrumbList. A fallback description no
  longer starts with component or HTML tags. See [SEO](docs/features/seo.md#page-level-overrides).
- **Any lucide icon, emoji or image as a docs icon**: every `icon` (front matter, navigation groups,
  `<Card>`, `<Callout>`, `<Step>`, `<Tab>`, `<Badge>`, …) takes any of lucide's ~1,900 names (old
  names too), an emoji or an image URL, and the new `<Icon icon size color>` tag puts one in a
  sentence. Icons beyond the common few load on demand from 32 small lazy chunks, so no page
  gets heavier; `aiui validate` warns (7009) about a name that is not an icon and suggests the
  nearest. The build ships the name list as `templates/frontend/aiui-icons.json`. See
  [Writing docs](docs/features/writing-docs.md#icons).
- **Videos and richer images in docs pages**: `<iframe>` with a YouTube, Vimeo or Loom URL shows a
  click-to-play poster and loads the provider's privacy-friendly player in a sandboxed frame only
  when pressed (an iframe from any other site is a link); `<video>` plays self-hosted files
  (`autoPlay` always muted and inline, controls for reduced-motion readers). Light/dark image pairs
  (`#gh-dark-mode-only`, `className="dark:hidden"`, `<picture>` with `prefers-color-scheme`) follow
  the site's theme toggle; `noZoom` opts one image out of zoom; the zoom view has Copy image and
  Download. See [Writing docs](docs/features/writing-docs.md#videos).
- **Docs site branding in a few lines**: `logo` and `favicon` take one image or
  `{light, dark}` (a file beside `aiui.yaml` is published for you; the logo swaps live with
  the theme toggle, the favicon follows the browser's scheme), `site.theme.accent` now
  colours a docs site and `accentDark` sets the dark-mode accent (contrast kept),
  `site.theme.background` adds a `gradient`, `grid` or an image (one per mode if you
  like) behind the page, and
  `site.theme.strict` keeps the configured mode with no toggle. A logo `href` on another
  site now works, an image in `site.logo` is the logo, and `aiui validate` warns (7102)
  about a brand image that is not in the project. See
  [Theming](docs/features/theming.md#branding-a-docs-site).
- **Redirects and a configurable not-found page.** `redirects:` maps old URLs to new ones (`:name`
  for one segment, a final `:name*` for the rest). `aiui serve` answers 301 (302 with
  `permanent: false`); `aiui build` writes `_redirects` and a stub page per old URL, and the docs
  app follows wildcard rules on static hosts. `errors.404` sets the not-found heading and Markdown
  text (`redirect: true` sends readers home), and the page suggests the closest pages. `aiui
  validate` reports loops and dead ends (7010) and rules a page hides (7011). See
  [Redirects](docs/features/redirects.md).
- **Request examples on API endpoint pages.** Every generated endpoint page shows the request
  as code in the side column: cURL, Python and JavaScript by default, or any of Go, Java, Ruby,
  PHP, C#, Rust and Swift with `api.examples.languages` (`all` for every one). Samples use the
  spec's server, parameters, auth scheme and body example, are built at build time (no browser
  code) and stay in the agent `.md` export. An operation's `x-codeSamples` / `x-code-samples`
  come first and replace the generated sample in their language. See
  [OpenAPI](docs/features/openapi.md#request-examples).
- **`aiui dev` previews a docs site with live reload**: one command in the folder with
  `aiui.yaml` (or just a `docs/` folder) builds, serves and opens the site, and every save
  rebuilds it and reloads the open tab at the same scroll position. A failed build shows in the
  terminal and over the page while the last good build stays up; `aiui build` output never
  carries the reload script. Options: `--port`, `--host`, `--open/--no-open`, `--config`,
  `--base-path`. The examples dashboard that `aiui dev` used to open is now
  `aiui dev --examples <folder>` (plain `aiui dev` still opens it in a folder with only
  `examples/`). See [Hot Reload](docs/features/hot-reload.md).
- **The server describes its own API.** `GET /api/openapi.json` is an OpenAPI 3.1 document
  built from the live route table: every API route the server answers (core, each enabled
  built-in, plugins), tagged by the feature that owns it, with docstring summaries, typed path
  parameters and the auth each needs; WebSocket routes under `x-websockets`. It follows the auth
  of every `/api` route and leaves out plugins the caller may not use. A feature adds request
  bodies with an optional `openapi()` method (the `/v1` OpenAI-compatible routes have theirs).
  Off with `extensions: {disabled: [builtin.api-reference]}`. See
  [The server's OpenAPI document](docs/features/api-reference.md).
- **API Reference page in the app shell.** `/api-reference` (Control group) lists this
  server's routes by feature from its live OpenAPI document, searches them and sends a request
  to the same server with your session: path parameters, query, a JSON body prefilled from the
  document's example, the response with status and time, and a cURL copy without credentials;
  `?op=<operationId>` links one route. See
  [API Reference page and OpenAPI document](docs/features/api-reference.md).
- **Try it on endpoint pages**: an endpoint bar (method, path, copy) and a Try it form: server
  menu and variables, path / query / header / cookie inputs and a JSON body, prefilled from the
  spec (`x-default` first; `api.examples.prefill`), the live curl command, and the response's
  status, time, size, headers and body. Sent from the browser, no proxy. `api.playground.display:
  interactive | simple | none`. Lazy chunk; data in `openapi/try/<page>.json`. See [OpenAPI](docs/features/openapi.md#try-it).
- **Changelog pages**: `<Update label="2026-11-18" description="v1.2" tags={["API"]}>` entries,
  each an anchored section (in "On this page", search and the page's `.md`) with its label in a
  sticky left column; a tag filter kept in `?tags=`; and with front matter `rss: true` an RSS
  feed at `<page>/rss.xml`, linked from the page's head. See
  [Writing docs → Changelog](docs/features/writing-docs.md#changelog).
- **Endpoints on your own pages and in the sidebar.** Front matter `openapi: "GET /users"` (or
  `"spec.yaml POST /users"`, `"webhook new-user"`) joins that operation to a hand-written page:
  the endpoint bar and Try it under its title, your Markdown, then the generated fields and
  examples; the operation gets no second page. `api: "POST /v1/users"` makes an endpoint page
  without a spec: Try it from the page's `<ParamField>`s, `api.server` and `api.auth`. Navigation
  `pages:` take `"GET /users"` entries: only the listed operations get pages, where listed. An
  operation's `x-aiui` sets its page's front matter (`metadata`), Markdown above the generated
  part (`content`) and URL (`href`). `aiui validate` names an operation no spec has (7012). See
  [OpenAPI](docs/features/openapi.md#endpoints-on-your-own-pages).
- **Docs page feedback that is kept.** "Was this page helpful?" shows under every docs page with
  no config; `aiui serve` / `aiui dev` store each vote and optional comment (guarded, nothing
  readable over HTTP) and `aiui docs feedback` lists them per page or exports CSV / JSON. Also
  `feedback.endpoint` (static hosts), `feedback.code` (a flag per code block), the
  `aiui:docs-feedback` event and `feedback: false`. See [Writing docs](docs/features/writing-docs.md#page-feedback).
- **Docs MCP server.** `aiui serve` and `aiui dev` answer the Model Context Protocol at `/mcp`
  (Streamable HTTP, read-only, no extra dependency): `search_docs` (ranked like the search
  dialog), `read_page` (a page's agent-ready Markdown) and `list_pages`. Agents find it through
  `/.well-known/mcp` (a server card) and a section in `llms.txt`; the page menu gains **Copy MCP
  server URL**, **Connect to Cursor** and **Connect to VS Code**. Host and Origin are checked
  (DNS rebinding). On by default; `content.docs.mcp: false` turns it off. A static host serves
  none of it. See [AI-ready docs](docs/features/ai-ready-docs.md#mcp-server).
- **A social card for every docs page.** With Pillow installed (`pip install pillow`), `aiui build`
  draws a 1200x630 PNG per page (title, sidebar group, description, site name and logo, theme
  accent and colour mode) at `/og/<route>.png` and sets it as the page's `og:image`,
  `twitter:image` and large Twitter card, in the built HTML and on client navigation. Cards are
  cached by content, so rebuilds only draw changed pages. A page's own `og:image` wins;
  `seo.ogImages: false` keeps `seo.defaultImage`. Without Pillow the build prints one note. See
  [SEO](docs/features/seo.md#social-cards).
- **Tabs that navigate, tab menus, sidebar anchors and a product switcher.** A docs header tab
  now opens its first page and takes `icon`, `href` (a link out; the old `url` works), `pages`
  (no group needed) and `menu` (a small dropdown of items, each with its own sidebar or link).
  `navigation.anchors` and `navigation.global.anchors` pin links (or sections with their own
  sidebar) at the top of the sidebar; `navigation.dropdowns` (or `products`) adds a switcher
  there whose entries each own a sidebar or their own header tabs. On phones all of it sits in
  the navigation drawer. `aiui validate` warns about one with nothing to open (2102). See
  [Navigation](docs/features/navigation.md#tab-options).
- **Header link icons, footer social marks and a site banner.** `navbar.links` take `icon` and
  `type: github|discord` (the mark; label optional); a `type: github` primary shows the repo's star
  count (cached). `footer.socials` draws marks for 21 networks (by key or URL) instead of text;
  column `header` is optional. `banner:` adds a Markdown strip above the docs header (`type`,
  `dismissible`; a closed one returns when its content changes). See [Navigation](docs/features/navigation.md#banner).
- **Docs pages print and save as PDF.** The page actions menu has
  **Download as PDF** (the browser's Print). A printed page, from there or from
  `Ctrl+P`, is the article alone on light paper: no header, sidebar, "On this
  page", pager or footer; accordions, expandables and file trees open, every tab
  under its own title, long code in full and wrapped, blocks kept whole across
  pages and external links followed by their address. `data-print="hide"`
  leaves any other element out. See
  [Writing docs → Printing and PDF](docs/features/writing-docs.md#printing-and-pdf).
- **Try it: authentication, file uploads and streams.** An operation's `security` becomes an
  Authorization section on its endpoint page and inputs in Try it: API key (header, query or
  cookie), bearer and other HTTP schemes, basic (username and password), OAuth2 and OpenID
  Connect tokens (scopes listed), a menu when there are alternatives, `x-default` prefill.
  Values stay in the tab's `sessionStorage` per docs site and show as `********` in the curl
  command until **Show values**. File inputs for multipart parts, file bodies and base64 JSON
  fields; `text/event-stream`, NDJSON and JSON Lines responses render as they arrive (events as
  a list) with Stop and a 10 MB cap. `api.playground.display: auth` shows Try it to signed-in
  readers only; `api.auth` on `api:` pages uses the same inputs. See
  [OpenAPI](docs/features/openapi.md#authentication).
- **Related pages under each docs page.** `aiui build` suggests the three pages
  closest to each page from their words (title, keywords, headings, text) with a
  lift for the same sidebar group, and lists them above the page footer and at the
  end of the page's agent-ready `.md`. Front matter `related: [guides/setup,
  {Label: page}, https://…]` picks them, `related: false` hides them;
  `content.docs.related: N | false` sets the number site-wide. `aiui validate`
  reports a target that is no page (7013). See
  [Writing docs pages](docs/features/writing-docs.md#related-pages).
- **Agents can report a docs problem.** The docs MCP server at `/mcp` gains a
  `submit_feedback(path, helpful, comment?)` tool: an agent that found a page wrong, outdated
  or missing something says so, and the report is stored with readers' votes (`source: agent`)
  for `aiui docs feedback`, under the same rate limit and size caps as the page's vote button.
  Not listed when page feedback is off or posted to an `endpoint`. See
  [MCP server](docs/features/ai-ready-docs.md#mcp-server).
- **Fonts and your own CSS and JS in a docs build.** `site.theme.fonts: Inter` sets the
  site's font from Google Fonts in one line (one stylesheet request, `display=swap`);
  `{body, heading, code}` sets each role, as a family name or a font file of the project
  (`{family, source: fonts/brand.woff2, weight}`), which the build publishes, declares and
  preloads. `site.customCss` (CSS text, `.css` files or URLs, one or a list) and
  `site.customJs` (`.js`/`.mjs` files or URLs) go on every built page, after every
  built-in style and script, cache-busted with a content hash; `site.customCss` was
  ignored by `aiui build` before. `aiui validate` reports a file that is not in the
  project (7014). See [Theming](docs/features/theming.md#fonts).
- **Page actions you choose, and a page read aloud.** `content.docs.pageActions` picks and
  orders the menu above each docs page, adds Perplexity, Grok, Google AI Mode, Copilot, Le Chat
  and Cursor, and takes links of your own (`{label, href, icon}` with `{url}`, `{md}`, `{title}`
  and `{prompt}` filled in); `false` turns it off. A page's front matter `pageActions` sets its
  own list or none. **Listen to page** reads the article aloud in the browser (pause, stop),
  and `Ctrl+C` / `⌘C` with nothing selected copies the page as Markdown. See
  [Page actions](docs/features/writing-docs.md#page-actions).
- **Analytics, support chat and cookie consent, one line each.** `integrations:` adds GA4, Tag
  Manager, PostHog, Plausible, Fathom, Umami, Segment, Mixpanel or any script URL, and Intercom,
  Crisp or Front chat (idle-loaded), to every built page (`ga4: G-ABC1234`); client-side page
  changes count as page views. `consent: true` loads nothing until the reader accepts a themed
  banner (Decline as easy as Accept, remembered, `#cookie-settings` reopens it, or your own tool
  sends `aiui:consent`). Global Privacy Control / Do Not Track skip analytics, `aiui dev` leaves
  them out, ids and URLs are checked, no inline script is emitted, and
  `Compiler.external_origins()` lists provider hosts for a CSP. See [Analytics](docs/features/analytics.md).

- **Ask AI over the docs.** `aiui serve` and `aiui dev` answer `POST /api/docs/ask` on a docs build:
  the server ranks the build's sections for the question, streams (Server-Sent Events) a Markdown
  answer from the site owner's own model key that cites them as `[1]`, and lists those sections
  first. Without a key it returns the best sections instead of an error. `GET /api/docs/search`
  returns the search ranking as JSON. Configure with `content.docs.assistant` (`starters`,
  `instructions`, `model`, `endpoint` for a static host) or turn it off with `assistant: false`.
  OpenAI-compatible APIs (including local servers) need no extra package; `provider/model` names use
  LiteLLM when installed. Guarded by Host and Origin checks, body caps and a per-client rate limit
  (docs/features/ai-ready-docs.md#ask-ai).

- **Ask AI in the docs site.** When `aiui serve` has a model key, the docs header shows **Ask AI**:
  a side panel with `content.docs.assistant.starters`, streamed answers whose `[n]` citations open
  the cited section, a sources list, follow-up questions, Stop and Copy answer. Also opened by
  ⌘I / Ctrl+I, a `?assistant=<question>` link, an **Ask about this** chip on a selected passage,
  an **Ask AI** row in search and the `aiui:docs-ask` window event; a page with `mode: assistant`
  shows the panel inline. A static host shows it when `assistant.endpoint` is set
  (docs/features/ai-ready-docs.md#what-readers-see).
- **Content Security Policy for docs builds.** `aiui build` gives every page a strict policy worked
  out from what the site loads: `script-src 'self'` plus a sha256 hash of each inline script the build
  writes (no `'unsafe-inline'` or `'unsafe-eval'` for scripts), font, custom CSS/JS and integration hosts,
  the YouTube/Vimeo/Loom players a page embeds, the OpenAPI servers Try it calls, the Ask AI and feedback
  endpoints and the GitHub stars API. It is written as a `<meta>` in each page and as a header (with
  `frame-ancestors 'self'`) in `_headers` for Netlify and Cloudflare Pages; `aiui serve` and `aiui dev`
  send that header. `site.csp` takes `false`, `report-only` or extra sources per directive; with
  `integrations.gtm` the default is report-only. The `aiui dev` reload script is now served from
  `/__aiui/dev.js` (docs/features/content-security-policy.md). **Behaviour change:** a `customJs` script
  or raw HTML in a page that loads from or calls another host needs that host under `site.csp`.

- **Code block themes and more languages.** `site.theme.code: dracula` (or `{light, dark}`) draws every
  docs code block in any of the 65 bundled Shiki themes, on the theme's own background with the header
  and muted text mixed from it; each theme is its own lazy file. 46 more languages highlight (74 in all,
  among them Terraform, PowerShell, Vue, Svelte, Lua, Elixir, Haskell, Nginx, Protobuf and Solidity),
  each grammar loaded only when a page uses it. `site.theme.codeLanguages` adds your own TextMate grammar
  files, published with the site and registered on first use under their name and aliases.
  `aiui validate` names the nearest theme for a typo (7015) and reports a missing or broken grammar
  (7014, 7015) (docs/features/theming.md#code-blocks).
- **Docs versions.** `navigation.versions: [{version: v2, default: true, tag: Latest}, {version: v1}]`
  publishes older docs from their folder (`docs/v1/` at `/docs/v1/...`) beside the default version at
  the docs root. A switcher above the sidebar (and in the phone drawer) keeps the reader on the same page
  in the other version, else opens its first page; the sidebar, pager, tabs and search follow the open
  version. Older pages point their canonical at the default version's page and stay out of the sitemap
  and `llms.txt` unless `index: true`; a version may list its own `groups` or `tabs`. `aiui validate`
  reports duplicate or double-default versions and misplaced pages (7018)
  (docs/features/navigation.md#versions).

- **Python API reference from docstrings.** A `::: mypkg.client` line in a docs page becomes
  that module's reference at build time: headings with stable anchors, signatures with type
  hints and defaults, parameters and attributes as `<ParamField>` / `<ResponseField>` rows,
  returns, raises, examples and notes, from Google, NumPy or reST docstrings. `__all__` and
  re-exports are followed; `members`, `private`, `show_source` and `heading_level` options go
  on indented lines under the block. The source is read without importing it, and
  `content.docs.reference.paths` (default `src`, then the project folder) says where modules
  live. Search, the agent `.md` and `llms-full.txt` see the text; a block that names nothing
  is 7016 and fails the build (docs/features/api-reference-python.md).

- **Docs sign-in on `aiui serve`.** `content.docs.auth: {password: env:DOCS_PASSWORD}` (or `users:` with a
  password each) puts a built docs site behind a sign-in page in its own theme: signed `HttpOnly` cookie,
  constant-time checks, a limit on wrong passwords. `public: ["/", "guides/*"]` and front matter `public:
  true` keep pages open; a signed-out reader's nav, search index and the sitemap list only those. Passwords
  stay in the environment; `aiui build` warns a static host cannot enforce it (7017) (docs/features/docs-auth.md).

- **Docs in several languages.** `navigation.languages: [{language: en, default: true}, {language: fr}]`
  publishes each translation from its folder (`docs/fr/` at `/docs/fr/...`, inside a version
  `docs/v1/fr/`). A header switcher keeps the reader on the same page in the other language, else opens
  its first page, and remembers the pick; a first visit to the docs home opens the browser's language
  (never for crawlers; `languageRedirect: false` turns it off). The sidebar, pager and search follow the
  open language. Each page gets `<html lang>` and `hreflang` alternates (with `x-default`), the sitemap
  lists them, and each other language has its own `llms-<code>.txt`. `aiui validate` reports duplicate
  or double-default languages and `docs/fr/v1/` folders (7020) (docs/features/navigation.md#languages).

- **Docs sign-in: groups, and agents see only what the reader may read.** `users: {alice: {password:
  env:X, groups: [partners]}}` and front matter `groups: [partners]` limit a page to a group (a 404 for any
  other reader). `llms.txt` and `llms-full.txt`, the MCP server, Ask AI, `/api/docs/search` and page feedback
  now answer every reader with the pages they may read, so signed-out readers and AI tools get the open
  pages (docs/features/docs-auth.md#groups).

- **Your own React components in docs pages.** `site.components: ./components/index.js` names one ES
  module that registers components with `registerBlock` from `@aiui/sdk` (or exports them by name);
  pages then use them as tags, `<Pricing plan="pro" seats={3}>Markdown body</Pricing>`, with `{…}`
  props as numbers, booleans, arrays and objects. The module loads only on a page that uses one of its
  tags, under the site's Content-Security-Policy; a component that fails shows the tag's body. A UI
  plugin's PascalCase block types work as tags too, with no config. Declared tags no longer trigger the
  unknown-tag warning; a module that is missing or names no tag is 7021
  (docs/features/writing-docs.md#your-own-components).

- **Handler context: who is calling, this chat's state and its history.** Inside `@aiui.reply`,
  `aiui.context.session` gives the chat id, signed-in user, `client_type` (`webapp`, `api`,
  `copilot` or the bot platform), chat profile, settings, `language` (from Accept-Language) and the
  request headers without credentials. `aiui.user_session` is a key/value store private to the chat;
  `aiui.chat_context` is its message history (reloaded from the datastore after a restart) with
  `to_openai(system=...)`. `await aiui.notify("Saved", type="success")` sends a `toast` event that
  is never saved with the reply. Concurrent chats never see each other's data; `aiui.current_user()` now works in web chats
  too (docs/features/handler-context.md).

- **Chat lifecycle handlers and `@aiui.cache`.** `@aiui.on_message` (same as `@aiui.reply`),
  `@aiui.on_chat_start` (once per chat before its first reply, as that chat), `@aiui.on_stop` (same as
  `@aiui.cancel`, now run as the stopped chat), `@aiui.on_chat_end` (same as `@aiui.goodbye`, which now
  runs when the chat's last connection closes) and `@aiui.author_rename` (the name shown for an agent).
  `@aiui.cache` memoizes setup across chats (sync or async, `ttl=`, `maxsize=`, `fn.cache_clear()`;
  concurrent first callers share one computation) (docs/api/python.md#chat-lifecycle).
- **Utility classes in docs pages.** `className="…"` (or `class`) on a component tag or raw HTML
  styles one block with a curated set of theme-token utilities: spacing, width, text size, weight and
  alignment, token colours (`text-muted-foreground`, `bg-muted`), borders, rounding, flex and grid,
  `sm:` / `md:` / `lg:` screen sizes and `dark:` for display. `<Note className="mt-8">` and
  `<div className="grid md:grid-cols-2 gap-4">` just work, in light and dark mode. Classes cannot
  touch the site chrome; any other class is dropped and `style` stays removed, and `aiui validate` /
  `aiui build` name each one with the nearest allowed class (7022;
  docs/features/writing-docs.md#styling-with-classes).

- **Each message a reply sends is its own.** Every `aiui.Message(...).send()` and `aiui.say()` shows at once as
  its own block under the answer (with its author, elements and actions), also after a reload; a streamed
  message's final `send()` no longer repeats its text. Typed elements from `add_image()` and the other `add_*()`
  methods now reach the chat, `update()`, `remove()` and `Action.remove()` arrive as their own events, and
  `aiui.notify` shows a toast in both built-in chats. Wire: `run_content.message_id` / `author`, new
  `message_actions`, `message_update`, `message_remove`, `action_remove`; protocol 1.1.0
  (docs/features/message-elements.md#several-messages-in-one-reply).

- **Sign-ins survive restarts and work on every worker.** Session tokens are signed (HMAC-SHA256)
  instead of held in memory. Zero config: a secret is generated into `<data dir>/auth_secret` (0600);
  `AIUI_AUTH_SECRET` (`aiui auth create-secret`) shares one across hosts and rotates as `new,old`.
  Sign-in also sets an httpOnly cookie (`SameSite=Lax`, `Secure` on https, root path; YAML
  `auth.cookie`) that signs in HTTP and WebSockets and slides while in use. Lifetime: YAML
  `auth.sessionLifetime` (default `14d`, was 24 h). `POST /logout` revokes on every worker sharing the
  data directory. `aiui auth create-key` now exists (docs/features/deployment.md#sessions).

### Deprecated

- `aiui.on_window_message`, `send_window_message`, `on_parent_message`,
  `send_to_parent`, `on_audio_start`, `on_audio_chunk`, `on_audio_end`,
  `on_mic_start`, `on_mic_data` and `on_mic_stop` now raise a
  `DeprecationWarning` when used (importing them, including
  `from praisonaiui import *`, stays quiet). They never fired: no built-in
  mounts their routes and no browser code sends to them. They still work and
  will be removed later.

### Fixed

- **Phone chat: no stray copy button, no lonely logo.** A table that moved to
  the canvas no longer leaves its copy and download buttons over the reply on
  a touch screen, and a long app name in the new-chat hero wraps below its
  logo, centred, instead of beside it.
- **No surprise browser windows.** `aiui serve`, `aiui dev` and the examples dashboard open a browser
  only when run from a terminal; scripts, CI, test runners and coding agents that start them no longer
  pop a window. `aiui serve` gains `--open/--no-open`, and `AIUI_NO_BROWSER=1` turns it off everywhere.
  See [CLI](docs/api/cli.md#when-a-browser-opens).

- e2e: the page-types screenshot tests report **skipped** on a platform with
  no baseline (Linux CI today) after running their DOM checks, instead of
  passing without comparing anything. ARCHITECTURE §5 and the e2e README now
  list them with legacy-parity as not enforced on Linux yet.
- Package metadata no longer lists Python 3.9, which `requires-python
  >=3.10` already refused; ruff and mypy target 3.10 to match.
- CI: the merge gate starts when `CI` passes on a pull request. It listened
  for a "Core Tests" workflow that does not exist, so a green PR waited for
  the 10-minute scan. ARCHITECTURE R15 now names the hub `merge-gate.js` and
  this repo's `gate-config.js`, which is what runs.
- CI: a stale committed frontend bundle on `main` fails CI (after the
  `bundle-sync` job opens its sync PR) instead of passing, so the release
  gate cannot publish a wheel whose React bundle does not match
  `src/frontend`. Pull requests that change only the shipped plugin typings
  (`templates/frontend/aiui-sdk.d.ts`) now run the bundle check too: CI reads
  the list of built files from the same module as `npm run sync` and
  `npm run check:bundle`.
- Tests: CI runs all of `tests/integration` (the `aiui build` pipeline, the
  package smoke checklist, attachments, MCP connect security, the feature
  APIs), not 2 of its files, and e2e shard 1 runs the dashboard view
  resolution, host runtime, page reload and mkdocs preprocess suites, which
  always skipped in the python job. That step now fails when any of its tests
  skip (`pytest --fail-on-skip`). Integration tests no longer reach an LLM
  provider when your shell has API keys set. Six passing test files at the
  top of `tests/`, which CI never ran, moved into `tests/unit` and
  `tests/integration` (the gap features suite had four stale theme
  assertions, now written against the accent presets).
- Tests: the other 17 top-level test files are gone. Fifteen were scripts
  with no test functions (pytest collected nothing, or they crashed at
  import), one was a demo app, and the examples parity script needed a
  fixture that did not exist and timed out on its CLI checks. The feature
  APIs they poked are covered by `tests/integration/test_feature_apis.py` and
  the unit suites. `tests/unit/test_test_layout.py` keeps new test files out
  of the top level.
- Release: `pypi-release.yml` builds the commit the release gate checked
  (`trigger_sha`), not whatever `main` became while the run waited, and
  refuses unless that commit is still `origin/main` with a green CI run.
  It pushes the "Release vX.Y.Z" commit and tag before `uv publish`, never
  rebasing onto unchecked commits, so a rejected push publishes nothing. A
  dry run of the release no longer counts as "already released today", and
  the release gate fails (instead of skipping every night) when the next
  version is already on PyPI but `pyproject.toml` on `main` is behind.
- Frontend layering: the chat engine and the artifacts canvas no longer import
  the legacy React App's `chat/` folder. The media renderers (video, audio,
  PDF, file, code, surface; `ElementRenderer` and its `ElementBoundary`) moved
  to `src/frontend/src/chat-engine/parts/media/` (the legacy App imports them
  through a re-export in `chat/`), and `shell/core-purity.test.ts` now fails if
  `chat-engine/`, `markdown/`, `layout-features/`, `app-layouts/`,
  `app-pages/`, `builtin/` or `surfaces/` import `chat/`, `agent-ui/` or
  `views/`. The media chunk stays lazy.
- Docs: the plugin guide no longer tells you to pass `--style app` because a
  reply app "runs in the chat style" (`aiui run app.py` opens the app shell),
  says aiui ships six layouts, and ARCHITECTURE.md quotes the real SDK export
  (33) and catalog counts, now checked by `tests/unit/test_architecture_counts.py`.
- Dashboard Overview: Approve and Deny work. They post no body, and the
  server answered `Content-Length: 0` with a 500, so the tool stayed paused.
- API: malformed or empty JSON sent to a route that expects a body is a 400
  (`Request body is not valid JSON`), not a 500 with a traceback in the log.
- Chat: deleting a chat deletes its artifacts. They stayed in the Artifacts
  index and on disk.
- `aiui run chat.yaml`: the YAML's `datastore:` is used. It applied only
  when `--datastore memory` was also passed; a `--datastore` flag still wins.
- Chat (classic `chat` style): an inline image, PDF, video, file or A2UI
  surface that fails to render now shows "Failed to render element" in its
  place instead of taking the whole message down. The old `try`/`catch`
  around the element's JSX could not catch render errors; an error boundary
  does.
- CI lints the whole frontend (`npm run lint`), not only the core and engine
  folders: the app pages, layouts, layout features (R17) and the legacy React
  App are linted too. The 73 errors already there are fixed.
- Plugins: a plugin layout's module and stylesheet get the SRI check the docs
  promise. The module's `integrity` is now in the import map (it was left out,
  so a stale or half-written layout file loaded unchecked), and the css hash
  is kept (`LayoutSpec.css_integrity`, `cssIntegrity` on the wire) and set on
  the `<link>`.
- App shell: the default Chat and Canvas layout no longer downloads the Geist
  font (29.8 KB) it never shows. The server now writes the layout's Paper look
  on `<html>` with the Pro tokens, so the first paint already uses the Paper
  fonts and the text no longer changes font after it appears. Viewers who
  chose plain Pro, or another layout, still get it (an inline script drops the
  look before first paint). `LayoutSpec` gains an optional `look`.
- Modularity: the bundled `sample-board` demo page belongs to a new
  `builtin.examples` record, so `extensions.disabled: [builtin.examples]` takes
  it off the sidebar (it stays on by default). A test now fails when a feature
  class or a bundled dashboard-plugin folder has no catalog record, and when
  the counts in `ARCHITECTURE.md` drift. Removed unreachable code:
  `server.api_usage` and `server._usage_stats` (`/api/usage` is the usage
  feature) and the unused legacy view `plugins/views/explorer.js`.
- Plugins: a plugin's nav group and its settings reach every layout, not only
  the classic frame. The built-in layouts (including `chat`, what `aiui run`
  opens) list the groups plugins declared (`nav_groups()`,
  `registerNavGroup`) in their order and folded as declared, and show a
  "Plugin settings" entry while a plugin has a settings section. Layout
  authors get `nav.groups[].declared` and `chrome.openSettings()` (additive)
  and the kit's `DeclaredNavGroups` and `PluginSettingsRow`.
- Plugins: an `extensions.enabled` allowlist no longer switches off a plugin
  the app passed to `aiui.register_plugin(obj)`. The allowlist picks which
  installed entry points to trust, as the docs say; only `extensions.disabled`
  turns your own plugin off.
- Plugins: a plugin's `features()` routes go when a later `create_app()` in the
  same process disables the plugin, and a built-in that is switched back on
  takes its feature name back from a plugin that borrowed it.
- Logs: Clear on the Logs page now sticks. `GET /api/logs` read a second
  buffer that `POST /api/logs/clear` never emptied, so the next poll brought
  every entry back and `/api/logs/stats` disagreed with it. One buffer and one
  handler remain, owned by `builtin.logs`: `GET /api/logs` is a `LogsFeature`
  route, each record is stored once, and with the built-in disabled
  `create_app` no longer imports `features/logs.py` or adds a root log handler.
  `server.api_logs` still imports and delegates to the feature.
- Channels: with the built-in in-process gateway (no `praisonai` wrapper
  installed), starting a channel bot no longer fails on the gateway path with
  `StandaloneGateway._create_bot() takes 4 positional arguments but 6 were
  given` and silently falls back to the direct import. The standalone gateway
  now takes the same `(platform, token, agent, bot_config, ch_cfg)` call as
  `WebSocketGateway`, so registered bot factories (`register_bot_factory`)
  build channel bots again.
- Serving speed. `aiui run app.py` (a chat app) no longer recopies the 11 MB
  bundle into `./aiui` on every start (setup 203 ms to 22 ms here); the
  package bundle was served anyway. Static files are gzipped once per file
  version off the event loop (a 796 kB chunk: 27 ms to 7 ms per request), and
  the page HTML, `/api/shell/manifest`, `/api/pages` and dashboard-plugin files
  are now compressed (the manifest 12.1 kB to 3.0 kB). Dashboard-plugin
  discovery stops reparsing every `manifest.json` per request. A site served by
  `aiui run --config` is compressed and sent `no-cache`, and its
  `/assets/theme.css` no longer 404s. `aiui serve` no longer answers
  `/docs/x` with a 307 to `/docs/x/`.
- Plugins: `aiui plugins doctor` now checks every `settings()`, `nav_groups()`,
  `themes()` and `layouts()` entry (and each layout's module and css file)
  and fails on any entry the server would drop. Before, a malformed section,
  group, theme or layout vanished from the UI while the doctor reported
  success.
- Plugins: a plugin page must be `kind` `react`, `blocks` or `iframe`.
  `legacy`, `native` or a typo used to pass the doctor and reach the manifest,
  then show "No handler for page" in the browser; it is now dropped with a
  warning and the doctor fails on it.
- Plugins: the warning for a dropped plugin entry is printed in the
  `aiui run` terminal on a plain install (it only reached the Logs page) and
  once per start, not again on every manifest request.
- Startup: `create_app()` no longer imports SQLAlchemy (the optional `sql`
  extra) unless `SQLAlchemyDataStore` is used, which saved about 90-350 ms per
  start where the extra is installed. A disabled `builtin.config` no longer
  loads the config watcher, and a config reload resets only registered
  features through a new optional `BaseFeatureProtocol.on_config_reload()`
  hook, so it never imports a disabled built-in. `builtin.video` loads the jobs
  store only when it renders, not at startup.
- Sessions: listing sessions no longer parses every session file on each call.
  The JSON and SDK file stores keep each session's row until its file
  changes (500 sessions of 40 messages, 29 MB: about 70-77 ms per list before,
  7-15 ms after the first), and the app shell lists them after every chat
  turn. `GET /api/sessions` and `GET /sessions` take optional
  `?limit=&offset=` and report `total`; the Overview counts sessions through
  a new `BaseDataStore.count_sessions()` instead of listing them.
- The default dashboard caches its page views. `dashboard.js` imported each
  view (`/plugins/views/<page>.js`) with `?v=<Date.now()>`, so every reload
  downloaded it again (32.7 KB for Chat). It now uses the build stamp, as the
  app shell already did: a repeat visit to `/chat` transfers 32.6 KB instead
  of 65.4 KB, and a new release still changes the URL.
- The default dashboard makes fewer requests on load. `/ui-config.json` was
  fetched 5 times and `/api/pages` twice; `dashboard.js` now asks once for
  each (the Chat view still reads the config once for its own mode). The Chat
  view loads highlight.js from the CDN only when a code block appears, not on
  every visit. A first visit to `/chat` drops from 35 requests and 202.7 KB to
  29 requests and 157.5 KB, with no third-party connection on an empty chat.
- Docs: a page no longer jumps as its code blocks first draw (Quick Start
  moved 0.037 CLS). Streamdown laid each code block out at a 200px placeholder
  (`content-visibility: auto`) for one frame before its real height; docs
  articles now lay them out normally.
- Docs: three generated mockup screenshots (an "AI Platform" upload dialog, a
  model-fallback editor and a "Nexus AI" agent tree) are gone from the
  Attachments, Model Fallback and Subagent Tree pages. They showed screens
  aiui does not have; the pages document the APIs, and Subagent Tree keeps its
  diagram.
- Docs sites (`aiui build`): a `README` or `index` page listed in a nav tab,
  or a page with a number prefix, now opens under that tab. The header used
  to fall back to the first tab for it (for example the ADP overview at
  `/docs/protocols/adp` showed under "Get started" instead of "Reference"),
  and the section eyebrow was missing.
- Docs home: the hero image no longer shifts the page as it loads (it keeps
  a 16:10 box until the file arrives), and only the image for the colour
  mode on screen downloads at first.
- Docs on phones: the folded "On this page" no longer appears a frame after
  the article and pushes it down (layout shift 0.070 → 0 on the home page,
  0.086 → 0.017 on Quick Start).
- Docs sites (`aiui build`): pages make far fewer requests, all to the site
  itself. The default `site.plugins` is now `fetch-retry` and
  `nav-intercept`: `mermaid`, `syntax-highlight`, `code-copy`, `toc`,
  `mkdocs-compat`, `content-loader`, `homepage` and `topnav` skip React docs
  pages, and two of them pulled about 40 files from cdnjs and jsdelivr on
  every page (plus a `languages/html.min.js` that does not exist). The plugin
  loader imports plugins as `?v=<hash of the plugin files>` instead of
  `?v=<Date.now()>`, so browsers and the CDN cache them. First page in a
  throttled probe (400 ms, 400 kbit/s): 96 requests from 3 origins (758 kB)
  down to 59 from 1 (515 kB). List a plugin under `site.plugins` to load it
  again. See [Deploy to GitHub Pages → Legacy plugins](docs/getting-started/github-pages.md#legacy-plugins).

- Docs sites: the home page has one URL, the site root. `/docs`, `/docs/`
  and `/docs/index` open it and move to `/`; sidebar, previous / next and
  `index.md` links point to `/`; the sitemap, `llms.txt`, `llms-full.txt`
  and canonical links name `/`. A URL with no page shows "Page not found"
  with links home and to search, instead of the developer view of the
  config (now only with `debug: true`).

- Docs sites: one slow connection no longer leaves a page on the loading
  skeleton for 20-30 seconds. Each request for a page's `.md` gets 5 seconds
  to answer, then a fresh request goes out (three attempts: 5 s, 5 s, 10 s).
  Pages are kept in memory and prefetched on hover, focus and press, and the
  previous / next pages while idle; the next click cancels the previous
  request; the renderer chunks hold up a fetched page for at most a second.
  When every attempt fails the page says "Couldn't load this page" with a
  Retry button. `fetch-retry.js` no longer retries `.md` (one retry layer) and
  never retries an aborted request. In a throttled probe a page whose request
  hangs for 30 s shows in 5.3 s instead of 31 s, and one whose new connection
  stalls for 18 s in 5.5 s instead of 18.5 s. See
  [Deploy to GitHub Pages → How pages load](docs/getting-started/github-pages.md#how-pages-load).

- Docs sites, first load: `ui-config.json`, `docs-nav.json` and
  `route-manifest.json` load with the same per-attempt time limit and retry
  as pages, a link straight to a docs page fetches its `.md` alongside them
  instead of a round trip later, and when they cannot load the page says
  "Couldn't load the docs" with a Retry button instead of staying blank.
  `fetch-retry.js` leaves any request with an abort signal to its caller.

- Docs sites (`aiui build`): the site root shows `docs/index.md` instead of an
  empty page; pages work on any static host (each page also has
  `docs/<page>/index.html`, and index pages and numbered files have their
  markdown at the URL the page loads, so `/docs/typescript` and ADR pages no
  longer say "not found"); a URL without the `/docs` base or naming a file
  (`/docs/adr/0001-x`) opens its page; digits inside a file name are no longer
  cut out of its URL. See
  [Content sources → Static hosting](docs/features/content-sources.md#static-hosting).

- Schedules: daily, weekly and custom cron schedules never ran unless
  `croniter` happened to be installed. It is now a core dependency (MIT), and
  `GET /api/schedules/{id}/stats` gives a cron job's `next_run_at`.
  `POST /api/schedules/{id}/stop` no longer fails with a `KeyError`.
- Knowledge no longer reports a working vector store when embeddings fail.
  praisonaiagents logs a failed embedding and carries on, so the status said
  `ok` with semantic search, added entries were marked synced while they lived
  only in memory (gone on restart), and search fell back to keyword matching
  as `vector`. The store now probes the embedding model when it starts and
  reads each write's result: status `degraded` with a plain reason, `persisted:
  false` and a `warning` on the add, `search_mode: fallback`. See
  [Knowledge embeddings](docs/features/knowledge-embeddings.md).
- Knowledge with a working vector store lists and searches what the store
  holds. `GET /api/knowledge` and `POST /api/knowledge/search` used to ignore
  the Chroma adapter's `SearchResult` and show only this run's in-memory
  copies, matched by keyword. A stored entry now takes the vector store's
  document ID, so list, search, `GET` and `DELETE` address one entry (#398).
- Schedules: `PUT /api/schedules/{id}` now changes `schedule` and `agent_name`,
  create keeps `agent_name`, and Run now records the run on the stored job.
- The `chat` style (the default of `aiui run`) and the other React styles
  follow the OS colour scheme, live, when neither the app (`set_theme`, YAML
  `site.theme`) nor the viewer chose a mode. They used to read only the
  filled-in `darkMode: true` and render dark on a light OS. See
  [Dark mode](docs/features/dark-mode.md#colour-mode-order).
- Chat: a failed `@reply` is no longer invisible. The run sent `run_error`
  and then `run_completed`, so the chat dropped the error, nothing was saved
  (a reload showed an unanswered question) and Mission Control counted the
  run as succeeded. A run now ends with exactly one terminal frame, a failed
  reply is saved with `status: "error"`, the run ledger keeps the first
  terminal status, the exception is logged with its traceback, and the
  dashboard chat closes its "Generating response…" bubble on an error or Stop.
- Chat: Stop cancels the `@reply` callback. The chat said "Stopped" while the
  callback kept running (and spending tokens) to the end.
- Chat: the `@reply` inactivity timeout is 600 s instead of 60 s, and
  configurable with `AIUI_REPLY_IDLE_TIMEOUT` (`0` turns it off). When it
  fires the callback is cancelled; its late answer used to be dropped while
  it kept running, and a `run_completed` followed the timeout error.
- Chat: `aiui.ask`, `aiui.prompt` and `AskUserMessage` in a `@reply` get the
  user's answer. The WebSocket acknowledged the answer as "received" and
  dropped it, so the callback waited until its timeout (and the run failed
  after 60 s of waiting). Waiting for an answer no longer counts against the
  reply's inactivity timeout, and `ask_response_ack` now says
  `no_pending_ask` when nothing was waiting.
- Chat: attachments reach the reply on every path. `POST /run` (the chat's
  fallback when the WebSocket cannot open) ignored `attachment_ids` while the
  UI showed the file as sent, and an image never reached a `@reply` app. The
  files are now on `message.attachments` (`[{id, name, content_type, path}]`).
- Chat: two runs in one session (a reload mid-reply, a second tab) no longer
  save history as Q1, Q2, A2, A1. Questions carry a `turn_id`, replies a
  `reply_to`, and history lists each reply after its own question.
- Chat: the `@aiui.welcome` greeting (and a chat YAML's `welcome:`) shows on
  a new chat. Nothing ever called `POST /welcome`, so the documented callback
  was ignored in every style. The app shell's chat (every layout), the `chat`
  style and the dashboard's chat now show it as plain text on an empty
  thread.
- `aiui run chat.yaml`: `layout:` and `extensions:` apply (through
  `set_layout` / `set_extensions`, the same blocks as in `aiui.yaml`), and any
  other key `aiui run` does not use prints a warning naming it. They used to
  be dropped without a word.
- Chat: reloading the page during a reply takes the run back. The reply so
  far is shown (it used to start mid-sentence), Stop is there, and the
  composer waits until the run ends instead of letting a second question
  interleave. A run another open tab started shows read-only with its reply
  so far. New WebSocket frame `run_attach` (answered with `run_snapshot`);
  run events carry a per-run `seq`.
- Test runs no longer touch your real data folder: `tests/conftest.py` gives
  each pytest process its own temporary `AIUI_DATA_DIR` (and clears
  `PRAISONAI_HOME`), so local runs stop reading and writing `~/.praisonaiui`
  and parallel runs stop colliding on schedules, channels and sessions
  (`AIUI_TESTS_REAL_DATA_DIR=1` opts out). The gateway's config store
  (`integration.py`) now honours `AIUI_DATA_DIR` like the server does.
- `aiui build` no longer publishes files `content.docs.exclude` names: they
  were left out of the nav but still copied to `docs/` and fetchable. The
  build now lists what it left out.
- Each built page has exactly one `<meta name="robots">` (it had two), and a
  `noindex` page says `noindex` without forcing `nofollow`. `noindex` pages
  also leave site search, as they leave the sitemap and `llms*.txt`. With
  `seo.robots.index: false` no sitemap or `llms*.txt` is written (a stale one
  is removed), and the React app no longer resets that page to `index` at
  runtime. `seo.robots.follow: false` no longer writes `Disallow: /docs/`.
  `404.html` is `noindex`.
- A docs folder without an index page is a sidebar section only: no empty
  `/docs/<folder>` route or sitemap entry. In `nav.mode: manual`, pages no
  group lists are hidden (routable, not indexed).
- App shell: the `@aiui.welcome` greeting shows on a new chat in the layouts
  too (`chat`, what `aiui run` opens, `chat-canvas`, `workbench`, `command`,
  `mission`). The layouts' new-chat hero replaced the thread heading that
  carried it, so only Guided and the classic frame showed it. The hero now
  shows the greeting in place of its generic "Ask anything…" line, above the
  starters; without a greeting the hero is unchanged.
- Chat thumbs up/down feedback is kept by every data store. The default store
  when the agents package is installed (`sdk`), and any custom
  `BaseDataStore` without its own feedback methods, dropped every vote; now
  they append it to a JSON-lines file (`feedback/feedback.jsonl` next to the
  sessions, or under `$AIUI_DATA_DIR` for custom stores) that
  `GET /api/feedback` reads back. The `json` store appends one line per vote
  instead of rewriting one array, and moves an older `feedback.json` into the
  new file on start. Override `feedback_file()` to put the log elsewhere.
- `aiui validate` and `aiui build` name raw HTML that a docs page shows
  differently than written (new finding 7019, with file and line): an
  `<iframe>` from a site other than YouTube, Vimeo or Loom shows as a link (the
  host is named), and `<script>`, `<style>`, `<link>`, `<form>`, `<audio>`,
  `<object>` and `<embed>` are removed. Code fences and inline code are
  skipped. Before, these disappeared without a word.

- `aiui.run_sync(aiui.say(...))` in a thread started by `aiui.make_async` reaches the chat (it was
  dropped), and `make_async(fn, executor=pool)` no longer fails with `TypeError`.
