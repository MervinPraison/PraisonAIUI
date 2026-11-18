"""Callout, Badge, Tooltip, Tile, Prompt, Tree and Color are docs components (no build warning; agent .md reads)."""

from praisonaiui.compiler.agent_markdown import to_agent_markdown
from praisonaiui.compiler.docs_tags import unknown_tags

PAGE = """# Widgets

<Callout icon="rocket" color="#FFC107">Custom.</Callout>

Status <Badge color="green">New</Badge>, see <Tooltip tip="Software Development Kit">SDK</Tooltip>.

<Tile href="guide.md" title="Guide" description="Read it">![p](p.png)</Tile>

<Prompt description="Write docs." actions={["copy", "cursor"]}>You are a writer.</Prompt>

<FileTree>
  <Tree.Folder name="app" defaultOpen>
    <Tree.File name="page.tsx" highlight />
  </Tree.Folder>
</FileTree>

<Color variant="table">
  <Color.Row title="Primary">
    <Color.Item name="blue" value={{ light: "#fff", dark: "#000" }} />
  </Color.Row>
</Color>
"""


def test_new_components_are_known_docs_tags():
    assert unknown_tags(PAGE) == []


def test_a_tree_reads_as_a_nested_list_in_the_agent_markdown():
    out = to_agent_markdown(PAGE, title="Widgets")
    assert "- app/\n  - page.tsx" in out
    assert "Tree." not in out
    assert "Status New, see SDK." in out
