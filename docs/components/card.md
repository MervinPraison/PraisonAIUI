# Card & Card Grid

> Display headline values or responsive grids of entity cards in Python or YAML.

Use `card()` for a single summary surface and `card_grid()` for a responsive multi-column grid of entity cards that collapses to one column on phones.

[
  {"type": "card", "title": "Monthly Revenue", "value": "$48,200", "footer": "+14.2% vs last month"},
  {"type": "card_grid", "columns": 2, "items": [
    {"title": "Docs Agent", "subtitle": "gpt-4o-mini", "tag": "Active", "description": "Answers product and API questions from indexed docs."},
    {"title": "Code Reviewer", "subtitle": "claude-3.7", "tag": "Idle", "description": "Reviews pull requests against architecture rules."}
  ]}
]

## Python

```python
import praisonaiui as aiui

aiui.card("Monthly Revenue", value="$48,200", footer="+14.2% vs last month")

aiui.card_grid(
    [
        {"title": "Docs Agent", "subtitle": "gpt-4o-mini", "tag": "Active", "description": "Answers product questions."},
        {"title": "Code Reviewer", "subtitle": "claude-3.7", "tag": "Idle", "description": "Reviews pull requests."},
    ],
    columns=2,
)
```

## YAML

```yaml
- type: card
  title: "Monthly Revenue"
  value: "$48,200"
  footer: "+14.2% vs last month"
- type: card_grid
  columns: 2
  items:
    - title: "Docs Agent"
      subtitle: "gpt-4o-mini"
      tag: "Active"
      description: "Answers product questions."
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `card` | `title`, `value`, `footer` | Card heading, prominent metric value, and optional footer caption. |
| `card_grid` | `items`, `columns` | List of card dicts (`title`, `subtitle`, `tag`, `description`, `href`, `page`) and desktop column count. |

## Related pages

- [Columns, Container & Layout](https://ui.praison.ai/docs/components/columns.md)
- [Gallery](https://ui.praison.ai/docs/components/gallery.md)
- [Layout & Navigation Components](https://ui.praison.ai/docs/components/layout.md)
