---
title: Writing docs pages
nav_title: Writing pages
description: Every block a docs page can use, with its Markdown and a live example, and the look the site draws them in.
---

# Writing docs pages

A docs site is a folder of Markdown and one YAML file. This page lists every
block a page can use: the Markdown you write, then the block as this site
draws it. Pages that `aiui build` publishes also exist as plain Markdown
(`/docs/<page>.md`, components converted) and in `llms.txt`, so assistants
read the same content ([AI-ready docs](ai-ready-docs.md)).

## The look

`site.theme.preset` picks the colours. `paper` is the look of this site: warm
paper, a navy accent, serif titles, 17px text on a 1.7 line height and a
measure of about 75 characters. `mode: system` follows the reader's OS.

```yaml
site:
  theme:
    preset: "paper"
    mode: "system"
```

The other presets and what each changes are in [Theming](theming.md).

## Front matter

YAML at the top of a page sets its title in the sidebar, the browser tab and
search results, and its description for search engines and `llms.txt`.

```markdown
---
title: Writing docs pages
nav_title: Writing pages
description: Every block a docs page can use.
---
```

`nav_title` is the shorter label in the sidebar; without it the sidebar uses
`title`. The front matter never shows on the page.

| Key | Type | What it does |
|---|---|---|
| `title` | string | Page title: sidebar, browser tab, search, `llms.txt` (default: the first `#` heading) |
| `nav_title` | string | Shorter sidebar label |
| `description` | string | Meta description and search snippet (default: the first paragraph) |
| `icon` | string | Sidebar icon (a lucide name) |
| `order` | number | Position inside its folder (default: a number prefix such as `01-`) |
| `hidden` | `true`/`false` | Routable but left out of the sidebar |
| `noindex` | `true`/`false` | Tells search engines not to index the page |
| `searchable` | `true`/`false` | `false` leaves the page out of the site's own search |
| `keywords` | list of words, or one comma-separated string | Extra search terms, matched but never shown |
| `boost` | number | Search ranking weight (`2` ranks the page higher) |
| `layout`, `hero`, `features` | | The docs home page ([Home page layout](content-sources.md#home-page-layout)) |

`aiui validate` checks these types and reports the line of a wrong one
(`hidden: "yes"` is a string, so the page would stay in the sidebar), front
matter that is not valid YAML, images without alt text, two files that publish
the same page, two sidebar entries with the same title in one folder, headings
that skip a level, empty pages and a `theme.accent` with too little contrast.
Each finding names `file:line` and how to fix it; `--strict` makes them errors
for CI. See the [codes](../api/cli.md#aiui-validate).

## Headings and "On this page"

`##` and `###` headings build the "On this page" list beside the article
(above it on narrow screens), which follows the reader as they scroll. Every
heading gets an id from its text, so `writing-docs#callouts` links straight to
a section, and a link with a section opens the page scrolled to it. Hover a
heading (on a phone, look beside it) for its link icon: one click puts the
section in the address bar and copies its URL. Keep one `#` title per page; the paragraph right under it is the
lede and reads larger.

To pin an anchor that survives a reworded title, end the heading with `{#id}`:
`## Install the CLI {#install}` links as `#install`, the search index uses the
same id, and the braces never show.

## Callouts

Use a callout for what a reader must not miss. Each tag sets the colour and
the icon: `<Note>` and `<Info>` (blue), `<Tip>` and `<Check>` (green),
`<Warning>` (amber), `<Danger>` (red). A `title` is optional. A tag can sit on
lines of its own or share one with its text: `<Note>Saved.</Note>` works (see
[Component tags](#component-tags)).

```markdown
<Note title="Run the build first">
`aiui serve` serves the output of `aiui build`.
</Note>

<Tip>
`mode: system` follows the reader's light or dark setting.
</Tip>

<Check>
The site rebuilt without warnings.
</Check>

<Warning title="Pinned versions">
Plugins built for SDK 1 keep working; check `aiui plugins doctor` after an upgrade.
</Warning>

<Danger>
Never put an API key in `aiui.yaml`; it ships with the site.
</Danger>
```

<Note title="Run the build first">
`aiui serve` serves the output of `aiui build`.
</Note>

<Tip>
`mode: system` follows the reader's light or dark setting.
</Tip>

<Check>
The site rebuilt without warnings.
</Check>

<Warning title="Pinned versions">
Plugins built for SDK 1 keep working; check `aiui plugins doctor` after an upgrade.
</Warning>

<Danger>
Never put an API key in `aiui.yaml`; it ships with the site.
</Danger>

Pages written for MkDocs keep working: `!!! note "Title"` with an indented
body draws the same callout (`note`, `info`, `tip`, `success`, `warning`,
`danger` and the other MkDocs types).

## Steps

For a procedure the reader follows in order. Each step gets a number on a
rail; its body is ordinary Markdown, code blocks included.

````markdown
<Steps>
<Step title="Install">
```bash
pip install aiui
```
</Step>
<Step title="Write app.py">
Reply to every message with `@aiui.reply`.
</Step>
<Step title="Run it">
`aiui run app.py`, then open the address it prints.
</Step>
</Steps>
````

<Steps>
<Step title="Install">
```bash
pip install aiui
```
</Step>
<Step title="Write app.py">
Reply to every message with `@aiui.reply`.
</Step>
<Step title="Run it">
`aiui run app.py`, then open the address it prints.
</Step>
</Steps>

Options: `titleSize="h2"` (or `h3`, `h4`) on `<Steps>` or one `<Step>` makes
the titles real headings, so they appear in "On this page" and get a link;
`stepNumber={n}` restarts the count at `n`; `icon="terminal"` draws an icon
in the circle instead of the number; `id="…"` names the step for a link.

```markdown
<Steps titleSize="h3">
<Step title="Install the package" icon="terminal">
`pip install aiui`
</Step>
<Step title="Start the server" stepNumber={3}>
`aiui run app.py`
</Step>
</Steps>
```

<Steps titleSize="h3">
<Step title="Install the package" icon="terminal">
`pip install aiui`
</Step>
<Step title="Start the server" stepNumber={3}>
`aiui run app.py`
</Step>
</Steps>

## Accordions

`<Accordion>` hides detail the reader opens on demand: long output, edge
cases, FAQs. `defaultOpen` starts it open. Wrap several in `<AccordionGroup>`
to stack them as one list.

```markdown
<AccordionGroup>
<Accordion title="Why does the site show the old page after a deploy?">
The entry files keep fixed names; `aiui build` adds a content hash to their
URLs, so a hard refresh is never needed.
</Accordion>
<Accordion title="Can I host the site on GitHub Pages?" defaultOpen>
Yes. See [Deploy to GitHub Pages](../getting-started/github-pages.md).
</Accordion>
</AccordionGroup>
```

<AccordionGroup>
<Accordion title="Why does the site show the old page after a deploy?">
The entry files keep fixed names; `aiui build` adds a content hash to their
URLs, so a hard refresh is never needed.
</Accordion>
<Accordion title="Can I host the site on GitHub Pages?" defaultOpen>
Yes. See [Deploy to GitHub Pages](../getting-started/github-pages.md).
</Accordion>
</AccordionGroup>

`description="…"` adds a line under the title, `icon="code"` an icon before
it, and `id="…"` an anchor: `writing-docs#accordion-faq` opens the page with
that accordion open. A link to a heading inside a closed accordion opens it
too.

```markdown
<Accordion title="How do I link to an answer?" description="Give it an id" icon="code" id="accordion-faq">
Link to `#accordion-faq`; the accordion opens and scrolls into view.
</Accordion>
```

<Accordion title="How do I link to an answer?" description="Give it an id" icon="code" id="accordion-faq">
Link to `#accordion-faq`; the accordion opens and scrolls into view.
</Accordion>

In MkDocs syntax, `???` makes any callout a disclosure and `???+` starts it
open.

## Tabs

`<Tabs>` with one `<Tab title="…">` per choice: the same task in different
tools, languages or operating systems. Arrow keys move between tabs.

```markdown
<Tabs>
<Tab title="macOS and Linux">
Run `export OPENAI_API_KEY=sk-...` before `aiui run`.
</Tab>
<Tab title="Windows">
Run `setx OPENAI_API_KEY sk-...`, then open a new terminal.
</Tab>
</Tabs>
```

<Tabs>
<Tab title="macOS and Linux">
Run `export OPENAI_API_KEY=sk-...` before `aiui run`.
</Tab>
<Tab title="Windows">
Run `setx OPENAI_API_KEY sk-...`, then open a new terminal.
</Tab>
</Tabs>

Tabs sync by title: pick "Windows" once and every set of tabs on the page
with a "Windows" tab shows it, code groups included. The pick is remembered,
so the next page opens on it as well, and "On this page" lists only the
headings of the tabs shown. That covers a page-wide language or platform
switcher: use the same tab titles in each set. Options:

| Option | What it does |
|---|---|
| `sync={false}` on `<Tabs>` | This set keeps its own selection. |
| `defaultTabIndex={1}` on `<Tabs>` | The tab shown first (counted from 0) until the reader picks one. |
| `borderBottom` on `<Tabs>` | A rule under the tab content, to set it apart from the text below. |
| `icon="terminal"` on `<Tab>` | An icon before the title. |
| `id="…"` on `<Tab>` | An anchor: `#windows-setup` in the URL opens that tab. |

```markdown
<Tabs defaultTabIndex={1} borderBottom>
<Tab title="macOS and Linux">
`export OPENAI_API_KEY=sk-...`
</Tab>
<Tab title="Windows" icon="terminal" id="windows-setup">
`setx OPENAI_API_KEY sk-...`
</Tab>
</Tabs>
```

<Tabs defaultTabIndex={1} borderBottom>
<Tab title="macOS and Linux">
`export OPENAI_API_KEY=sk-...`
</Tab>
<Tab title="Windows" icon="terminal" id="windows-setup">
`setx OPENAI_API_KEY sk-...`
</Tab>
</Tabs>

Tabs that each hold one code block draw as a code group (below). The MkDocs
form, consecutive `=== "Label"` blocks with indented bodies, works too.

## Code blocks

Fence code with its language for highlighting and a copy button. 28 common
languages are highlighted; the rest show as plain text. Comments are drawn
in a colour that keeps 4.5:1 contrast on the code background, light and dark.

````markdown
```python
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```
````

### File names and highlighted lines

After the language, name the file with `title="…"` (or just the name) and
pick lines to highlight with `{…}`: single lines and ranges, separated by
commas.

````markdown
```python title="app.py" {3-4}
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```
````

```python title="app.py" {3-4}
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

Without `title=`, every word after the language up to the first option is
the title: `python Reply handler {3-4}` shows "Reply handler".
`highlight={3-4}`, `hl_lines="3 4"` and `highlight="3-4"` work too, so fences
written for MkDocs or Mintlify carry over.

### Code block options

Options go after the language, in any order, alone or together:

| Option | What it does |
|---|---|
| `lines` | Line numbers in a gutter (the copy button copies the code only). |
| `wrap` | Long lines wrap instead of scrolling sideways. |
| `expandable` | A block over 12 lines shows 12 and a "Show all N lines" button. |
| `nocopy` | No copy button. |
| `icon="terminal"` | An icon before the title (`terminal`, `code`, `rocket`, …; other names show the code icon). |
| `highlight={1-2,5}` | Highlighted lines; `{1-2,5}` alone does the same. |
| `focus={2,4-5}` | These lines stay sharp, the rest dim until the reader points at the block. |

A flag is never taken for a title, and `twoslash` is accepted and ignored.

````markdown
```python Reply handler lines wrap icon="code" focus={3-4}
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}, and this line is long enough to wrap on a phone")
```
````

```python Reply handler lines wrap icon="code" focus={3-4}
import praisonaiui as aiui

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}, and this line is long enough to wrap on a phone")
```

### Diffs and notation comments

End a line with a `[!code …]` comment in the language's own comment syntax
(`//`, `#`, `--`, `<!-- -->`) to mark it: `++` added, `--` removed,
`highlight` and `focus`. `:N` marks that line and the next N-1; a comment on a
line of its own marks the lines after it. The comments never show, and the
copy button copies the code without them.

````markdown
```python
port = 3000  # [!code --]
port = 8080  # [!code ++]
serve(port)  # [!code highlight]
```
````

```python
port = 3000  # [!code --]
port = 8080  # [!code ++]
serve(port)  # [!code highlight]
```

### The CodeBlock component

`<CodeBlock>` takes the same options as attributes (`language`, `filename`,
`icon`, `lines`, `wrap`, `expandable`, `nocopy`, `highlight="[1,3]"`,
`focus="[2]"`) and renders exactly like the fence. The code goes between the
tags, as written or as a `` {`…`} `` template literal.

```markdown
<CodeBlock language="bash" filename="install.sh" icon="terminal" lines highlight="[2]">
  pip install aiui
  aiui run app.py
</CodeBlock>
```

<CodeBlock language="bash" filename="install.sh" icon="terminal" lines highlight="[2]">
  pip install aiui
  aiui run app.py
</CodeBlock>

### Code groups

Put fences between `<CodeGroup>` and `</CodeGroup>` (each on its own line) to
show them as tabs, one per fence, labelled with the file name or, without
one, the language. Use it for the same step in different tools or languages.

`````markdown
<CodeGroup>

```bash pip
pip install aiui
```

```bash uv
uv pip install aiui
```

```bash poetry
poetry add aiui
```

</CodeGroup>
`````

<CodeGroup>

```bash pip
pip install aiui
```

```bash uv
uv pip install aiui
```

```bash poetry
poetry add aiui
```

</CodeGroup>

`<CodeGroup dropdown>` picks the file from a menu in the header instead of
tabs, for groups with many files or long names. Code groups sync with tabs
of the same title.

`````markdown
<CodeGroup dropdown>

```bash pip
pip install aiui
```

```bash uv
uv pip install aiui
```

</CodeGroup>
`````

<CodeGroup dropdown>

```bash pip
pip install aiui
```

```bash uv
uv pip install aiui
```

</CodeGroup>

## Cards

`<Card>` is a tile with a title, an optional `icon` and an optional `href`
(a page like `quickstart.md`, or any URL); with a link the whole card is
clickable. `<CardGroup cols={2}>` lays cards out in 1 to 4 columns (one on
phones).

```markdown
<CardGroup cols={2}>
<Card title="Quick start" icon="rocket" href="../getting-started/quickstart.md">
A chat app in five minutes.
</Card>
<Card title="Layouts" icon="panels-top-left" href="layouts.md">
Five frames for the same app.
</Card>
</CardGroup>
```

<CardGroup cols={2}>
<Card title="Quick start" icon="rocket" href="../getting-started/quickstart.md">
A chat app in five minutes.
</Card>
<Card title="Layouts" icon="panels-top-left" href="layouts.md">
Five frames for the same app.
</Card>
</CardGroup>

Icons: `message-square`, `panels-top-left`, `plug`, `book-open`,
`layout-dashboard`, `shield-check`, `code`, `zap`, `rocket`, `terminal`,
`bot`, `palette`, `arrow-right`. A list whose items start with bold text also
becomes a grid of plain cards.

Card options:

| Option | What it does |
|---|---|
| `horizontal` | Icon beside the title, one compact row. |
| `img="images/x.png"` | A header image across the top (relative paths resolve like Markdown images). |
| `cta="Read the guide"` | A call-to-action line with an arrow at the bottom. |
| `arrow` / `arrow={false}` | A link arrow in the corner (on by default for links that leave the site). |
| `color="#0f766e"` | The icon's colour (a hex, `rgb()`, `hsl()` or colour name). |

```markdown
<CardGroup cols={2}>
<Card title="Quick start" icon="rocket" horizontal color="#0f766e" href="../getting-started/quickstart.md" />
<Card title="Themes" img="../images/theme-comparison.png" cta="Pick a theme" href="theming.md">
Light, dark and the presets side by side.
</Card>
</CardGroup>
```

<CardGroup cols={2}>
<Card title="Quick start" icon="rocket" horizontal color="#0f766e" href="../getting-started/quickstart.md" />
<Card title="Themes" img="../images/theme-comparison.png" cta="Pick a theme" href="theming.md">
Light, dark and the presets side by side.
</Card>
</CardGroup>

## Columns

`<Columns cols={2}>` lays any content side by side, one `<Column>` per cell,
in 1 to 4 columns; on phones the columns stack.

```markdown
<Columns cols={2}>
<Column>
**Python**: `pip install aiui`
</Column>
<Column>
**From source**: `pip install -e ".[dev]"`
</Column>
</Columns>
```

<Columns cols={2}>
<Column>
**Python**: `pip install aiui`
</Column>
<Column>
**From source**: `pip install -e ".[dev]"`
</Column>
</Columns>

## API fields

Document an endpoint's parameters and response with field rows. Each row
shows the name, its type, where it goes, `required` and `deprecated`, and
its default, then the description (any Markdown).

`<ParamField>` names the parameter by where it goes: `path`, `query`,
`body` or `header`. `<ResponseField name>` is a field of the response.
Both take `type` (any text: `string`, `string[]`, `object`, `User | null`),
`required`, `deprecated`, `default`, and `pre` / `post`: labels shown before
or after the name (`pre={["beta"]}`, or `pre="beta, internal"`).
`placeholder` is accepted for API playgrounds and not shown.

Every row has its own link: `#param-user_id`, `#response-next_cursor`, and
for a nested field the path from its parent (`#response-user-address`). The
name is that link, and opening it opens the `<Expandable>` around the field.
`id="…"` sets the link yourself.

```markdown
<ParamField path="user_id" type="string" required>
The user to fetch.
</ParamField>

<ParamField query="tags" type="string[]" default="all" pre={["beta"]}>
Only users with these tags.
</ParamField>

<ResponseField name="user" type="object" required>
  The user.
  <Expandable title="user properties">
    <ResponseField name="name" type="string">Display name.</ResponseField>
    <ResponseField name="email" type="string" deprecated>Use `emails`.</ResponseField>
  </Expandable>
</ResponseField>
```

<ParamField path="user_id" type="string" required>
The user to fetch.
</ParamField>

<ParamField query="tags" type="string[]" default="all" pre={["beta"]}>
Only users with these tags.
</ParamField>

<ResponseField name="user" type="object" required>
  The user.
  <Expandable title="user properties">
    <ResponseField name="name" type="string">Display name.</ResponseField>
    <ResponseField name="email" type="string" deprecated>Use `emails`.</ResponseField>
  </Expandable>
</ResponseField>

`<Expandable title="…">` folds nested properties behind "Show …" (default
"Show properties"); `defaultOpen` starts it open. Nest them as deep as the
object goes.

### Request and response examples

`<RequestExample>` and `<ResponseExample>` hold code fences, labelled like a
[code group](#code-groups) (several fences become tabs; `dropdown` picks one
from a menu instead). They leave the article: on wide screens they stay in
view in a column on the right, in place of "On this page"; on phones they
follow the article. `<Panel>` puts anything else in that column.

`````markdown
<RequestExample>

```bash cURL
curl https://api.example.com/v1/users/42
```

```python Python
client.users.get("42")
```

</RequestExample>

<ResponseExample dropdown>

```json 200
{ "user": { "name": "Ada" } }
```

```json 404
{ "error": "not_found" }
```

</ResponseExample>

<Panel>
Rate limit: 10 requests a second per key.
</Panel>
`````

Put each on lines of its own, outside list items (a `<Panel>` inside a list
item stays where it is). This page has none, so it keeps its "On this page".

## Component tags

Tags work the way MDX reads them: on lines of their own, on one line with
their text, inside a list item (indent the tag with the item's text), or
self-closing (`<Card title="Docs" href="index.md" />`). Attributes take quotes
or braces (`cols={3}`) and may run over several lines. A body indented under
its tag is text, not code, as in MDX.

```markdown
1. Install the package.
   <Warning>Use Python 3.10 or newer.</Warning>
2. Run `aiui build`.
```

A tag the site does not know (say `<Tree>` from another docs tool) keeps its
text as plain Markdown, and `aiui build` and `aiui validate` name it:
`Warning: docs/guide.md:12: <Tree> is not a docs component; its content shows as plain Markdown`.

`<Visibility for="humans">` / `for="agents"` shows its content only on the page /
only to agents ([AI-ready docs](ai-ready-docs.md#content-for-people-or-for-agents-only)).

## Comments

`{/* … */}` and `<!-- … -->` never show on the page, in search or in
`llms-full.txt`; inside a code block they stay as written.

## Tables

| Key | What it sets | Default |
|---|---|---|
| `preset` | colours (and for `paper`, the type) | `zinc` |
| `mode` | `light`, `dark` or `system` | `darkMode` |
| `radius` | corner radius, `none` to `xl` | `md` |

```markdown
| Key | What it sets | Default |
|---|---|---|
| `preset` | colours | `zinc` |
```

A wide table scrolls inside its frame, never the page.

## Images

```markdown
![What the image shows, for readers who cannot see it](../images/tool-streaming.png)
```

Paths are relative to the page. Write the alt text as a sentence about what
the image shows; it is also what search engines and assistants read. Click
any image (or focus it and press Enter) to see it at full size; Escape or a
click closes it.

`<Frame>` sets an image on a mat, with an optional `caption` under it:

```markdown
<Frame caption="A tool call, then an approval the agent waits on.">
![A tool call row above the answer, then an approval card for pip install numpy](../images/tool-streaming.png)
</Frame>
```

<Frame caption="A tool call, then an approval the agent waits on.">
![A tool call row (execute_command, Done in 0.3 s) above the answer, then an approval card for pip install numpy with Approve and Deny](../images/tool-streaming.png)
</Frame>

## Diagrams and math

A `mermaid` fence draws a diagram (loaded only on pages that have one), and
`$$ … $$` typesets math.

````markdown
```mermaid
flowchart LR
  YAML --> build["aiui build"] --> site[Static site]
```
````

```mermaid
flowchart LR
  YAML --> build["aiui build"] --> site[Static site]
```

## Search

Readers press <kbd>⌘</kbd> <kbd>K</kbd> (<kbd>Ctrl</kbd> <kbd>K</kbd>) or the
search field. Search covers page titles, every `##` and `###` heading and all
the text under it, and a result opens the page at its section with the words
marked. It forgives typing: plurals and verb forms match ("themes",
"theming"), a word matches as you type it ("inst"), one typo in a longer word
still matches, and question words drop out ("how do I deploy"). Titles rank
first, then headings, then text, each BM25 style.

While the dialog is open the address bar carries the query, so a link such as
`/docs?q=api+keys` opens search filled in. On a site with header tabs
([Navigation](navigation.md)), chips filter results by tab: search starts in
the reader's tab, and one row offers the other tabs' results when it has none.

```markdown
---
keywords: [login, sign in]   # found by these words, never shown (or "login, sign in")
boost: 2                     # rank higher within its tier (0.1 to 10)
searchable: false            # out of site search; sidebar and search engines keep it
---
```

A navigation group's `boost:` applies to its pages (a page's own wins).
Site settings (`search.provider` is ignored and `aiui validate` says so):

```yaml
search:
  prompt: "Search the handbook"   # placeholder (default "Search docs")
  maxResults: 10                  # 1 to 100 (default 24)
  enabled: false                  # turn search off
```

`aiui build` writes the index (`search-index.json`, up to 6,000 characters
per section); the dialog downloads it the first time a reader opens search.
This repository's 103 pages make 547 KB, 186 KB gzipped.

## Links between pages

Link to another page by its file: `[Theming](theming.md)`. The build turns it
into the page's URL, so links work on GitHub and on the site.

A folder's `README.md` or `index.md` is served at the folder's URL
(`protocols/adp/README.md` at `/docs/protocols/adp`), and a number prefix is
dropped (`adr/0003-selectable-layouts.md` at `/docs/adr/selectable-layouts`).
List such a page in the nav by its file path (`protocols/adp/README`); the
header still opens the tab that lists it.

## Check links

`aiui docs check-links` finds every link that leads nowhere, before readers do:

```bash
aiui docs check-links
```

```text
docs/guide/setup.md:11: instal.md: page not found (did you mean install.md?)
docs/guide/setup.md:12: ../index.md#nowhere: anchor #nowhere not found on /docs/index
✗ 2 broken of 40 links checked in 12 pages
```

It checks Markdown links and images, reference links, `href` and `src` on
components and HTML (`<Card href>`, `<a>`, `<img>`), the docs home `hero` and
`features` links, the nav page entries and the navbar and footer links in the
YAML. A `#section` link is checked against the ids the site gives its headings
(`## The aiui CLI` is `#the-aiui-cli`). Links in code are skipped. Paths outside
the docs (app routes such as `/chat`) are not judged.

`--external` also requests every `http(s)` URL, and `--json` prints the result
for scripts. The exit code is `1` when a link is broken, so a CI step needs one
line. `aiui validate --strict` and `aiui build --strict` fail on broken links
too; without `--strict` they print them as warnings.

## Page actions

Above every page's title, **Copy page** copies the page's Markdown, ready to
paste into an assistant. Its menu also has:

| Action | What it does |
|---|---|
| Copy page | The page's agent-ready Markdown on the clipboard |
| View as Markdown | Opens `/docs/<page>.md`, the page as plain Markdown for assistants |
| Open in ChatGPT | A new ChatGPT chat that reads the page and takes questions |
| Open in Claude | The same, in Claude |

Nothing to configure: they use the Markdown `aiui build` already publishes.
Try it on this page.

## Page footer

Under each page, three optional parts, turned on in `aiui.yaml`:

```yaml
content:
  docs:
    editLink:
      pattern: "https://github.com/acme/site/edit/main/docs/:path"
    lastUpdated: true
    feedback:
      issues: "https://github.com/acme/site/issues/new"
```

- **Edit this page** links to `pattern` with `:path` replaced by the page's
  file under the docs folder (`getting-started/quickstart.md`).
- **Last updated** is the date of the last commit that changed the page.
  `aiui build` reads it from git; a shallow clone has only one commit, so the
  date is left out there rather than shown wrong. In GitHub Actions, check out
  with `fetch-depth: 0` to get the dates.
- **Was this page helpful?** stores nothing. "Yes" thanks the reader; "No"
  offers a new issue at `issues` with the page's title and address filled in.

The footer of this page shows all three.

## What the build publishes for assistants

| File | What it holds |
|---|---|
| `/llms.txt` | every page with its description, by nav group ([llmstxt.org](https://llmstxt.org)) |
| `/llms-full.txt` | every page's agent-ready Markdown in one file |
| `/docs/<page>.md` | one page's agent-ready Markdown ([AI-ready docs](ai-ready-docs.md)) |
| `/docs/<page>.source.md` | the page source the site renders |
| `/search-index.json` | headings and text per page, for the site's own search |
| `/sitemap.xml`, `/robots.txt` | for search engines |

Each page's HTML also carries that page's source (a JSON script,
`id="aiui-initial-doc"`), so the first visit renders without a second request
for it. Pages over 200 KB of Markdown are fetched as before.
