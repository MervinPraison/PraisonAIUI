"""OpenAPI spec loading: versions, $ref bundling, cycles, checks, config, build."""

import json
import re
import textwrap
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from typer.testing import CliRunner

from praisonaiui.cli import app
from praisonaiui.compiler.openapi import load_config_specs, load_spec, spec_sources
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import find_unknown_keys


def write(root, files):
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(textwrap.dedent(text).lstrip(), encoding="utf-8")


SPEC_30 = """
openapi: 3.0.3
info: {title: Pets, version: 2024-01-01}
servers: [{url: https://api.example.com}]
security: [{key: []}]
paths:
  /pets/{petId}:
    parameters:
      - {name: petId, in: path, required: true, schema: {type: string}}
      - {name: trace, in: header, schema: {type: string}}
    get:
      operationId: getPet
      tags: [pets]
      parameters: [{name: trace, in: header, description: mine}]
      responses:
        200:
          content: {application/json: {schema: {$ref: '#/components/schemas/Pet'}, example: {a: 1}}}
    delete: {deprecated: true, security: [], x-hidden: true, responses: {'204': {description: x}}}
  /internal:
    get: {x-excluded: true, servers: [{url: 'http://localhost:9'}], responses: {}}
components:
  schemas:
    Pet:
      properties:
        name: {type: string, nullable: true, example: Rex, enum: [Rex]}
        age: {type: integer, minimum: 0, exclusiveMinimum: true}
        owner: {allOf: [{$ref: '#/components/schemas/Owner'}], nullable: true}
    Owner: {type: object}
"""


def test_openapi_30_yaml_is_normalised_to_31(tmp_path):
    write(tmp_path, {"openapi.yaml": SPEC_30})
    spec = load_spec("openapi.yaml", tmp_path)
    assert spec.ok, [str(i) for i in spec.issues]
    assert (spec.openapi, spec.bundled["openapi"], spec.document["openapi"]) == ("3.0.3",) * 2 + ("3.1.0",)
    assert spec.document["info"]["version"] == "2024-01-01"  # YAML dates stay strings
    props = spec.document["components"]["schemas"]["Pet"]["properties"]
    assert props["name"] == {"type": ["string", "null"], "enum": ["Rex", None], "examples": ["Rex"]}
    assert props["age"] == {"type": "integer", "exclusiveMinimum": 0}
    assert props["owner"]["anyOf"][1] == {"type": "null"}
    assert spec.bundled["components"]["schemas"]["Pet"]["properties"]["name"]["nullable"] is True
    media = spec.document["paths"]["/pets/{petId}"]["get"]["responses"]["200"]["content"]
    assert media["application/json"]["example"] == {"a": 1}  # not a schema: untouched
    get, delete, internal = spec.operations
    assert (get.method, get.path, get.operation_id, get.tag) == ("GET", "/pets/{petId}", "getPet", "pets")
    assert [(p["name"], p.get("description")) for p in get.parameters] == [("petId", None), ("trace", "mine")]
    assert list(get.responses) == ["200"] and get.pointer == "#/paths/~1pets~1{petId}/get"
    assert get.security == [{"key": []}] and get.servers == [{"url": "https://api.example.com"}]
    assert delete.deprecated and delete.hidden and delete.security == []
    assert internal.excluded and internal.servers == [{"url": "http://localhost:9"}]


def test_openapi_31_webhooks_and_32_query_method(tmp_path):
    write(tmp_path, {"a.json": json.dumps({
        "openapi": "3.1.0", "info": {"title": "Hooks", "version": "1"},
        "paths": {"/a": {"$ref": "#/components/pathItems/A"}},
        "webhooks": {"newPet": {"post": {"requestBody": {"$ref": "#/components/requestBodies/P"}}}},
        "components": {"pathItems": {"A": {"get": {}}}, "requestBodies": {"P": {"content": {}}}},
    }), "b.yaml": "openapi: 3.2.0\ninfo: {title: New, version: '1'}\n"
        "paths: {/s: {query: {operationId: q}, additionalOperations: {LINK: {operationId: l}}}}"})
    a = load_spec("a.json", tmp_path)
    assert a.ok and a.document == a.bundled  # 3.1 is not rewritten
    assert [(o.method, o.path, o.webhook) for o in a.operations] == [("GET", "/a", False), ("POST", "newPet", True)]
    assert a.operations[1].request_body == {"content": {}}
    b = load_spec("b.yaml", tmp_path)
    assert b.ok and b.document["openapi"] == "3.2.0"
    assert [(o.method, o.operation_id, o.pointer) for o in b.operations] == [
        ("QUERY", "q", "#/paths/~1s/query"), ("LINK", "l", "#/paths/~1s/additionalOperations/LINK")]


def test_relative_file_refs_are_bundled_into_one_document(tmp_path):
    write(tmp_path, {
        "api/openapi.yaml": "openapi: 3.1.0\ninfo: {title: S, version: '1'}\n"
        "paths: {/pets: {$ref: 'paths/pets.yaml'}}\ncomponents: {schemas: {Error: {type: string}}}",
        "api/paths/pets.yaml": "get: {responses: {"
        "'200': {content: {a/b: {schema: {$ref: '../schemas/pet.yaml', description: A pet}}}},"
        "default: {content: {a/b: {schema: {$ref: '../common.yaml#/components/schemas/Error'}}}}}}",
        "api/schemas/pet.yaml": "properties: {tag: {$ref: '#/$defs/Tag'}}\n$defs: {Tag: {type: string}}",
        "api/common.yaml": "components: {schemas: {Code: {type: integer},"
        "Error: {properties: {code: {$ref: '#/components/schemas/Code'}}}}}",
    })
    spec = load_spec("api/openapi.yaml", tmp_path)
    assert spec.ok, [str(i) for i in spec.issues]
    refs = re.findall(r'"\$ref": "([^"]*)"', json.dumps(spec.bundled))
    assert len(refs) == 2 and all(spec.resolve({"$ref": r}) is not None for r in refs)
    schemas = spec.bundled["components"]["schemas"]
    assert schemas["Error_2"]["properties"]["code"] == {"$ref": "#/components/schemas/Code"}
    ok = spec.operations[0].responses["200"]["content"]["a/b"]["schema"]
    assert ok["description"] == "A pet"  # a whole-file target is inlined
    assert spec.dereference(ok)["properties"]["tag"] == {"type": "string"}


def test_cyclic_refs_stay_finite(tmp_path):
    write(tmp_path, {
        "openapi.yaml": "openapi: 3.1.0\ninfo: {title: C, version: '1'}\ncomponents: {schemas: {"
        "Node: {properties: {kids: {items: {$ref: '#/components/schemas/Node'}}}},"
        "A: {$ref: 'a.yaml#/components/schemas/A'}, Tree: {$ref: 'tree.yaml'}}}",
        "a.yaml": "components: {schemas: {A: {properties: {b: {$ref: 'b.yaml#/components/schemas/B'}}}}}",
        "b.yaml": "components: {schemas: {B: {properties: {a: {$ref: 'a.yaml#/components/schemas/A'}}}}}",
        "tree.yaml": "properties: {kids: {items: {$ref: 'tree.yaml'}}}",
    })
    spec = load_spec("openapi.yaml", tmp_path)
    assert spec.ok, [str(i) for i in spec.issues]
    json.dumps(spec.bundled)  # no Python-level cycle
    schemas = spec.bundled["components"]["schemas"]
    assert schemas["A_2"]["properties"]["b"] == {"$ref": "#/components/schemas/B"}
    assert schemas["B"]["properties"]["a"] == {"$ref": "#/components/schemas/A_2"}
    assert schemas["tree"]["properties"]["kids"]["items"] == {"$ref": "#/components/schemas/tree"}
    node = spec.dereference({"$ref": "#/components/schemas/Node"})
    assert node["properties"]["kids"]["items"] == {"$ref": "#/components/schemas/Node", "x-circular": True}


def test_invalid_specs_report_file_pointer_and_line(tmp_path):
    write(tmp_path, {"bad.yaml": """
        openapi: 3.1.0
        info: {title: Bad}
        paths:
          pets:
            get:
              operationId: list
              responses:
                '200':
                  content:
                    application/json:
                      schema: {$ref: '#/components/schemas/Missing'}
          /b/{id}:
            get: {operationId: list, responses: {'200': {$ref: 'gone.yaml'}}}
    """})
    spec = load_spec("bad.yaml", tmp_path)
    assert {(i.severity, i.message.split(" '")[0].split(" /")[0], i.line) for i in spec.issues} == {
        ("error", "Cannot read", 13), ("error", "$ref", 11), ("error", "Path", 4),
        ("error", "'info' needs a", 2), ("error", "Duplicate operationId", 13), ("warning", "GET", 13),
    }
    assert str(spec.issues[1]).endswith(
        "does not resolve (at #/paths/pets/get/responses/200/content/application~1json/schema)")
    for name, text, expect in (
        ("swagger.yaml", "swagger: '2.0'", "Swagger 2.0"),
        ("old.yaml", "openapi: 4.0.0", "Unsupported"),
        ("syntax.yaml", "openapi: 3.1.0\ninfo: [unclosed\n", "line 3"),
        ("syntax.json", '{"openapi": "3.1.0",\n "info": }', "line 2"),
    ):
        write(tmp_path, {name: text})
        bad = load_spec(name, tmp_path)
        assert not bad.ok and bad.document == {} and expect in str(bad.issues[0]), name


def test_spec_from_localhost_url_resolves_relative_refs(tmp_path):
    write(tmp_path, {"openapi.yaml": "openapi: 3.0.0\ninfo: {title: R, version: '1'}\n"
                     "paths: {/x: {get: {responses: {'200': {$ref: 'parts.yaml#/R'}}}}}",
                     "parts.yaml": "R: {description: from the server}"})
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        spec = load_spec(f"http://127.0.0.1:{server.server_port}/openapi.yaml")
        assert spec.ok and spec.operations[0].responses["200"] == {"description": "from the server"}
    finally:
        server.shutdown()


def test_config_keys_sources_and_one_load_per_spec(tmp_path):
    data = {"site": {"title": "Docs"}, "api": {"openapi": "openapi.yaml"}, "navigation": {"tabs": [{
        "tab": "API", "openapi": ["openapi.yaml", {"source": "v2/openapi.yaml", "directory": "api/v2"}],
        "groups": [{"group": "G", "openapi": {"source": "openapi.yaml"},
                    "pages": [{"group": "Nested", "openapi": "other.json"}]}],
    }]}}
    assert find_unknown_keys(Config, data) == []
    cfg = Config.model_validate(data)
    assert [(r.source, r.directory, r.where) for r in spec_sources(cfg)] == [
        ("openapi.yaml", None, "api.openapi"),
        ("openapi.yaml", None, "navigation.tabs[0].openapi[0]"),
        ("v2/openapi.yaml", "api/v2", "navigation.tabs[0].openapi[1]"),
        ("openapi.yaml", None, "navigation.tabs[0].groups[0].openapi"),
        ("other.json", None, "navigation.tabs[0].groups[0].pages[0].openapi"),
    ]
    spec = "openapi: 3.1.0\ninfo: {title: T, version: '1'}\ncomponents: {}\n"
    write(tmp_path, {"openapi.yaml": spec, "v2/openapi.yaml": spec, "other.json": spec})
    assert [(s, v.slug) for s, v in load_config_specs(cfg, tmp_path).items()] == [
        ("openapi.yaml", "openapi"), ("v2/openapi.yaml", "openapi-2"), ("other.json", "other")]


def test_build_writes_specs_and_validate_reports_errors(tmp_path):
    write(tmp_path, {"docs/index.md": "# Home", "openapi.yaml": SPEC_30, "aiui.yaml": """
        site: {title: Docs}
        content: {docs: {dir: docs}}
        api: {openapi: openapi.yaml}
    """})
    cfg, out = str(tmp_path / "aiui.yaml"), tmp_path / "out"
    res = CliRunner().invoke(app, ["build", "-c", cfg, "-o", str(out)])
    assert res.exit_code == 0, res.output
    assert "/pets/{petId}" in json.loads((out / "openapi/openapi.json").read_text())["paths"]
    assert json.loads((out / "openapi/index.json").read_text()) == {"specs": [{
        "source": "openapi.yaml", "file": "openapi/openapi.json", "title": "Pets",
        "openapi": "3.0.3", "version": "2024-01-01", "operations": 2}]}

    (tmp_path / "openapi.yaml").write_text(SPEC_30.replace("#/components/schemas/Owner", "#/x"))
    res = CliRunner().invoke(app, ["validate", "-c", cfg])
    output = " ".join(res.output.split())  # rich wraps long lines
    assert res.exit_code == 1 and "openapi.yaml:27: $ref '#/x' does not resolve" in output
    res = CliRunner().invoke(app, ["build", "-c", cfg, "-o", str(tmp_path / "o")])
    assert res.exit_code == 3 and "does not resolve" in " ".join(res.output.split())
