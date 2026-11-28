# Python API reference

> One line in a docs page and aiui build writes the reference for a Python module, class or function from its docstrings.

Write one line in a docs page and the build turns it into the reference for
that Python module, class or function:

```markdown
::: mypkg.client
```

No extra tool or build step. The source is read as text (Python's `ast`), so
the package does not have to be installed and nothing is imported. `aiui dev`
rebuilds the page when you save a `.py` file. The reference goes in where the
line is, in the same pass as [snippets](https://ui.praison.ai/docs/features/writing-docs.md#reusable-snippets-and-variables),
so the page, its agent `.md`, `llms-full.txt`, search and `aiui validate` all see it.

## What a block shows

| You write | You get |
|---|---|
| `::: mypkg.client` | The module docstring, then its public members: `__all__` in order when there is one (re-exports followed), else every public class and function |
| `::: mypkg.client.Client` | The class: constructor signature and parameters, bases, attributes (annotated or documented, properties, `Field(default=, description=)`), then its public methods |
| `::: mypkg.client.connect` | One function or method |

Each object gets a heading anchored by its dotted path with dashes
(`#mypkg-client-Client-fetch`) and its signature with type hints and defaults.
Names starting with `_` are left out. From the docstring:

- **Parameters**: [`<ParamField>`](https://ui.praison.ai/docs/features/writing-docs.md#api-fields) rows with the
  type and default from the signature, `required` when there is no default,
  and the text; documented `**kwargs` keys get rows too. **Attributes**:
  `<ResponseField>` rows.
- **Returns**, **Yields**, **Raises**: lists of types with their text.
- `>>>` examples, `::` blocks and `.. code-block::`: highlighted code.
  **Notes**, **Warnings**, `.. note::`, `.. warning::`: callouts.

Google (`Args:`), NumPy (`Parameters` over `----------`) and reST (`:param x:`,
`:type x:`, `:returns:`, `:rtype:`, `:raises E:`) styles all work. reST roles
become code, and `<` is escaped so text never turns into a tag.

## Options

YAML on the indented lines under the block (an `options:` mapping works too):

```markdown
::: mypkg.client.Client
    members: [connect, close]
    heading_level: 3
```

| Option | Default | What it does |
|---|---|---|
| `members` | all public | Only these members, in this order; `false`: the object alone |
| `private` | `false` | Also `_name` members (not `__dunder__`) |
| `show_source` | `false` | A collapsed "Source code" block under each object |
| `heading_level` | `2` | Heading level of the block's own object (`1` to `6`) |

## Where modules are found

`mypkg.client` is `mypkg/client.py`, `mypkg/client/__init__.py` or a `.pyi`, in
`src/`, then the project folder. Change the folders, searched in order:

```yaml
content:
  docs:
    dir: docs
    reference:
      paths: [src, packages/sdk]
```

## Checks

A block naming no module or member, a file that is not valid Python, or an
unknown option is 7016 in `aiui validate` and fails `aiui build` with the page
and line. A `:::` line inside a code fence is left alone.

## Example

The class behind this page, from `::: praisonaiui.compiler.python_api.PythonApi`
with `members: [markdown]` and `heading_level: 3`:

### `PythonApi` {#praisonaiui-compiler-python_api-PythonApi}

```python
PythonApi(root: Path, paths: list[str] | tuple[str, ...] = DEFAULT_PATHS)
```

Finds and renders the objects ``:::`` blocks name.

**Parameters**

- `root` (Path, required): The project folder.

- `paths` (list[str] | tuple[str, ...], default: DEFAULT_PATHS): Folders under ``root`` searched in order for a module's file.

#### `PythonApi.markdown()` {#praisonaiui-compiler-python_api-PythonApi-markdown}

```python
def markdown(target: str, opts: dict) -> str
```

The Markdown for one ``::: target`` block.

**Parameters**

- `target` (str, required): A dotted module path, optionally followed by a class, function or method.

- `opts` (dict, required): The block's options (``members``, ``private``, ``show_source``, ``heading_level``).

**Returns**

- `str`: Headings, signatures and field rows for the docs Markdown pipeline.

**Raises**

- `ApiReferenceError`: When ``target`` names nothing, or a listed member does not exist.

## Related pages

- [Reference](https://ui.praison.ai/docs/api.md)
- [Redirects and the not-found page](https://ui.praison.ai/docs/features/redirects.md)
- [Basic Catalog Components & Functions](https://ui.praison.ai/docs/a2ui/components.md)
