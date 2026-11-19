"""Endpoints on hand-written pages and in navigation: front matter ``openapi:`` and ``api:``,
``METHOD /path`` navigation entries and an operation's ``x-aiui`` page settings."""

import json

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.content_lint import FRONTMATTER_TYPES
from praisonaiui.compiler.openapi import endpoint_ref, same_source
from praisonaiui.schema.models import Config

SPEC = """
openapi: 3.1.0
info: {title: Pets, version: "1"}
servers: [{url: https://api.pets.dev}]
tags: [{name: pets}]
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      description: Lists every pet.
      tags: [pets]
      parameters: [{name: limit, in: query, schema: {type: integer}}]
      responses: {"200": {description: OK}}
    post:
      operationId: createPet
      summary: Create a pet
      tags: [pets]
      x-aiui:
        metadata: {title: Add a pet, sidebarTitle: Add, tag: NEW, playground: simple, "og:title": Pets}
        content: "<Note>Needs a key.</Note>"
      responses: {"201": {description: Created}}
  /pets/{id}:
    get:
      operationId: getPet
      summary: Get a pet
      tags: [pets]
      x-mint: {metadata: {sidebarTitle: Fetch}, href: /reference/fetch}
      parameters: [{name: id, in: path, required: true, schema: {type: string}}]
      responses: {"200": {description: OK}}
webhooks:
  newPet: {post: {summary: New pet, responses: {"200": {description: OK}}}}
"""


def build(tmp_path, pages: dict[str, str], **config):
    (tmp_path / "openapi.yaml").write_text(SPEC)
    for name, text in {"index.md": "# Home\n\nHi.\n", **pages}.items():
        (tmp_path / "docs" / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / "docs" / name).write_text(text)
    cfg = Config.model_validate({"site": {"title": "T"}, "content": {"docs": {"dir": "docs"}}, **config})
    compiler = Compiler(cfg, base_path=tmp_path)
    result = compiler.compile(tmp_path / "out")
    assert result.success, result.error
    return compiler, tmp_path / "out"


def source(out, slug):
    return (out / "docs" / f"{slug}.source.md").read_text()


def nav_items(out):
    def walk(items):
        for i in items:
            yield i
            yield from walk(i.get("children", []))
    return list(walk(json.loads((out / "docs-nav.json").read_text())["items"]))


def test_endpoint_ref_forms():
    assert endpoint_ref("GET /users") == (None, "GET", "/users")
    assert endpoint_ref("spec.yaml post /users") == ("spec.yaml", "POST", "/users")
    assert endpoint_ref("webhook newPet") == (None, "webhook", "newPet")
    assert endpoint_ref("guide/setup") is None and endpoint_ref("Get started") is None
    assert same_source("./specs/openapi.yaml", "openapi.yaml") and not same_source("a.yaml", "b.yaml")
    assert FRONTMATTER_TYPES["openapi"] == FRONTMATTER_TYPES["api"] == "a string"


def test_openapi_front_matter_joins_the_operation_to_the_page(tmp_path):
    page = "---\nopenapi: \"GET /pets\"\nplayground: simple\n---\n\n# Listing pets\n\nOur own words.\n"
    _, out = build(tmp_path, {"guide/list.md": page}, api={"openapi": "openapi.yaml"})
    text = source(out, "guide/list")
    assert text.index("# Listing pets") < text.index('<ApiPlayground method="GET" path="/pets" />') \
        < text.index("Our own words.") < text.index('<ParamField query="limit"')
    assert "Lists every pet." not in text.split("---", 2)[2]  # the page has its own text
    assert 'description: "Lists every pet."' in text and '"listPets"' in text  # filled-in front matter
    assert "<RequestExample>" in text and "[OpenAPI spec](/openapi/openapi.json)" in text
    assert not (out / "docs/api-reference/pets/list-pets.source.md").exists()  # the page took it over
    assert not (out / "openapi/try/guide/list.json").exists()  # playground: simple
    assert "`GET` `/pets`" in (out / "docs/guide/list.md").read_text()  # agent .md


def test_openapi_front_matter_with_spec_file_and_webhook(tmp_path):
    pages = {"a.md": "---\nopenapi: openapi.yaml GET /pets/{id}\n---\n",
             "b.md": "---\nopenapi: webhook newPet\n---\n"}
    _, out = build(tmp_path, pages)  # the spec is named only by the page: loaded and published
    a = source(out, "a")
    assert 'title: "Get a pet"' in a and 'src="/openapi/try/a.json"' in a
    assert json.loads((out / "openapi/try/a.json").read_text())["path"] == "/pets/{id}"
    assert (out / "openapi/openapi.json").exists()
    assert "webhook `newPet`" in source(out, "b") and not (out / "openapi/try/b.json").exists()
    assert not (out / "docs/api-reference").exists()  # no generated pages: no spec in the config


def test_api_front_matter_without_a_spec(tmp_path):
    page = """---
title: Create user
api: "POST /v1/orgs/{org}/users"
---

<ParamField body="name" type="string" placeholder="Ada" required>Name.</ParamField>
<ParamField body="age" type="integer" default="3">Age.</ParamField>
<ParamField query="dry" type="boolean">Dry run.</ParamField>

```markdown
<ParamField query="ignored" type="string">In code.</ParamField>
```
"""
    _, out = build(tmp_path, {"users.md": page},
                   api={"server": "https://api.example.com", "auth": {"method": "key", "name": "X-Key"}})
    text = source(out, "users")
    assert '<ApiPlayground method="POST" path="/v1/orgs/{org}/users" src="/openapi/try/users.json" />' in text
    assert "Server: `https://api.example.com`" in text
    data = json.loads((out / "openapi/try/users.json").read_text())
    assert data["servers"] == [{"url": "https://api.example.com"}]
    params = {p["name"]: p for p in data["params"]}
    assert set(params) == {"dry", "org"}
    assert params["org"]["required"] and params["dry"]["enum"] == ["true", "false"]
    assert data["auth"] == [[{"id": "key", "type": "apiKey", "in": "header", "name": "X-Key"}]]
    assert json.loads(data["body"]["example"]) == {"name": "Ada", "age": 3}


def test_navigation_lists_endpoints(tmp_path):
    nav = {"groups": [
        {"group": "Pets", "openapi": "openapi.yaml", "pages": ["GET /pets/{id}", "webhook newPet"]},
        {"group": "More", "pages": ["guide/list", "openapi.yaml POST /pets"]},
    ]}
    page = "---\nopenapi: GET /pets\n---\n\n# Listing\n"
    _, out = build(tmp_path, {"guide/list.md": page}, navigation=nav)
    items = {i["title"]: i for i in nav_items(out)}
    pets, more = items["Pets"], items["More"]
    assert [c["path"] for c in pets["children"]] == ["/docs/reference/fetch", "/docs/api-reference/webhooks/new-pet"]
    assert [c["path"] for c in more["children"]] == ["/docs/guide/list", "/docs/api-reference/pets/create-pet"]
    assert "API Reference" not in items  # only the listed operations, where listed


def test_x_aiui_metadata_and_content(tmp_path):
    _, out = build(tmp_path, {}, api={"openapi": "openapi.yaml"})
    text = source(out, "api-reference/pets/create-pet")
    assert 'title: "Add a pet"' in text and 'sidebarTitle: "Add"' in text and '"og:title": "Pets"' in text
    assert '<ApiPlayground method="POST" path="/pets" />' in text  # playground: simple
    assert text.index("<ApiPlayground") < text.index("<Note>Needs a key.</Note>") < text.index("## Response")
    item = next(i for i in nav_items(out) if i.get("path") == "/docs/api-reference/pets/create-pet")
    assert (item["title"], item["tag"]) == ("Add", "NEW")
    assert any(i.get("path") == "/docs/reference/fetch" and i["title"] == "Fetch" for i in nav_items(out))


def test_validate_names_unknown_operations(tmp_path):
    nav = {"groups": [{"group": "G", "pages": ["index", "GET /nothing"]}]}
    compiler, _ = build(tmp_path, {"bad.md": "---\ntitle: B\nopenapi: \"GET /nope\"\n---\nText.\n",
                                   "worse.md": "---\napi: users\n---\nText.\n"},
                        api={"openapi": "openapi.yaml"}, navigation=nav)
    found = {(i.file, i.line, i.message) for i in compiler.lint_content() if i.code == 7012}
    assert found == {
        ("docs/bad.md", 3, "openapi: 'GET /nope' matches no operation in the OpenAPI specs"),
        ("docs/worse.md", 2, "api: 'users' should be 'METHOD /path'"),
        ("aiui.yaml", 0, "navigation: 'GET /nothing' matches no operation in the OpenAPI specs"),
    }
