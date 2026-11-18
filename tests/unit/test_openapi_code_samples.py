"""Request examples on endpoint pages: generated samples per language, auth, params,
bodies, the spec's own x-codeSamples, and the ``api.examples.languages`` setting."""

import ast
import json
import re
import shlex
import textwrap

import pytest
from pydantic import ValidationError

from praisonaiui.compiler.code_samples import LANGUAGES, request_examples
from praisonaiui.compiler.openapi import load_spec
from praisonaiui.compiler.openapi_pages import page_markdown
from praisonaiui.schema.models import ApiExamplesConfig, Config

SPEC = """
openapi: 3.1.0
info: {title: Pets, version: "1"}
servers: [{url: "https://{env}.example.com/v1", variables: {env: {default: api}}}]
security: [{bearer: []}]
paths:
  /pets/{petId}/toys/{toyId}:
    post:
      operationId: addToy
      parameters:
        - {name: petId, in: path, required: true, schema: {type: string}, example: "p 1"}
        - {name: toyId, in: path, required: true, schema: {type: string}}
        - {name: limit, in: query, required: true, schema: {type: integer}}
        - {name: tags, in: query, schema: {type: array, items: {type: string}}, example: [a, b]}
        - {name: skip, in: query, schema: {type: integer}}
        - {name: X-Trace, in: header, required: true, schema: {type: string}}
        - {name: session, in: cookie, schema: {type: string}, example: abc}
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name: {type: string, example: "Tom's `cat`"}
                id: {type: integer, readOnly: true}
                ok: {type: boolean}
                gone: {type: "null"}
      responses: {"200": {description: ok, content: {application/json: {example: {ok: true}}}}}
  /upload:
    put:
      operationId: upload
      security: [{key: []}]
      requestBody:
        content:
          multipart/form-data:
            schema: {type: object, properties: {file: {type: string, format: binary}, note: {type: string}}}
      x-codeSamples:
        - {lang: Python, label: SDK, source: "client.upload(open('f'))"}
        - {lang: Kotlin, source: "client.upload()"}
        - {lang: go}
      responses: {"200": {description: ok}}
  /search:
    query:
      operationId: search
      security: [{basic: []}, {}]
      x-code-samples: [{lang: shell, source: "pets search"}]
      responses: {"200": {description: ok}}
  /open:
    get:
      operationId: open
      security: []
      servers: [{url: /v2}]
      parameters: [{name: X-Key, in: header, schema: {type: string}},
                   {name: Accept, in: header, required: true, schema: {type: string}}]
      responses: {"200": {description: ok}}
webhooks:
  newPet: {post: {requestBody: {content: {application/json: {schema: {type: object}}}},
                  responses: {"200": {description: ok}}}}
components:
  securitySchemes:
    bearer: {type: http, scheme: bearer}
    basic: {type: http, scheme: basic}
    key: {type: apiKey, in: query, name: api_key}
"""


@pytest.fixture
def spec(tmp_path):
    (tmp_path / "s.yaml").write_text(textwrap.dedent(SPEC))
    s = load_spec("s.yaml", tmp_path)
    assert s.ok, s.issues
    return s


def op(spec, operation_id):
    return next(o for o in spec.operations if o.operation_id == operation_id)


def fences(lines: list[str]) -> dict[str, str]:
    """``{tab title: code}`` of a ``<RequestExample>``."""
    text = "\n".join(lines)
    return {m[2]: m[3] for m in re.finditer(r'^(`{3,})\S* title="([^"]*)"\n(.*?)\n\1$', text, re.S | re.M)}


def test_default_languages_sit_before_the_response_example(spec):
    src = page_markdown(spec, op(spec, "addToy"), "Add a toy", "Add")
    assert src.index("<RequestExample>") < src.index("<ResponseExample>")
    assert list(fences(request_examples(spec, op(spec, "addToy")))) == ["cURL", "Python", "JavaScript"]
    webhook = next(o for o in spec.operations if o.webhook)
    assert request_examples(spec, webhook) == []


def test_curl_sends_server_params_auth_and_body(spec):
    curl = fences(request_examples(spec, op(spec, "addToy"), ["curl"]))["cURL"]
    args = shlex.split(curl.replace("\\\n", " "))
    url = args[args.index("--url") + 1]
    # server variables filled, an example path value encoded, one without left as {toyId};
    # required query params and those with an example, array params repeated
    assert url == "https://api.example.com/v1/pets/p%201/toys/{toyId}?limit=123&tags=a&tags=b"
    headers = [args[i + 1] for i, a in enumerate(args) if a == "--header"]
    assert headers == ["Authorization: Bearer <token>", "X-Trace: <string>", "Cookie: session=abc",
                       "Content-Type: application/json"]
    # the body: JSON from the schema, readOnly fields left out, quotes survive the shell
    assert json.loads(args[args.index("--data") + 1]) == {"name": "Tom's `cat`", "ok": True, "gone": None}


def test_every_language_sends_the_same_request(spec):
    samples = fences(request_examples(spec, op(spec, "addToy"), list(LANGUAGES)))
    assert list(samples) == [label for label, _ in LANGUAGES.values()]
    url = "https://api.example.com/v1/pets/p%201/toys/{toyId}?limit=123&tags=a&tags=b"
    for label, code in samples.items():
        assert url in code and "Bearer <token>" in code and "X-Trace" in code, label
        assert "Tom" in code and "POST" in code.upper(), label
    ast.parse(samples["Python"])  # valid Python
    assert "requests.post(url, json=payload, headers=headers)" in samples["Python"]
    assert '"gone": None' in samples["Python"] and '"ok": True' in samples["Python"]
    assert "body: JSON.stringify({" in samples["JavaScript"]
    assert 'payload := strings.NewReader("{' in samples["Go"]  # a backtick in the body: a quoted string
    assert '.method("POST", HttpRequest.BodyPublishers.ofString("""' in samples["Java"]
    assert "Net::HTTP::Post.new(url)" in samples["Ruby"] and "<<~'BODY'" in samples["Ruby"]
    assert "CURLOPT_CUSTOMREQUEST => 'POST'" in samples["PHP"]
    assert 'request.Headers.Add("Content-Type"' not in samples["C#"]  # set on the content instead
    assert '.json(&json!({' in samples["Rust"] and ".post(" in samples["Rust"]
    assert 'request.httpBody = #"""' in samples["Swift"]


def test_auth_schemes_and_servers(spec):
    search = fences(request_examples(spec, op(spec, "search"), ["python", "curl"]))
    assert "Basic <encoded-value>" in search["Python"]
    assert 'requests.request("QUERY", url, headers=headers)' in search["Python"]
    opened = fences(request_examples(spec, op(spec, "open")))["cURL"]
    # a relative server joins the placeholder host; no auth; an optional header without example
    # and an Accept header (OpenAPI ignores it) are left out
    assert "--url 'https://api.example.com/v2/open'" in opened and "--header" not in opened


def test_spec_samples_come_first_and_replace_their_language(spec):
    samples = fences(request_examples(spec, op(spec, "upload")))
    # Python's own sample replaces the generated one; Kotlin adds one; an entry without source is skipped
    assert list(samples) == ["SDK", "Kotlin", "cURL", "JavaScript"]
    assert '```kotlin title="Kotlin"' in "\n".join(request_examples(spec, op(spec, "upload")))
    # multipart: a file field becomes a file; languages without a form-data sample are left out
    assert "--form 'file=@example-file'" in samples["cURL"] and "?api_key=<api-key>" in samples["cURL"]
    assert "Go" not in fences(request_examples(spec, op(spec, "upload"), ["go"]))
    # x-code-samples works too, and its shell sample stands in for cURL
    assert list(fences(request_examples(spec, op(spec, "search")))) == ["cURL", "Python", "JavaScript"]
    assert fences(request_examples(spec, op(spec, "search")))["cURL"] == "pets search"
    # [] keeps only the spec's own samples; nothing at all: no RequestExample
    assert list(fences(request_examples(spec, op(spec, "upload"), []))) == ["SDK", "Kotlin"]
    assert request_examples(spec, op(spec, "addToy"), []) == []


def test_python_multipart_sample_is_valid(spec):
    code = fences(request_examples(spec, op(spec, "upload"), ["python"]))["SDK"]
    assert code == "client.upload(open('f'))"
    from praisonaiui.compiler.code_samples import _python, build_request
    generated = _python(build_request(spec, op(spec, "upload")))
    ast.parse(generated)
    assert '"file": open("example-file", "rb")' in generated and "files=files" in generated


def test_languages_setting():
    assert ApiExamplesConfig().languages == ["curl", "python", "javascript"]
    assert ApiExamplesConfig(languages=["Node", "shell", "c#", "node"]).languages == ["javascript", "curl", "csharp"]
    assert ApiExamplesConfig(languages="all").languages == list(LANGUAGES)
    with pytest.raises(ValidationError, match="unknown language cobol"):
        ApiExamplesConfig(languages=["cobol"])


def test_compiler_reads_api_examples_languages(tmp_path):
    from praisonaiui.compiler.compiler import Compiler

    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/index.md").write_text("# Home\n\nWelcome.\n")
    (tmp_path / "s.yaml").write_text(textwrap.dedent(SPEC))
    config = Config.model_validate({"site": {"title": "T"}, "content": {"docs": {"dir": "./docs"}},
                                    "api": {"openapi": "s.yaml", "examples": {"languages": ["go", "ruby"]}}})
    result = Compiler(config, base_path=tmp_path).compile(tmp_path / "out")
    assert result.success, result.error
    src = (tmp_path / "out/docs/api-reference/add-toy.source.md").read_text()
    assert '```go title="Go"' in src and '```ruby title="Ruby"' in src and 'title="cURL"' not in src
    md = (tmp_path / "out/docs/api-reference/add-toy.md").read_text()
    assert "**Request example**" in md and "http.NewRequest(" in md  # the agent export keeps the samples
