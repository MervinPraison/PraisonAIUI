# Empty State

> Clean placeholder when a table, search filter, or workspace has no records yet.

`empty()` provides a centered, muted placeholder message when a list, table, or run history has no items to display.

{
  "type": "empty",
  "text": "No agent runs yet. Send a prompt in Chat or trigger a scheduled job to see activity here."
}

## Python

```python
import praisonaiui as aiui

aiui.empty("No agent runs yet. Send a prompt in Chat to start.")
```

## YAML

```yaml
- type: empty
  text: "No agent runs yet. Send a prompt in Chat to start."
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `text` | `str` | Helpful message guiding the user on what to do next. |

## Related pages

- [Filter Bar](https://ui.praison.ai/docs/components/filter-bar.md)
- [Chat Panel](https://ui.praison.ai/docs/components/chat-panel.md)
- [Multiselect & Tags Input](https://ui.praison.ai/docs/components/multiselect-and-tags.md)
