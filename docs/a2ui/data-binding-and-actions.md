# Data Binding, Validation & Actions

> Reactive JSON Pointer data models, dynamic list templates, validation checks, and round-trip surface actions.

A2UI separates **layout structure** (`updateComponents`) from **live data** (`updateDataModel`). Agents can update values in place without resending the whole component tree.

## 1. Reactive Data Model (`updateDataModel`)

Bind any component property to a JSON Pointer path such as `{"path": "/user/name"}`:

```python
import praisonaiui as aiui

messages = aiui.a2ui_surface(
    surface_id="profile",
    components=[
        {"id": "root", "component": "Column", "children": ["name", "role"]},
        {"id": "name", "component": "Text", "text": {"path": "/user/name"}, "variant": "h2"},
        {"id": "role", "component": "Text", "text": {"path": "/user/role"}, "variant": "caption"},
    ],
    data={"user": {"name": "Maya Chen", "role": "Staff ML Engineer"}},
)
```

Later, push only the changed field—the UI updates immediately:

```python
await aiui.push_surface(
    "profile",
    [aiui.a2ui_update_data_model("Principal AI Architect", path="/user/role", surface_id="profile")],
)
```

## 2. Two-Way Input Binding & `sendDataModel`

Interactive components (`TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`) write back to their bound data path as the user types or toggles.

Set `send_data_model=True` on `createSurface` so client actions can carry current form state back to the server:

```python
aiui.a2ui_create_surface("booking", send_data_model=True)
```

## 3. Dynamic Lists with Templates

Render arrays of arbitrary length using a `List` template:

```json
[
  {"id": "root", "component": "List", "children": {"componentId": "task-row", "path": "/tasks"}},
  {"id": "task-row", "component": "Row", "children": ["task-title", "task-status"]},
  {"id": "task-title", "component": "Text", "text": {"path": "title"}},
  {"id": "task-status", "component": "Text", "text": {"path": "status"}, "variant": "caption"}
]
```

## 4. Client-Side Validation (`checks`)

Attach `checks` to inputs using the built-in validation functions (`required`, `email`, `regex`, `length`, `numeric`):

```json
{
  "id": "email",
  "component": "TextField",
  "label": "Email",
  "value": {"path": "/email"},
  "checks": [
    {"call": "required", "args": {"value": {"path": "/email"}}, "message": "Email is required"},
    {"call": "email", "args": {"value": {"path": "/email"}}, "message": "Must be a valid email"}
  ]
}
```

## 5. Handling Actions in Python (`@aiui.surface_action`)

When a user clicks an A2UI `Button`, PraisonAIUI posts to `POST /api/surfaces/{surface_id}/action` (and accepts `/actions`, v0.9 `action`, and v0.8 `userAction` envelopes).

```python
@aiui.surface_action("booking")
async def on_booking_action(action: dict):
    name = action["action"]          # e.g. "confirm_booking"
    comp_id = action["component_id"] # e.g. "confirm-btn"
    data = action["data"]            # resolved context bindings

    if name == "confirm_booking":
        await aiui.push_surface(
            "booking",
            [aiui.a2ui_update_data_model("Confirmed!", path="/status", surface_id="booking")],
        )
    return {"handled": True, "component": comp_id, "data": data}
```

## 6. Deleting a Surface (`deleteSurface`)

Tear down a surface cleanly from Python or an agent:

```python
await aiui.push_surface("booking", [aiui.a2ui_delete_surface("booking")])
```

## Related pages

- [All-in-One A2UI Playground](https://ui.praison.ai/docs/a2ui/all-in-one-playground.md)
- [A2UI — Agent-to-User Interface](https://ui.praison.ai/docs/a2ui/overview.md)
- [ADP Validation Rules](https://ui.praison.ai/docs/protocols/adp/validation-rules.md)
