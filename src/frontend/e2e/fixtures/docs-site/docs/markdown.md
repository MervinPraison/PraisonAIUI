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

## Code titles

```python title="app.py" {2}
import praisonaiui as aiui
print("highlighted")
# a comment
```

<CodeGroup>

```bash pip
pip install aiui
```

```bash uv
uv pip install aiui
```

</CodeGroup>

## Components

<Note title="Component note">
A callout from a component tag.
</Note>

<Steps>
<Step title="Install">
Run the installer.
</Step>
<Step title="Run">
Start the app.
</Step>
</Steps>

<CardGroup cols={2}>
<Card title="First page" icon="rocket" href="guide/first.md">
The first guide page.
</Card>
<Card title="Elsewhere" href="https://example.com/">
An external link.
</Card>
</CardGroup>

<Accordion title="More detail">
Hidden until opened.
</Accordion>

<Frame caption="A sample image.">
![A blue box with a diagonal line](images/sample.png)
</Frame>

## Tags anywhere {#tags-anywhere}

<Tip>A one-line tip.</Tip>

1. Install the package.
   <Warning>
   Inside the first step.
   </Warning>
2. Run it.

<Tree>
    Text inside an unknown component.
</Tree>

{/* An MDX comment the reader never sees. */}

## Code options

```javascript Example title lines wrap
const greeting = 'a line long enough to wrap on a phone, and then some more words so it wraps on a desktop column too, really'
console.log(greeting)
```

```ts highlight={1-2,4} focus={2}
const a = 1
const b = 2
const c = 3
const d = 4
```

```js
const port = 3000 // [!code --]
const port = 8080 // [!code ++]
listen(port)
```

```python expandable nocopy
line_1 = 1
line_2 = 2
line_3 = 3
line_4 = 4
line_5 = 5
line_6 = 6
line_7 = 7
line_8 = 8
line_9 = 9
line_10 = 10
line_11 = 11
line_12 = 12
line_13 = 13
line_14 = 14
line_15 = 15
```

<CodeBlock language="bash" filename="install.sh" icon="terminal" highlight="[2]">
  pip install aiui
  aiui run app.py
</CodeBlock>
