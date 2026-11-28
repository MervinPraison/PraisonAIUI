# Text & Textarea Input

> Single-line text fields and multi-line textareas for prompts, names, and notes.

Capture single-line strings with `text_input()` and multi-line prompts or descriptions with `textarea_input()`.

[
  {"type": "text_input", "label": "Agent Name", "value": "Docs Assistant", "placeholder": "Enter agent name...", "name": "agent_name"},
  {"type": "textarea_input", "label": "System Instructions", "value": "Answer concisely and cite the exact documentation page.", "rows": 3, "name": "instructions"}
]

## Python

```python
import praisonaiui as aiui

aiui.text_input("Agent Name", value="Docs Assistant", placeholder="Enter agent name...", name="agent_name")
aiui.textarea_input("System Instructions", value="Answer concisely.", rows=3, name="instructions")
```

## YAML

```yaml
- type: text_input
  label: "Agent Name"
  value: "Docs Assistant"
  name: "agent_name"
- type: textarea_input
  label: "System Instructions"
  value: "Answer concisely."
  rows: 3
  name: "instructions"
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `text_input` | `label`, `value`, `placeholder`, `name`, `auto_submit` | Single-line input field; binds to `name` inside `form()` or `filter_bar()`. |
| `textarea_input` | `label`, `value`, `placeholder`, `rows`, `name`, `auto_submit` | Multi-line input with configurable visible `rows`. |

## Related pages

- [Multiselect & Tags Input](https://ui.praison.ai/docs/components/multiselect-and-tags.md)
- [Form](https://ui.praison.ai/docs/components/form.md)
- [Number Input](https://ui.praison.ai/docs/components/number-input.md)
