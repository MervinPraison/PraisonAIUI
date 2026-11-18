"""Endpoint page schemas: oneOf/anyOf tabs, nullable, constraints, conditional
requirements, api.params.expanded and response examples by content type."""

import textwrap

from praisonaiui.compiler.agent_markdown import to_agent_markdown
from praisonaiui.compiler.openapi import load_spec
from praisonaiui.compiler.openapi_pages import page_markdown

SPEC = """
openapi: 3.0.3
info: {title: Pay, version: "1"}
paths:
  /pay:
    post:
      operationId: pay
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [method]
              properties:
                method: {type: string, enum: [card, bank]}
                card_number: {type: string, pattern: "^[0-9]+$", minLength: 16, maxLength: 19}
                iban: {type: string}
                amount: {type: integer, minimum: 1, exclusiveMaximum: 100, example: 5}
                note: {type: string, nullable: true}
                owner: {allOf: [{$ref: "#/components/schemas/Owner"}], nullable: true}
                pet: {oneOf: [{$ref: "#/components/schemas/Cat"}, {$ref: "#/components/schemas/Dog"}]}
                ids: {type: array, items: {type: string}, minItems: 1}
                meta: {type: object, additionalProperties: {type: string}}
                tag: {not: {type: integer}}
              allOf:
                - if: {properties: {method: {const: card}}}
                  then: {required: [card_number]}
                  else: {required: [iban]}
              dependentRequired: {owner: [note]}
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {$ref: "#/components/schemas/Cat"}
              examples:
                small: {summary: A small cat, value: {name: Tom}}
                big: {value: '{"name": "Garfield"}'}
            application/xml: {example: "<cat/>"}
        "400":
          description: bad
          content:
            application/json:
              schema:
                oneOf:
                  - {type: string, title: Message}
                  - {type: object, properties: {code: {type: integer}}}
                  - {type: "null"}
components:
  schemas:
    Owner: {type: object, properties: {name: {type: string}}}
    Cat: {type: object, title: Kitty, properties: {name: {type: string}, friend: {$ref: "#/components/schemas/Cat"}}}
    Dog: {type: object, properties: {bark: {type: boolean}}}
"""


def page(tmp_path, spec: str = SPEC, **kw) -> str:
    (tmp_path / "s.yaml").write_text(textwrap.dedent(spec))
    s = load_spec("s.yaml", tmp_path)
    assert s.ok, s.issues
    return page_markdown(s, s.operations[0], "Pay", "Pay", **kw)


def test_one_of_and_any_of_render_as_tabs(tmp_path):
    src = page(tmp_path)
    pet = src[src.index('<ParamField body="pet"'):]
    assert pet.startswith('<ParamField body="pet" type="Cat | Dog">\n  <Tabs sync="false">\n'
                          '    <Tab title="Kitty">\n      <ParamField body="name" type="string">')  # title wins
    assert '    <Tab title="Dog">\n      <ParamField body="bark" type="boolean">' in pet
    # a top-level oneOf: tabs of its own, `null` left out, a scalar choice shows its type
    assert ('<Tabs sync="false">\n  <Tab title="Message">\n    Type: `string`\n  </Tab>\n'
            '  <Tab title="Option 2">\n    <ResponseField name="code" type="integer">') in src
    assert 'title="Option 3"' not in src


def test_nullable_constraints_and_not(tmp_path):
    src = page(tmp_path)
    assert '<ParamField body="note" type="string | null"' in src
    # nullable object: still expandable (the anyOf with null shows its one real choice)
    assert ('<ParamField body="owner" type="object | null">\n  <Expandable title="owner properties">\n'
            '    <ParamField body="name" type="string">') in src
    assert "Available options: `card`, `bank`" in src
    assert "Required string length: `16 - 19`" in src and "Pattern: `^[0-9]+$`" in src
    assert "Required range: `1 <= x < 100`" in src and "Example: `5`" in src
    assert "Required array length: `>= 1` elements" in src
    assert "Additional properties: `string`" in src and "Must not match: `integer`" in src


def test_conditional_requirements_become_pills(tmp_path):
    src = page(tmp_path)
    assert '<ParamField body="card_number" type="string" post="required if method = card">' in src
    assert '<ParamField body="iban" type="string" post="required unless method = card">' in src
    assert '<ParamField body="note" type="string | null" post="required if owner is set">' in src
    assert '<ParamField body="method" type="string" required>' in src  # already required: no pill
    md = to_agent_markdown(src, title="Pay")
    assert "- `card_number` (body, string, required if method = card)" in md


def test_condition_too_complex_to_name(tmp_path):
    spec = SPEC.replace("if: {properties: {method: {const: card}}}", "if: {properties: {method: {minLength: 4}}}")
    assert 'body="card_number" type="string" post="conditionally required"' in page(tmp_path, spec)


def test_params_expanded_opens_nested_properties(tmp_path):
    assert '<Expandable title="owner properties">' in page(tmp_path)
    assert '<Expandable title="owner properties" defaultOpen>' in page(tmp_path, expand=True)


def test_response_examples_per_status_content_type_and_named_example(tmp_path):
    src = page(tmp_path)
    examples = src[src.index("<ResponseExample>"):src.index("</ResponseExample>")]
    assert '```json title="200 · application/json · A small cat"\n{\n  "name": "Tom"\n}\n```' in examples
    assert '```json title="200 · application/json · big"\n{\n  "name": "Garfield"\n}\n```' in examples
    assert '```xml title="200 · application/xml"\n<cat/>\n```' in examples
    assert '```json title="400"\n"<string>"\n```' in examples  # made from the schema's first choice
    assert "(`application/json`, `application/xml`)" in src  # every content type named


def test_compiler_reads_api_params_expanded(tmp_path):
    from praisonaiui.compiler.compiler import Compiler
    from praisonaiui.schema.models import Config

    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/index.md").write_text("# Home\n\nWelcome.\n")
    (tmp_path / "s.yaml").write_text(textwrap.dedent(SPEC))
    config = Config.model_validate({"site": {"title": "T"}, "content": {"docs": {"dir": "./docs"}},
                                    "api": {"openapi": "s.yaml", "params": {"expanded": "all"}}})
    result = Compiler(config, base_path=tmp_path).compile(tmp_path / "out")
    assert result.success, result.error
    src = (tmp_path / "out/docs/api-reference/pay.source.md").read_text()
    assert '<Expandable title="owner properties" defaultOpen>' in src and "<ResponseExample>" in src
