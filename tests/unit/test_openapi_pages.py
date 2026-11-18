"""Endpoint pages from OpenAPI specs: pages, slugs, nav placement, llms, search, api-catalog."""

import json
import textwrap

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config

SPEC = """
openapi: 3.2.0
info: {title: Pet Store, version: "1"}
servers: [{url: "https://{env}.example.com/v1", variables: {env: {default: api}}}]
tags:
  - {name: store, summary: Store}
  - {name: pets, x-displayName: Pets, parent: store}
  - {name: users, x-group: People, x-displayName: Ignored}
  - {name: beta, kind: badge}
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      tags: [beta, pets]
      parameters: [{name: limit, in: query, required: true, schema: {type: integer, default: 20}}]
      responses:
        "200":
          description: A page of pets
          content: {application/json: {schema: {type: array, items: {$ref: "#/components/schemas/Pet"}}}}
    post:
      operationId: createPet
      tags: [pets]
      deprecated: true
      requestBody: {content: {application/json: {schema: {$ref: "#/components/schemas/Pet"}}}}
      callbacks:
        adopted:
          "{$request.body#/url}":
            post: {summary: Adopted, responses: {"200": {description: ok}}}
      responses: {"201": {description: Created}}
  /pets/{petId}:
    parameters: [{name: petId, in: path, required: true, schema: {type: string}}]
    get: {operationId: getPet, summary: Get a pet, tags: [pets], responses: {"200": {description: ok}}}
    put: {operationId: getPet2, summary: Get a pet, tags: [pets], x-mint: {href: /../Reference/put-pet},
          responses: {"200": {description: ok}}}
    delete: {operationId: deletePet, tags: [pets], x-hidden: true, responses: {"204": {description: gone}}}
  /users: {get: {operationId: listUsers, tags: [users], responses: {"200": {description: ok}}}}
  /secret: {get: {operationId: secretThing, x-excluded: true, responses: {"200": {description: x}}}}
  /health: {get: {summary: Health, responses: {"200": {description: ok}}}}
webhooks:
  newPet: {post: {summary: New Pet Added, requestBody: {content: {application/json: {schema:
    {$ref: "#/components/schemas/Pet"}}}}, responses: {"200": {description: ok}}}}
components:
  schemas:
    Named:
      type: object
      required: [name]
      properties: {name: {type: string, description: "Its <Name>"}, kind: {type: string, enum: [cat, dog]}}
    Pet:
      allOf:
        - $ref: "#/components/schemas/Named"
        - properties: {id: {type: integer, readOnly: true}, parent: {$ref: "#/components/schemas/Pet"}}
"""


def build(tmp_path, config: dict, spec: str = SPEC):
    (tmp_path / "docs/api-reference/pets").mkdir(parents=True)
    (tmp_path / "docs/index.md").write_text("# Home\n\nWelcome to the docs site.\n")
    (tmp_path / "docs/api-reference/pets/list-pets.md").write_text("# Mine\n\nA hand-written page.\n")
    (tmp_path / "openapi.yaml").write_text(textwrap.dedent(spec))
    config = {"site": {"title": "Pets"}, "content": {"docs": {"dir": "./docs"}}, **config}
    out = tmp_path / "out"
    result = Compiler(Config.model_validate(config), base_path=tmp_path).compile(out)
    assert result.success, result.error
    return out


def tree(items, depth=0):
    """docs-nav items as indented lines: title, path, [hidden]."""
    return [line for i in items for line in [
        "  " * depth + f"{i['title']} {i.get('path', '')}{' hidden' if i.get('hidden') else ''}".rstrip(),
        *tree(i.get("children", []), depth + 1)]]


def test_api_openapi_pages_nav_slugs_and_visibility(tmp_path):
    out = build(tmp_path, {"api": {"openapi": "openapi.yaml"}})
    nav = json.loads((out / "docs-nav.json").read_text())["items"]
    assert tree(nav) == [
        "Home /docs/index",
        "Pets",  # the hand-written page's folder
        "  Mine /docs/api-reference/pets/list-pets",
        "API Reference",
        "  Health /docs/api-reference/health",  # untagged: in the group itself
        "  Store",  # 3.2 tag summary; `pets` nests under its parent
        "    Pets",  # x-displayName
        "      List pets /docs/api-reference/pets/list-pets-2",  # never replaces a hand-written page
        "      Create pet /docs/api-reference/pets/create-pet",  # no summary: from the operationId
        "      Get a pet /docs/api-reference/pets/get-pet",
        "      Get a pet /docs/reference/put-pet",  # x-mint.href
        "  People",  # x-group wins over x-displayName
        "    List users /docs/api-reference/users/list-users",
        "  Webhooks",
        "    New Pet Added /docs/api-reference/webhooks/new-pet-added",  # title keeps its case
        "Delete pet /docs/api-reference/pets/delete-pet hidden",  # x-hidden: built, not listed
    ]
    assert not list(out.glob("docs/**/secret-thing*"))  # x-excluded: no page
    published = json.loads((out / "openapi/openapi.json").read_text())
    assert "/secret" not in published["paths"] and "/pets" in published["paths"]


def test_endpoint_page_source_and_agent_markdown(tmp_path):
    out = build(tmp_path, {"api": {"openapi": "openapi.yaml"}})
    src = (out / "docs/api-reference/pets/create-pet.source.md").read_text()
    assert src.startswith('---\ntitle: "Create pet"\n') and "\n# Create pet\n\n`POST` `/pets`\n" in src
    assert "Server: `https://api.example.com/v1`" in src
    assert "<Warning>This endpoint is deprecated.</Warning>" in src
    assert '<ParamField body="name" type="string" required>\n  Its &lt;Name>\n' in src  # allOf merged
    assert "Available options: `cat`, `dog`" in src
    assert '<ParamField body="id"' not in src  # readOnly: not in a request
    assert '<ParamField body="parent" type="Pet">\n  <Expandable title="parent properties">' in src
    assert src.count('body="parent"') == 2  # a recursive schema stops one level down
    assert "## Callbacks\n\n### adopted\n\n`POST` `{$request.body#/url}`" in src
    assert "[OpenAPI spec](/openapi/openapi.json)" in src
    listing = (out / "docs/api-reference/pets/list-pets-2.source.md").read_text()
    assert '<ParamField query="limit" type="integer" required default="20">' in listing
    assert '<ResponseField name="response" type="Pet[]">' in listing
    hook = (out / "docs/api-reference/webhooks/new-pet-added.source.md").read_text()
    assert "## Payload" in hook and '<ParamField body="id"' in hook
    md = (out / "docs/api-reference/pets/create-pet.md").read_text()
    assert md.startswith("# Create pet\n\n> POST /pets\n")
    assert "- `name` (body, string, required): Its &lt;Name>" in md and "<ParamField" not in md
    assert "(/openapi/openapi.json)" in md


def test_llms_search_and_api_catalog(tmp_path):
    out = build(tmp_path, {"api": {"openapi": "openapi.yaml"}, "seo": {"site_url": "https://docs.example.com"}})
    llms = (out / "llms.txt").read_text()
    assert "## API Reference\n" in llms
    assert "- [List pets](https://docs.example.com/docs/api-reference/pets/list-pets-2.md): GET /pets" in llms
    assert "## OpenAPI specs\n\n- [Pet Store](https://docs.example.com/openapi/openapi.json)" in llms
    assert "delete-pet" not in llms
    pages = {p["p"]: p for p in json.loads((out / "search-index.json").read_text())["pages"]}
    assert pages["/docs/api-reference/pets/list-pets-2"]["k"] == ["GET /pets", "listPets", "limit"]
    assert "/docs/api-reference/pets/delete-pet" not in pages
    catalog = json.loads((out / ".well-known/api-catalog").read_text())["linkset"]
    assert catalog[0]["anchor"] == "https://docs.example.com/.well-known/api-catalog"
    assert catalog[0]["item"] == [{"href": "https://api.example.com/v1"}]
    assert catalog[1]["service-desc"][0]["href"] == "https://docs.example.com/openapi/openapi.json"
    assert catalog[1]["service-doc"][0]["href"] == "https://docs.example.com/docs/api-reference/pets/list-pets-2"


def test_spec_in_tab_and_group_with_directory(tmp_path):
    nav_cfg = {"tabs": [
        {"tab": "Guide", "groups": [{"group": "Guide", "pages": ["index"]}]},
        {"tab": "API", "openapi": "openapi.yaml",
         "groups": [{"group": "Admin", "openapi": {"source": "openapi.yaml", "directory": "admin/v2"}}]},
    ]}
    for mode in ("auto", "manual"):
        config = {"navigation": nav_cfg, "api": {"openapi": "openapi.yaml"},  # named in nav: placed once
                  "content": {"docs": {"dir": "./docs", "nav": {"mode": mode}}}}
        out = build(tmp_path / mode, config)
        lines = tree(json.loads((out / "docs-nav.json").read_text())["items"])
        assert "Admin" in lines and "  Health /docs/admin/v2/health" in lines
        assert "    Pets" in lines and "      Get a pet /docs/admin/v2/pets/get-pet" in lines
        assert "API Reference" in lines and "  Health /docs/api-reference/health" in lines
        assert "Store" in lines and lines.count("API Reference") == 1
        tabs = json.loads((out / "ui-config.json").read_text())["navigation"]["tabs"]
        groups = {g["group"]: g["pages"] for g in tabs[1]["groups"]}
        assert list(groups) == ["Admin", "API Reference", "Store", "People", "Webhooks"]
        assert "admin/v2/pets/get-pet" in groups["Admin"] and groups["API Reference"] == ["api-reference/health"]


def test_tag_problems_are_reported(tmp_path):
    from praisonaiui.compiler.openapi import load_spec

    (tmp_path / "s.yaml").write_text(textwrap.dedent("""
        openapi: 3.2.0
        info: {title: T, version: "1"}
        tags: [{name: a, parent: b}, {name: b, parent: a}, {name: a}, {name: c, parent: nope}]
        paths: {}
    """))
    messages = [i.message for i in load_spec("s.yaml", tmp_path).issues]
    assert "Duplicate tag 'a'" in messages
    assert "Tag 'a': its parents form a cycle" in messages
    assert "Tag 'c': parent 'nope' is not a declared tag" in messages


def test_label_href_links_sit_beside_spec_groups(tmp_path):
    link = {"label": "GitHub", "href": "https://github.com/acme/pets"}
    nav_cfg = {"pages": [link, {"group": "API", "openapi": "openapi.yaml", "pages": [link]}],
               "tabs": [{"tab": "Guide", "groups": [{"group": "Guide", "pages": ["index", link]}]}]}
    for mode in ("auto", "manual"):
        out = build(tmp_path / mode, {"navigation": nav_cfg,
                                      "content": {"docs": {"dir": "./docs", "nav": {"mode": mode}}}})
        lines = tree(json.loads((out / "docs-nav.json").read_text())["items"])
        assert "GitHub" in lines and "  Health /docs/api-reference/health" in lines
