---
title: Interactive Spreadsheet
nav_title: Sheet
description: Multi-tab interactive spreadsheet with live zero-eval formulas (=SUM, =AVERAGE, =IF), cell editing, row filtering, and CSV/JSON export.
---

# Interactive Spreadsheet

`sheet()` renders a live, editable spreadsheet with a formula bar (`A1 | fx`), zero-`eval` formula recalculation, instant row filtering, multi-tab workbooks, and formula-injection-safe CSV/JSON export. The exact same JSON schema renders in `@aiui.page`, zero-code YAML, Chat ```` ```sheet ```` fences, and the Split Artifacts Canvas.

Double-click any cell below (for example `B2` or `C2`) to edit a value or formula and watch the totals recalculate live.

<ComponentPreview title="Live Multi-Tab Formula Spreadsheet">
{
  "type": "sheet",
  "id": "q4-budget",
  "title": "Q4 SaaS Operating Plan",
  "tabs": [
    {
      "name": "Q4 Budget",
      "grid": [
        ["Department", "Budget ($)", "Actual ($)", "Variance ($)", "Status"],
        ["Engineering", 140000, 132500, "=B2-C2", "=IF(D2>=0, \"Under\", \"Over\")"],
        ["Infrastructure", 48000, 51200, "=B3-C3", "=IF(D3>=0, \"Under\", \"Over\")"],
        ["Marketing", 62000, 58400, "=B4-C4", "=IF(D4>=0, \"Under\", \"Over\")"],
        ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)", "=IF(D5>=0, \"On Track\", \"Review\")"],
        ["Average", "=ROUND(AVERAGE(B2:B4), 0)", "=ROUND(AVERAGE(C2:C4), 0)", "=ROUND(AVERAGE(D2:D4), 0)", ""]
      ]
    },
    {
      "name": "Headcount",
      "grid": [
        ["Team", "Current", "Planned", "Open Roles"],
        ["Core Platform", 8, 10, "=C2-B2"],
        ["Applied AI", 6, 9, "=C3-B3"],
        ["Design & DX", 4, 5, "=C4-B4"],
        ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)"]
      ]
    }
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python (@aiui.page)">
```python
import praisonaiui as aiui

aiui.sheet(
    "Q4 SaaS Operating Plan",
    id="q4-budget",
    tabs=[
        {
            "name": "Q4 Budget",
            "grid": [
                ["Department", "Budget ($)", "Actual ($)", "Variance ($)", "Status"],
                ["Engineering", 140000, 132500, "=B2-C2", '=IF(D2>=0, "Under", "Over")'],
                ["Infrastructure", 48000, 51200, "=B3-C3", '=IF(D3>=0, "Under", "Over")'],
                ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)", "=SUM(D2:D3)", '=IF(D4>=0, "On Track", "Review")'],
            ],
        },
    ],
)
```
</Tab>
<Tab title="YAML (app.yaml)">
```yaml
- type: sheet
  id: q4-budget
  title: Q4 SaaS Operating Plan
  headers: ["Department", "Budget ($)", "Actual ($)", "Variance ($)"]
  rows:
    - ["Engineering", 140000, 132500, "=B2-C2"]
    - ["Infrastructure", 48000, 51200, "=B3-C3"]
    - ["Total", "=SUM(B2:B3)", "=SUM(C2:C3)", "=SUM(D2:D3)"]
```
</Tab>
<Tab title="Chat Fence (Agent Reply)">
````markdown
```sheet
{"id":"q4-budget","title":"Q4 Budget","tabs":[{"name":"Summary","grid":[["Item","Cost"],["Compute",4200],["Storage",1100],["Total","=SUM(B2:B3)"]]}]}
```
````
</Tab>
</Tabs>

## Supported Formulas

| Function / Operator | Example | Notes |
|---|---|---|
| Arithmetic & comparisons | `=B2-C2`, `=(B2+C2)*1.1`, `=D2>=0` | Safe recursive-descent parser (no `eval` or `Function`). |
| `SUM`, `AVERAGE` / `AVG` | `=SUM(B2:B10)`, `=AVERAGE(C2:C10)` | Supports single cells, ranges (`A1:C5`), and lists. |
| `MIN`, `MAX`, `COUNT`, `COUNTA` | `=MAX(B2:B10)`, `=COUNT(B2:B10)` | Numeric vs non-empty cell counts. |
| `ROUND`, `ABS`, `IF` | `=ROUND(AVERAGE(B2:B4), 2)`, `=IF(D2>=0, "OK", "Over")` | Guards `#CYCLE!` and `#DIV/0!` automatically. |

## Props

| Parameter | Type | Description |
|---|---|---|
| `title` | `str` | Toolbar title and export filename stem. |
| `tabs` | `list[dict]` | Multi-tab workbook: `[{"name": str, "grid": list[list], "values"?: list[list]}]`. |
| `headers`, `rows` | `list` | Shorthand for a single-tab spreadsheet when `tabs` is omitted. |
| `id` | `str` | Optional stable artifact ID for versioned updates in the Artifacts Canvas. |
