---
title: API fields
description: ParamField, ResponseField, Expandable and the example side column (e2e/specs/docs-api-fields.spec.ts).
---

# API fields

Get one user by id.

## Parameters

<ParamField path="user_id" type="string" required>
The user to fetch.
</ParamField>

<ParamField query="tags" type="string[]" default="all" pre={["beta"]} post={["v2"]}>Only users with these tags.</ParamField>

<ParamField header="X-Legacy-Key" type="string" deprecated>Use `Authorization` instead.</ParamField>

<ParamField body="filter" type="object">
  The filter.
</ParamField>

## Response

<ResponseField name="user" type="object" required>
  The user.

  <Expandable title="user properties">
    <ResponseField name="name" type="string">Display name.</ResponseField>
    <ResponseField name="address" type="object">
      Postal address.
      <Expandable>
        <ResponseField name="city" type="string">City name in the nested address.</ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="next_cursor" type="string | null">Pass it back to read the next page.</ResponseField>

## Errors

A missing user answers `404`. A bad cursor answers `400`. Long pages keep the
examples in view while you read: this paragraph and the ones below give the
page some height.

Retries are safe: the call reads and never writes.

Rate limits apply per key; see the dashboard for yours.

<RequestExample>

```bash cURL
curl https://api.example.com/v1/users/42
```

```python Python
client.users.get("42")
```

</RequestExample>

<ResponseExample dropdown>

```json 200
{ "user": { "name": "Ada" }, "next_cursor": null }
```

```json 404
{ "error": "not_found" }
```

</ResponseExample>
