"""Try it on endpoint pages: the data the build publishes (openapi/try/<page>.json),
the endpoint bar in the page source, the display modes and prefill."""

import json

import pytest
from pydantic import ValidationError

from praisonaiui.compiler import agent_markdown as am
from praisonaiui.compiler.content_lint import FRONTMATTER_TYPES
from praisonaiui.compiler.docs_tags import KNOWN_DOCS_TAGS
from praisonaiui.compiler.openapi import load_spec
from praisonaiui.compiler.openapi_pages import page_markdown
from praisonaiui.compiler.playground import playground_data, playground_mode
from praisonaiui.schema.models import ApiConfig, Config

SPEC = """
openapi: 3.1.0
info: {title: Pets, version: "1"}
servers:
  - {url: "https://{env}.example.com/v1", description: Production, variables: {env: {default: api, enum: [api, b]}}}
  - {url: /local}
paths:
  /pets/{petId}:
    post:
      operationId: updatePet
      parameters:
        - {name: petId, in: path, required: true, schema: {type: integer}, example: 7}
        - {name: verbose, in: query, schema: {type: boolean}}
        - {name: tags, in: query, schema: {type: array, items: {type: string}}, example: [a, b]}
        - {name: X-Trace, in: header, schema: {type: string, x-default: t-1, example: t-9}}
        - {name: Content-Type, in: header, schema: {type: string}}
        - {name: session, in: cookie, schema: {type: string}}
      requestBody:
        required: true
        content: {application/json: {schema: {type: object, properties: {
          name: {type: string, x-default: Rex, example: Fido}, id: {type: integer, readOnly: true}}}}}
      responses: {"200": {description: ok}}
  /upload:
    put:
      operationId: upload
      requestBody: {content: {multipart/form-data: {schema: {type: object, properties: {
        title: {type: string, example: Cover}, file: {type: string, format: binary}}}}}}
      responses: {"204": {description: done}}
webhooks:
  petAdded: {post: {requestBody: {content: {application/json: {schema: {type: object}}}}, responses: {"200": {description: ok}}}}
"""


@pytest.fixture
def spec(tmp_path):
    (tmp_path / "s.yaml").write_text(SPEC)
    s = load_spec("s.yaml", tmp_path)
    assert s.ok, s.issues
    return s


def operation(spec, operation_id):
    return next(o for o in spec.operations if o.operation_id == operation_id)


def test_data_has_servers_params_and_body(spec):
    data = playground_data(spec, operation(spec, "updatePet"))
    assert (data["method"], data["path"], data["prefill"]) == ("POST", "/pets/{petId}", True)
    assert data["servers"] == [{"url": "https://{env}.example.com/v1", "description": "Production",
                                "variables": {"env": {"default": "api", "enum": ["api", "b"]}}}, {"url": "/local"}]
    params = {p["name"]: p for p in data["params"]}
    assert "Content-Type" not in params  # set by the request itself
    assert params["petId"] == {"name": "petId", "in": "path", "type": "integer", "required": True, "example": "7"}
    assert params["verbose"]["enum"] == ["true", "false"] and "example" not in params["verbose"]
    assert params["tags"]["array"] is True and params["tags"]["example"] == "a,b"
    assert params["X-Trace"]["example"] == "t-1"  # x-default wins over example
    assert params["session"]["in"] == "cookie"
    assert data["body"]["type"] == "application/json" and data["body"]["required"] is True
    assert json.loads(data["body"]["example"]) == {"name": "Rex"}  # x-default; readOnly left out
    upload = playground_data(spec, operation(spec, "upload"), prefill=False)
    assert upload["prefill"] is False and upload["body"]["type"] == "multipart/form-data"
    assert json.loads(upload["body"]["example"])["title"] == "Cover"


def test_page_shows_the_endpoint_bar_per_mode(spec):
    op = operation(spec, "updatePet")
    live = page_markdown(spec, op, "Update", "d", src="/openapi/try/a/update-pet.json")
    assert '<ApiPlayground method="POST" path="/pets/{petId}" src="/openapi/try/a/update-pet.json" />' in live
    assert "Servers: `https://api.example.com/v1`, `/local`" in live
    simple = page_markdown(spec, op, "Update", "d", playground="simple", src="/x.json")
    assert '<ApiPlayground method="POST" path="/pets/{petId}" />' in simple
    none = page_markdown(spec, op, "Update", "d", playground="none")
    assert "<ApiPlayground" not in none and "`POST` `/pets/{petId}`" in none
    hook = next(o for o in spec.operations if o.webhook)
    assert "<ApiPlayground" not in page_markdown(spec, hook, "Pet added", "d")
    text = am.to_agent_markdown(live, title="Update", description="", page_dir="/docs", docs_base="/docs", site="")
    assert "`POST` `/pets/{petId}`" in text and "ApiPlayground" not in text and "update-pet.json" not in text


def test_mode_setting_and_front_matter():
    assert playground_mode() == "interactive"
    api = ApiConfig.model_validate({"playground": {"display": "simple"}})
    assert playground_mode(api) == "simple"
    assert playground_mode(api, {"playground": "none"}) == "none"
    assert playground_mode(api, {"playground": "bogus"}) == "simple"
    assert playground_mode(api, {"playground": "auth"}) == "auth"
    with pytest.raises(ValidationError):
        ApiConfig.model_validate({"playground": {"display": "signed-in"}})
    assert ApiConfig.model_validate({"examples": {"prefill": False}}).examples.prefill is False
    assert "playground" in FRONTMATTER_TYPES and "ApiPlayground" in KNOWN_DOCS_TAGS


@pytest.mark.parametrize("api", [{"examples": {"prefill": False}}, {"playground": {"display": "simple"}}])
def test_build_publishes_try_data(tmp_path, api):
    from praisonaiui.compiler.compiler import Compiler

    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/index.md").write_text("# Home\n\nWelcome.\n")
    (tmp_path / "s.yaml").write_text(SPEC)
    config = Config.model_validate({"site": {"title": "T"}, "content": {"docs": {"dir": "./docs"}},
                                    "api": {"openapi": "s.yaml", **api}})
    result = Compiler(config, base_path=tmp_path).compile(tmp_path / "out")
    assert result.success, result.error
    src = (tmp_path / "out/docs/api-reference/update-pet.source.md").read_text()
    if "playground" in api:  # simple: the bar alone, no data
        assert not (tmp_path / "out/openapi/try").exists()
        assert '<ApiPlayground method="POST" path="/pets/{petId}" />' in src
        return
    data = json.loads((tmp_path / "out/openapi/try/api-reference/update-pet.json").read_text())
    assert data["path"] == "/pets/{petId}" and data["prefill"] is False
    assert 'src="/openapi/try/api-reference/update-pet.json"' in src
    assert not list((tmp_path / "out/openapi/try").rglob("*pet-added*"))  # webhooks: nothing to send
