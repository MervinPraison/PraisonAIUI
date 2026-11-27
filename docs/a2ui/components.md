---
nav_title: Components & Functions
description: Reference for all 18 A2UI Basic Catalog components and 14 built-in client functions.
---

# Basic Catalog Components & Functions

PraisonAIUI's bundled `@a2ui/react/v0_9` island renders the complete **A2UI v0.9 Basic Catalog**: **18 components** and **14 client-side functions**.

## Layout Components (7)

| Component | Key Props | Purpose |
|---|---|---|
| `Row` | `children`, `justify`, `align` | Horizontal flex container |
| `Column` | `children`, `justify`, `align` | Vertical flex container |
| `List` | `children` (array or `{componentId, path}`), `direction`, `align` | Static or data-driven repeating list |
| `Card` | `child` | Elevated surface card wrapping one child |
| `Tabs` | `tabs: [{title, child}]` | Multi-tab content container |
| `Modal` | `trigger`, `content` | Dialog opened by a trigger component |
| `Divider` | `axis` (`"horizontal"` \| `"vertical"`) | Visual separator line |

```json
[
  {"id": "root", "component": "Column", "children": ["tabs", "div", "row"]},
  {"id": "tabs", "component": "Tabs", "tabs": [
    {"title": "Summary", "child": "card1"},
    {"title": "Details", "child": "details"}
  ]},
  {"id": "card1", "component": "Card", "child": "summary-text"},
  {"id": "summary-text", "component": "Text", "text": "Overview content"},
  {"id": "details", "component": "Text", "text": "Secondary tab content"},
  {"id": "div", "component": "Divider", "axis": "horizontal"},
  {"id": "row", "component": "Row", "justify": "spaceBetween", "children": ["a", "b"]},
  {"id": "a", "component": "Text", "text": "Left"},
  {"id": "b", "component": "Text", "text": "Right"}
]
```

## Content Components (5)

| Component | Key Props | Purpose |
|---|---|---|
| `Text` | `text`, `variant` (`h1`–`h5`, `body`, `caption`) | Styled text or data-bound string |
| `Image` | `url`, `fit`, `variant` | Image display with safe URL handling |
| `Icon` | `name` | Standard catalog icon (`check`, `search`, `star`, etc.) |
| `Video` | `url` | Embedded video player |
| `AudioPlayer` | `url`, `description` | Embedded audio player |

```json
[
  {"id": "root", "component": "Column", "children": ["h", "ico", "img", "aud", "vid"]},
  {"id": "h", "component": "Text", "text": "Media Showcase", "variant": "h2"},
  {"id": "ico", "component": "Icon", "name": "check"},
  {"id": "img", "component": "Image", "url": "/icon.svg", "fit": "contain"},
  {"id": "aud", "component": "AudioPlayer", "url": "/sample.mp3", "description": "Voice clip"},
  {"id": "vid", "component": "Video", "url": "/demo.mp4"}
]
```

## Interactive Input Components (6)

| Component | Key Props | Purpose |
|---|---|---|
| `Button` | `child`, `variant` (`primary`, `borderless`), `action` | Clickable action trigger |
| `TextField` | `label`, `value`, `variant` (`shortText`, `longText`, `number`, `obscured`), `checks` | Single/multi-line text input |
| `CheckBox` | `label`, `value` | Boolean toggle checkbox |
| `ChoicePicker` | `label`, `value`, `options: [{label, value}]`, `variant` (`mutuallyExclusive`, `multipleSelection`) | Radio, chips, or multi-select choices |
| `Slider` | `label`, `value`, `min`, `max` | Numeric range slider |
| `DateTimeInput` | `label`, `value`, `enableDate`, `enableTime` | Date and/or time picker |

```json
[
  {"id": "root", "component": "Column", "children": ["email", "plan", "priority", "date", "agree", "submit"]},
  {"id": "email", "component": "TextField", "label": "Work Email", "value": {"path": "/form/email"},
   "checks": [{"call": "email", "args": {"value": {"path": "/form/email"}}, "message": "Enter a valid email"}]},
  {"id": "plan", "component": "ChoicePicker", "label": "Tier", "value": {"path": "/form/tier"},
   "options": [{"label": "Starter", "value": "starter"}, {"label": "Pro", "value": "pro"}]},
  {"id": "priority", "component": "Slider", "label": "Priority", "min": 1, "max": 10, "value": {"path": "/form/priority"}},
  {"id": "date", "component": "DateTimeInput", "label": "Launch Date", "value": {"path": "/form/date"}, "enableDate": true},
  {"id": "agree", "component": "CheckBox", "label": "Approve deployment", "value": {"path": "/form/agree"}},
  {"id": "submit-lbl", "component": "Text", "text": "Submit"},
  {"id": "submit", "component": "Button", "child": "submit-lbl", "variant": "primary",
   "action": {"event": {"name": "deploy", "context": {"form": {"path": "/form"}}}}}
]
```

## Built-in Client Functions (14)

Use functions inside `checks` (validation) or dynamic expressions (`{"call": "...", "args": {...}}`):

- **Validation (5):** `required`, `regex`, `length`, `numeric`, `email`
- **Formatting (5):** `formatString`, `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`
- **Logic & Actions (4):** `and`, `or`, `not`, `openUrl`

Inspect the live catalog supported by your server anytime:

```bash
curl http://127.0.0.1:8000/api/surfaces/capabilities
```
