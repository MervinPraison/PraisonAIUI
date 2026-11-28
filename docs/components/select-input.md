# Select Input

> Dropdown selector with optional client search and remote async option loading.

`select_input()` renders a single-choice dropdown—and upgrades automatically to a searchable combobox when `searchable=True` or `options_url` is set.

[
  {"type": "select_input", "label": "Primary Model", "options": ["gpt-4o", "gpt-4o-mini", "claude-3.7-sonnet", "gemini-2.5-flash"], "value": "gpt-4o", "name": "model"},
  {"type": "select_input", "label": "Searchable Region", "options": ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"], "value": "us-east-1", "searchable": true, "name": "region"}
]

## Python

```python
import praisonaiui as aiui

aiui.select_input("Primary Model", options=["gpt-4o", "gpt-4o-mini", "claude-3.7-sonnet"], value="gpt-4o", name="model")
aiui.select_input("Searchable Region", options=["us-east-1", "eu-west-1"], searchable=True, name="region")
```

## YAML

```yaml
- type: select_input
  label: "Primary Model"
  options: ["gpt-4o", "gpt-4o-mini", "claude-3.7-sonnet"]
  value: "gpt-4o"
  name: "model"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `label`, `options`, `value`, `name` | options | Dropdown label, list of strings or `{label, value}` pairs, selected value, and form key. |
| `searchable`, `options_url`, `placeholder` | options | Enable combobox filtering or fetch remote options via `GET options_url?q=...`. |

## Related pages

- [Multiselect & Tags Input](https://ui.praison.ai/docs/components/multiselect-and-tags.md)
- [Form](https://ui.praison.ai/docs/components/form.md)
- [Inputs, Filters & Forms](https://ui.praison.ai/docs/components/inputs-and-forms.md)
