# Layout & Navigation Components

> Arrange pages with grids, cards, tabs, accordions, split list-details, kanban boards, breadcrumbs and SPA page links.

Organize any page cleanly across desktop and mobile (`390px` responsive stack) with 21 structure, workspace, and navigation builders.

## Quick catalog

| Python builder | YAML `type` | What it renders |
|---|---|---|
| `aiui.layout(children, *, refresh_every, params, badges, notifications)` | Page root | Top-level page payload (`_components`), optional polling, URL params, live badges & notifications |
| `aiui.columns(children)` | `columns` | Responsive horizontal grid (stacks cleanly on mobile) |
| `aiui.chat_panel(*, title="Agent Chat", agent, height=520, session_id, welcome)` | `chat_panel` | Embedded compact Agent Chat panel for split-pane workspaces (e.g. `aiui.columns([doc_viewer, chat_panel])`) |
| `aiui.container(children, *, title)` | `container` | Bordered section wrapper with optional heading |
| `aiui.card(title, *, value, footer)` | `card` | Clean summary or KPI card |
| `aiui.card_grid(items, *, columns=3)` | `card_grid` | Responsive grid of entity cards (image, title, subtitle, badges, link) |
| `aiui.tabs(items, *, lazy=False)` | `tabs` | Tabbed panel; set `lazy=True` to load heavy tabs on first click |
| `aiui.accordion(items)` | `accordion` | Collapsible FAQ / multi-section list |
| `aiui.expander(title, *, children, expanded, lazy, load)` | `expander` | Single collapsible drawer with optional lazy loading |
| `aiui.list_detail(items, *, selected, detail)` | `list_detail` | Master-detail split view (selectable list on left, details on right) |
| `aiui.board(columns=[...])` | `board` | Kanban board with horizontal status columns and cards |
| `aiui.stepper(steps, *, active=0, orientation="horizontal")` | `stepper` | Multi-step workflow or onboarding progress (`pending`, `active`, `done`, `error`) |
| `aiui.timeline(items, *, title)` | `timeline` | Chronological vertical activity & audit feed with timestamps and status dots |
| `aiui.tree_view(nodes, *, title, default_expanded)` | `tree_view` | Collapsible hierarchical tree for RAG sources, files and agent hierarchies |
| `aiui.header(text, *, level=2)` | `header` | Section heading (`h1`–`h4`) |
| `aiui.divider(text=None)` / `aiui.separator()` | `divider` / `separator` | Horizontal rule (optionally labeled) |
| `aiui.breadcrumb(items)` | `breadcrumb` | Navigation trail (`Home / Analytics / Overview`) |
| `aiui.pagination(total=..., page=1, per_page=10)` | `pagination` | Paged controls for large datasets |
| `aiui.link(label, *, href, external)` | `link` | Inline safe hyperlink |
| `aiui.link_button(label, *, href, variant, external)` | `link_button` | Button-styled hyperlink |
| `aiui.page_link(page_id, label, *, params, variant)` | `page_link` | Instant client-side navigation to another app page (no reload) |

## Examples

### Python

```python
return aiui.layout([
    aiui.breadcrumb([{"label": "Home", "href": "/"}, {"label": "Workboard"}]),
    aiui.tabs([
        {
            "label": "Board",
            "children": [
                aiui.board(columns=[
                    {"title": "To Do", "cards": [aiui.card("Draft release notes", footer="Docs")]},
                    {"title": "In Progress", "cards": [aiui.card("Review PR #625", footer="Core")]},
                    {"title": "Done", "cards": [aiui.card("Ship Notification Center", footer="SDK")]},
                ]),
            ],
        },
        {"label": "Details", "load": "details"},  # Loaded lazily on click
    ], lazy=True),
    aiui.page_link("chat", "Open Chat", variant="outline"),
])
```

### YAML

```yaml
components:
  - type: header
    text: "Workspace Overview"
    level: 2
  - type: columns
    children:
      - type: card
        title: "Open Tasks"
        value: 14
      - type: card
        title: "Completed"
        value: 38
  - type: expander
    title: "Release checklist"
    children:
      - type: text
        content: "All CI gates passing."
```

See [Server & YAML pages](https://ui.praison.ai/docs/guides/server-pages.md) for lazy tab/expander action handlers and URL query sync.

## Related pages

- [Accordion & Expander](https://ui.praison.ai/docs/components/accordion.md)
- [Tabs](https://ui.praison.ai/docs/components/tabs.md)
- [Board](https://ui.praison.ai/docs/components/board.md)
