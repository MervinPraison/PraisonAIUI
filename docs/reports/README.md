# Reports

Point-in-time records of larger projects: what was decided, what shipped, what was
measured and what is left. They are history, not living docs. For how the code is laid
out today see `ARCHITECTURE.md`; for decisions see `docs/adr/`.

| Report | What it is |
|---|---|
| [ui-reset-2026-11.md](ui-reset-2026-11.md) | The November 2026 UI reset (React app shell, plugin SDK, Streamdown, tokens): packages WP0–WP8, timeline, modularity audit (45 → 75), review findings, PR triage and lessons. Decision record: [ADR 0002](../adr/0002-react-app-shell-and-plugin-sdk.md) |

## When to update

- Add a new report when a multi-PR project finishes, named `<project>-<yyyy-mm>.md`, and
  list it above.
- Edit an existing report only to correct facts or to mark a listed follow-up as done
  (with the PR number). Record new work in a new report.
- When an ADR's status changes (for example the `style: app` default flip), update the
  ADR and link the change from the relevant report's follow-ups.
- Never include secrets, personal contact details, local machine paths or private links.
