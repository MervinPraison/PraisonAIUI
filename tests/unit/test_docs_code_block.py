"""``<CodeBlock>``: a known docs tag whose body is code (compiler/docs_tags.py)."""

from __future__ import annotations

from praisonaiui.compiler.docs_tags import strip_comments, unknown_tags


def test_code_block_is_known_and_its_body_is_never_linted():
    text = (
        '<CodeBlock language="jsx" filename="App.jsx" lines>\n'
        "  <Widget title={x} />\n"
        "</CodeBlock>\n"
        '<CodeBlock language="tsx"><Panel /></CodeBlock>\n'
        "<Gadget>after</Gadget>\n"
    )
    assert unknown_tags(text) == [(5, "Gadget")]


def test_comments_inside_a_code_block_body_are_kept():
    text = '<CodeBlock language="html">\n<!-- keep me -->\n</CodeBlock>\n<!-- drop me -->\n'
    out = strip_comments(text)
    assert "<!-- keep me -->" in out
    assert "drop me" not in out
    assert out.count("\n") == text.count("\n")
