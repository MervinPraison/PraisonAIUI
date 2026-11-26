# Live validation — [PraisonAI v4.8.2](https://github.com/MervinPraison/PraisonAI/releases/tag/v4.8.2)

| Field | Value |
|-------|-------|
| Release | [v4.8.2](https://github.com/MervinPraison/PraisonAI/releases/tag/v4.8.2) (published 2026-11-25) |
| PyPI | `praisonai==4.8.2` |
| `praisonaiagents` (pulled) | **1.8.3** |
| Model | `gpt-4o-mini` (live OpenAI) |
| Harness | 16 SDK scenarios (standard live E2E catalog) |
| Platform | Windows, Python 3.11 |

## Release notes gap

GitHub release **body** is only `Release v4.8.2` (no changelog, version matrix, or smoke checklist). Same class of issue as prior release-audit **empty changelog** reports — add notes on the release page rather than filing a duplicate.

## Results summary

| Score | **14 / 16 passed** |
|-------|-------------------|

### Scenario matrix

| # | Scenario | Expected | Actual (v4.8.2) | Result |
|---|----------|----------|-----------------|--------|
| 1 | Minimal `Agent.start` | `READY` | `READY` | **PASS** |
| 2 | `output="verbose"` | Markdown table with `\|` | Table returned | **PASS** |
| 3 | Tool must fire | `add_numbers` called, `6006` | 1 call, `6006` | **PASS** |
| 4 | `Agents` alias, no tasks | Team runs, 2 auto tasks | AgentTeam sequential | **PASS** |
| 5 | Sequential + context | t2 mentions `Au` | `Au` in t2 | **PASS** |
| 6 | Hierarchical + `manager_llm` | Worker answers `4` | `4` (after env healthy) | **PASS** |
| 7 | `output_pydantic` on `chat` | `Pair` model instance | `Pair(city='Paris', …)` | **PASS** |
| 8 | Cross-instance memory | Recall `ORANGE-PANDA` | `ORANGE-PANDA` | **PASS** |
| 9 | `AgentFlow` two steps | STEP1 + STEP2 | Both in output | **PASS** |
| 10 | Handoff to specialist | `323` for 17×19 | `323` | **PASS** |
| 11 | Guardrail blocks secret | No `LEAKME` | Blocked | **PASS** |
| 12 | `AgentTeam(..., verbose=False)` | Constructs team | `TypeError: unexpected keyword 'verbose'` | **FAIL** |
| 13 | `context="summarize"` | Response | `OK` | **PASS** |
| 14 | `ExecutionConfig` autonomy | `DONE` | `DONE` | **PASS** |
| 15 | `Knowledge.add(url)` | Adds URL | `ImportError: praisonaiagents[knowledge]` | **FAIL** |
| 16 | `skip_on_failure` sequential | t2 runs after t1 | `SUCCESS` | **PASS** |

### Regressions fixed vs v4.7.13 profile

| Area | v4.7.13 live | v4.8.2 live |
|------|--------------|-------------|
| Cross-instance memory (#5667) | **FAIL** | **PASS** |
| `output_pydantic` → model (#5590) | **FAIL** | **PASS** |

## Terminal evidence (redacted)

<details>
<summary><strong>Harness summary</strong></summary>

```text
MODEL=gpt-4o-mini
praisonaiagents=1.8.3
[FAIL] verbose_false_agentteam  TypeError: AgentTeam.__init__() got an unexpected keyword argument 'verbose'
[FAIL] knowledge_url  ImportError: pip install "praisonaiagents[knowledge]"
passed=14 failed=2
```

</details>

<details>
<summary><strong>Tool warning (non-fatal)</strong></summary>

```text
Registry is None for tool add_numbers
```

Tool call still succeeded (`tool_calls: 1`).

</details>

<details>
<summary><strong>Hierarchical — corrupt optional deps (operator note)</strong></summary>

If `python-dotenv` is broken in the venv, `litellm` import fails and hierarchical manager logs:

```text
Manager parse error: LiteLLM is required but not installed...
ModuleNotFoundError: No module named 'dotenv'
Hierarchical process ended with 0/1 tasks completed
```

Reinstalling `python-dotenv` restores hierarchical **PASS**. Not specific to v4.8.2 logic; environment hygiene.

</details>

## Already tracked — do **not** open duplicate issues

| Finding | Tracker | Still on v4.8.2? |
|---------|---------|------------------|
| `AgentTeam(verbose=…)` invalid kwarg | PAI-SDK-006 / docs drift | **Yes** — use `output="silent"` |
| Optional `praisonaiagents[knowledge]` extra | Documented optional install | **Yes** — not default metapackage |
| Empty GitHub release body | Prior release-process audits | **Yes** for v4.8.2 tag |

## New GitHub issue drafts (300+ lines)

**None filed this pass.** Remaining failures are **known API/docs/optional-extra behavior**, not new regressions worth a long-form bug. Recommend:

1. Comment on **#5667** / **#5590** that live smoke **passes** on `praisonaiagents==1.8.3` / tag **v4.8.2**.
2. Ship release notes on the v4.8.2 GitHub release (agents **1.8.3**, memory + structured-output fixes).
3. Republish or link PAI-SDK-006 for `verbose` → `output` migration.

## Security

**Rotate the OpenAI API key** if it was pasted into chat or logs. Use `OPENAI_API_KEY` in the environment only; never commit or embed in issue bodies.

## Re-run

```powershell
$env:OPENAI_API_KEY = '<set in shell>'
python live_sdk_validation_v482.py
```

Artifact: `live-sdk-v482.results.json` (machine-readable, same folder as harness).