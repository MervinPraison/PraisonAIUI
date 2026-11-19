"""Try it authentication and file bodies: the security schemes the build publishes in
openapi/try/<page>.json, the Authorization section on endpoint pages, file inputs
(multipart parts, a binary body, base64 JSON fields) and the ``auth`` display mode."""

import json

import pytest

from praisonaiui.compiler.openapi import load_spec
from praisonaiui.compiler.openapi_pages import bar, page_markdown
from praisonaiui.compiler.playground import playground_data
from praisonaiui.schema.models import Config

SPEC = """
openapi: 3.1.0
info: {title: Keys, version: "1"}
servers: [{url: "https://api.example.com"}]
security: [{token: []}]
components:
  securitySchemes:
    token: {type: http, scheme: bearer, bearerFormat: JWT, x-default: t-0, description: From the console.}
    basic: {type: http, scheme: basic}
    header: {type: apiKey, in: header, name: X-Key}
    query: {type: apiKey, in: query, name: key}
    cookie: {type: apiKey, in: cookie, name: sid}
    oauth: {type: oauth2, flows: {implicit: {authorizationUrl: "https://a.example.com", scopes: {read: r, write: w}}}}
    tls: {type: mutualTLS}
paths:
  /me:
    get:
      operationId: me
      responses: {"200": {description: ok}}
  /pets:
    post:
      operationId: addPet
      security: [{header: [], query: []}, {oauth: [read, write]}, {}]
      requestBody: {content: {application/json: {schema: {type: object, properties: {
        name: {type: string}, photo: {type: string, format: byte}, thumb: {type: string, contentEncoding: base64url}}}}}}
      responses: {"201": {description: ok}}
  /photos:
    put:
      operationId: putPhoto
      security: [{basic: [], cookie: [], tls: []}]
      requestBody: {required: true, content: {image/png: {schema: {type: string, format: binary}}}}
      responses: {"204": {description: done}}
  /upload:
    post:
      operationId: upload
      security: []
      requestBody: {content: {multipart/form-data: {schema: {type: object, properties: {
        title: {type: string}, file: {type: string, format: binary}, raw: {type: string, contentMediaType: image/png}}}}}}
      responses: {"204": {description: done}}
"""


@pytest.fixture
def spec(tmp_path):
    (tmp_path / "s.yaml").write_text(SPEC)
    s = load_spec("s.yaml", tmp_path)
    assert s.ok, s.issues
    return s


def operation(spec, operation_id):
    return next(o for o in spec.operations if o.operation_id == operation_id)


def test_try_data_lists_the_security_alternatives(spec):
    token = {"id": "token", "type": "http", "scheme": "bearer", "description": "From the console.",
             "format": "JWT", "default": "t-0"}
    assert playground_data(spec, operation(spec, "me"))["auth"] == [[token]]  # the document's security
    assert playground_data(spec, operation(spec, "addPet"))["auth"] == [
        [{"id": "header", "type": "apiKey", "in": "header", "name": "X-Key"},
         {"id": "query", "type": "apiKey", "in": "query", "name": "key"}],
        [{"id": "oauth", "type": "oauth2", "scopes": ["read", "write"]}],
        [],  # {}: sending no credentials works too
    ]
    # basic and a cookie key are sent together; a browser cannot send mutual TLS, so it is left out
    assert playground_data(spec, operation(spec, "putPhoto"))["auth"] == [
        [{"id": "basic", "type": "http", "scheme": "basic"}, {"id": "cookie", "type": "apiKey", "in": "cookie", "name": "sid"}]]
    assert "auth" not in playground_data(spec, operation(spec, "upload"))  # security: [] turns it off


def test_try_data_marks_file_inputs(spec):
    form = playground_data(spec, operation(spec, "upload"))["body"]
    assert form["type"] == "multipart/form-data" and form["files"] == ["file", "raw"]
    assert set(json.loads(form["example"])) == {"title", "file", "raw"}
    binary = playground_data(spec, operation(spec, "putPhoto"))["body"]
    assert binary == {"type": "image/png", "example": "", "required": True, "file": True}
    encoded = playground_data(spec, operation(spec, "addPet"))["body"]
    assert encoded["base64"] == {"photo": "base64", "thumb": "base64url"} and "files" not in encoded


def test_endpoint_pages_have_an_authorization_section(spec):
    text = page_markdown(spec, operation(spec, "me"), "Me", "Me")
    assert text.index("## Authorization") < text.index("## Response")
    assert '<ParamField header="Authorization" type="string" required>' in text
    assert "Bearer token (JWT), sent as `Bearer <token>`." in text and "From the console." in text
    pets = page_markdown(spec, operation(spec, "addPet"), "Add", "Add")
    assert "Any one of: `header` and `query`, `oauth`, none." in pets
    assert '<ParamField header="X-Key" type="string">' in pets and '<ParamField query="key" type="string">' in pets
    assert "OAuth 2.0 access token, sent as `Bearer <token>`." in pets and "Scopes: `read`, `write`." in pets
    photo = page_markdown(spec, operation(spec, "putPhoto"), "Photo", "Photo")
    assert "`Basic <encoded-value>`" in photo and "API key, sent as the `sid` cookie." in photo
    assert '<ParamField header="sid" type="string" required>' in photo
    assert "## Authorization" not in page_markdown(spec, operation(spec, "upload"), "Up", "Up")


def test_auth_display_mode_keeps_try_it_for_signed_in_readers(tmp_path, spec):
    assert bar("GET", "/me", "auth", "/t.json") == ['<ApiPlayground method="GET" path="/me" src="/t.json" display="auth" />', ""]
    assert bar("GET", "/me", "simple", "/t.json") == ['<ApiPlayground method="GET" path="/me" />', ""]
    from praisonaiui.compiler.compiler import Compiler
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "index.md").write_text("# Home\n")
    (tmp_path / "s.yaml").write_text(SPEC)
    config = Config.model_validate({"site": {"title": "T"}, "content": {"docs": {"dir": "./docs"}},
                                    "api": {"openapi": "s.yaml", "playground": {"display": "auth"}}})
    result = Compiler(config, base_path=tmp_path).compile(tmp_path / "out")
    assert result.success, result.error
    data = json.loads((tmp_path / "out/openapi/try/api-reference/me.json").read_text())
    assert data["auth"][0][0]["id"] == "token"
    src = (tmp_path / "out/docs/api-reference/me.source.md").read_text()
    assert 'src="/openapi/try/api-reference/me.json" display="auth"' in src
