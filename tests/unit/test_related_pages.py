"""Related pages under each docs page: suggested from page content, set or hidden by front matter."""

import json
from pathlib import Path

from praisonaiui.compiler import Compiler, related
from praisonaiui.compiler.content_lint import FRONTMATTER_TYPES, check_frontmatter
from praisonaiui.schema.models import Config

PAGES = {
    "index.md": "---\ntitle: Home\n---\n# Home\n\nWelcome to the deployment and theming docs.\n",
    "deploy/docker.md": "# Deploy with Docker\n\nBuild a Docker image and run the container.\n\n## Docker compose\n\nCompose file for the container deploy.\n",
    "deploy/kubernetes.md": "---\nkeywords: [container, docker]\n---\n# Deploy on Kubernetes\n\nRun the container image in a cluster.\n\n## Helm chart\n\nA chart deploys the container.\n",
    "deploy/server.md": "# Deploy on a server\n\nCopy the build to a server and run it behind nginx.\n",
    "theme/colors.md": "# Theme colors\n\nSet the accent colour and dark mode palette.\n\n## Dark mode\n\nThe palette in dark mode.\n",
    "theme/fonts.md": "# Theme fonts\n\nPick fonts for the theme: body font, heading font, palette.\n",
    "secret.md": "---\nhidden: true\n---\n# Docker secrets\n\nDocker container image secrets for the docker deploy.\n",
    "quiet.md": "---\nsearchable: false\n---\n# Docker notes\n\nDocker container image docker deploy notes.\n",
    "manual.md": (
        "---\nrelated:\n  - theme/fonts\n  - ./deploy/server.md#nginx\n  - Container guide: deploy/docker\n"
        "  - https://example.com/guide\n  - missing/page\n---\n# Manual\n\nPicked by hand.\n"
    ),
    "off.md": "---\nrelated: false\n---\n# Standalone\n\nA page with no related pages.\n",
}


def _build(tmp_path: Path, pages: dict = PAGES, **docs) -> tuple[Path, dict]:
    for name, text in pages.items():
        path = tmp_path / "docs" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    config = Config.model_validate({
        "site": {"title": "Acme Docs"},
        "seo": {"siteUrl": "https://acme.test"},
        "content": {"docs": {"dir": "docs", **docs}},
        "templates": {"docs": {"layout": "ThreeColumnLayout", "slots": {}}},
        "routes": [{"match": "/docs/**", "template": "docs"}],
    })
    out = tmp_path / "site"
    result = Compiler(config, base_path=tmp_path).compile(output_dir=out)
    assert result.success, result.error
    nav = json.loads((out / "docs-nav.json").read_text(encoding="utf-8"))
    items: dict = {}

    def walk(level):
        for item in level:
            if item.get("path"):
                items[item["path"]] = item
            walk(item.get("children") or [])

    walk(nav["items"])
    return out, items


def test_pages_get_the_closest_pages_by_content(tmp_path: Path) -> None:
    _, items = _build(tmp_path)
    docker = items["/docs/deploy/docker"]["related"]
    assert docker[0] == "/docs/deploy/kubernetes"  # shared words, keywords and the same group
    assert len(docker) <= 3
    assert items["/docs/theme/colors"]["related"][0] == "/docs/theme/fonts"
    every = [p for item in items.values() for p in item.get("related", []) if isinstance(p, str)]
    # Never suggested: hidden, searchable: false, the home page, the page itself.
    assert not {"/docs/secret", "/docs/quiet", "/docs/index"} & set(every)
    assert all(p not in items[p].get("related", []) for p in items)
    assert "related" not in items["/docs/index"]


def test_front_matter_list_replaces_the_suggestions_and_false_hides_them(tmp_path: Path) -> None:
    out, items = _build(tmp_path)
    assert items["/docs/manual"]["related"] == [
        "/docs/theme/fonts",
        "/docs/deploy/server#nginx",
        {"title": "Container guide", "path": "/docs/deploy/docker"},
        {"title": "example.com/guide", "href": "https://example.com/guide"},
    ]
    assert "related" not in items["/docs/off"]
    assert "related" not in items["/docs/off"].get("meta", {})
    md = (out / "docs/manual.md").read_text(encoding="utf-8")
    assert md.rstrip().endswith(
        "## Related pages\n\n- [Theme fonts](https://acme.test/docs/theme/fonts.md)\n"
        "- [Deploy on a server](https://acme.test/docs/deploy/server.md)\n"
        "- [Container guide](https://acme.test/docs/deploy/docker.md)\n"
        "- [example.com/guide](https://example.com/guide)"
    )
    assert "## Related pages" not in (out / "docs/off.md").read_text(encoding="utf-8")


def test_site_setting_sets_the_number_or_turns_it_off(tmp_path: Path) -> None:
    _, items = _build(tmp_path / "one", related=1)
    assert len(items["/docs/deploy/docker"]["related"]) == 1
    _, items = _build(tmp_path / "off", related=False)
    assert "related" not in items["/docs/deploy/docker"]
    assert "related" in items["/docs/manual"]  # an explicit list still shows
    assert [related.limit_of(v) for v in (None, True, False, 0, 5, 50)] == [3, 3, 0, 0, 5, 10]


def test_build_is_deterministic(tmp_path: Path) -> None:
    _, a = _build(tmp_path / "a")
    _, b = _build(tmp_path / "b")
    assert {p: i.get("related") for p, i in a.items()} == {p: i.get("related") for p, i in b.items()}


def test_validate_reports_unknown_targets(tmp_path: Path) -> None:
    for name, text in PAGES.items():
        path = tmp_path / "docs" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    config = Config.model_validate({
        "site": {"title": "Acme"}, "content": {"docs": {"dir": "docs"}},
        "templates": {"docs": {"layout": "ThreeColumnLayout", "slots": {}}},
        "routes": [{"match": "/docs/**", "template": "docs"}],
    })
    found = [i for i in Compiler(config, base_path=tmp_path).lint_content() if i.code == 7013]
    assert [(i.file, i.line, "missing/page" in i.message) for i in found] == [("docs/manual.md", 2, True)]


def test_related_type_is_checked() -> None:
    assert "related" in FRONTMATTER_TYPES
    assert check_frontmatter("---\nrelated: [a, {B: b}]\n---\n", "p.md") == []
    assert check_frontmatter("---\nrelated: false\n---\n", "p.md") == []
    assert [i.code for i in check_frontmatter("---\nrelated: guides/a\n---\n", "p.md")] == [7001]


def test_resolve_accepts_the_ways_authors_name_a_page() -> None:
    routes = {"/docs/guides/setup", "/docs/guides/index", "/docs/intro"}
    page = "/docs/guides/other"
    for target in ("guides/setup", "/docs/guides/setup", "guides/setup.md", "./setup", "docs/guides/setup"):
        assert related.resolve(target, page, "/docs", routes) == "/docs/guides/setup", target
    assert related.resolve("../intro", page, "/docs", routes) == "/docs/intro"
    assert related.resolve("guides", page, "/docs", routes) == "/docs/guides/index"
    assert related.resolve("intro#start", page, "/docs", routes) == "/docs/intro#start"
    assert related.resolve("nope", page, "/docs", routes) is None
