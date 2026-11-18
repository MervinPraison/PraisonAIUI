"""API reference tags (<ParamField>, <ResponseField>, <Expandable>, examples, <Panel>) build without warnings."""

from praisonaiui.compiler.docs_tags import unknown_tags

PAGE = """# Get a user

<ParamField path="user_id" type="string" required>The user.</ParamField>

<ResponseField name="user" type="object">
  <Expandable title="properties">
    <ResponseField name="id" type="integer" />
  </Expandable>
</ResponseField>

<RequestExample>

```bash cURL
curl https://api.example.com/users/1
```

</RequestExample>

<ResponseExample>

```json 200
{"id": 1}
```

</ResponseExample>

<Panel>Rate limits apply.</Panel>
"""


def test_api_reference_tags_are_known_docs_components():
    assert unknown_tags(PAGE) == []
