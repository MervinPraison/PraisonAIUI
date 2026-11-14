# Markdown sample

Some **bold** text, `inline code` and a [link](https://example.com/docs).

## Code

```python
def greet(name: str) -> str:
    return f"hello {name}"
```

A wide code line, which must scroll inside its block instead of widening the page:

```bash
aiui build --config aiui.template.yaml --output aiui-output/ --minify && aiui serve --output aiui-output/ --port 8000
```

## Table

| Model | Input tokens | Output tokens | Cost | Latency | Notes |
|---|---|---|---|---|---|
| alpha-large-preview | 120000 | 3400 | 1.25 | 840 ms | default for long documents |
| beta-small | 3400 | 120 | 0.02 | 95 ms | default for short answers |

## Math

Inline math $E = mc^2$ and a block:

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## Diagram

```mermaid
flowchart LR
  A[Start] --> B[Finish]
```

## Admonition

!!! note "Heads up"
    MkDocs admonitions are rendered too.
