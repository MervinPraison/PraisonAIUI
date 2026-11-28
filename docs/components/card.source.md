---
title: Card & Card Grid
nav_title: Card
description: Display headline values or responsive grids of entity cards in Python or YAML.
---

# Card & Card Grid

Use `card()` for a single summary surface and `card_grid()` for a responsive multi-column grid of entity cards that collapses to one column on phones.

<ComponentPreview title="Card & Card Grid">
[
  {"type": "card", "title": "Monthly Revenue", "value": "$48,200", "footer": "+14.2% vs last month"},
  {"type": "card_grid", "columns": 2, "items": [
    {"title": "Docs Agent", "subtitle": "gpt-4o-mini", "tag": "Active", "description": "Answers product and API questions from indexed docs."},
    {"title": "Code Reviewer", "subtitle": "claude-3.7", "tag": "Idle", "description": "Reviews pull requests against architecture rules."}
  ]}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
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
</Tab>
<Tab title="YAML">
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
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `card` | `title`, `value`, `footer` | Card heading, prominent metric value, and optional footer caption. |
| `card_grid` | `items`, `columns` | List of card dicts (`title`, `subtitle`, `tag`, `description`, `href`, `page`) and desktop column count. |
