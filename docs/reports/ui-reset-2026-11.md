# UI reset: project record (November 2026)

- **Period:** 2026-11-12 19:22 UTC → 2026-11-14 ~10:30 UTC
- **Releases:** v0.3.154 (WP0a reached main early, 13 Nov), v0.3.155 (full reset plus lint fix PR #356)
- **Decision record:** `docs/adr/0002-react-app-shell-and-plugin-sdk.md`
- **Code map:** `ARCHITECTURE.md` (not repeated here)
- **Status:** `style: app` ships opt-in; `dashboard` remains the default. Flip criteria are in ADR 0002.

## 1. What shipped

The work was split into work packages (WP) with strict file ownership. WP0a ran alone,
WP0b–WP7 in parallel worktrees, WP8 on the merged tree.

| WP | Title | Files | Added lines | Fix rounds | Notable fixes found in verification |
|---|---|---|---|---|---|
| WP0a | Contracts and build | 23 | n/a | 0 | Boot entry 961 B gzip; hashed chunks, manifest, sync script, contract stubs |
| WP0b | Design system | 51 | +3,440 | 0 | Token layer, radix-ui migration, seed themes, `DESIGN.md` |
| WP0c | Python server | 8 | +2,913 | 0 | `app` style, plugin registry, shell manifest, WebSocket auth |
| WP1 | Markdown (Streamdown) | 27 | +3,078 | 2 | Old DOM plugins overwrote the renderer and corrupted docs code; numbered lists split by code blocks rendered `1., 1., 1.` |
| WP2 | Chat engine | 24 | +5,276 | 1 | A chat created in the same visit could not be deleted; failed Approve gave no feedback |
| WP3 | Server chat protocol | 3 | +1,792 | 1 | Agent name lost on WS for providers without the resolve hook |
| WP4 | Legacy host | 9 | +2,357 | 1 | Retry never recovered after `dashboard.js` failed to load once |
| WP5 | Legacy view hygiene | 20 | +2,493 | 3 | chat-canvas left a WebSocket open; stored XSS through custom theme names and accents |
| WP6 | React shell | 24 | +2,584 | 1 | Ctrl+K did not close the palette; first Tab missed the skip link |
| WP7 | Plugin SDK | 49 | +8,662 | 0 | SDK, block registry, `aiui plugins` CLI, example plugin |
| WP8 | Gates and integration | n/a | n/a | n/a | Size budgets, e2e suites, parity vs v0.3.153, CI jobs, docs |

Integration branch total: 80 commits, 479 files, +41.6k / −3.3k lines. Too large for the
pipeline's auto-merge limits (800 lines / 30 files), so it was merged by hand. Review fix
rounds added 28 fixes on top.

## 2. Timeline

| When (UTC) | Phase | Kind | Notes |
|---|---|---|---|
| 12 Nov 19:22–19:35 | Strategy | run | 9 agents researched the UI strategy |
| 12 Nov 19:45–20:38 | Validate design | run | 5 spikes, ADR, 2 adversarial reviews |
| 12 Nov 20:43–23:10 | Build run 1 | run | Foundation built, verified, merged; 9 packages started in parallel |
| 12 Nov 23:10–13 Nov 08:17 | Halt | idle | 5-hour usage limit; 16 agents failed |
| 13 Nov 08:17–10:15 | Build runs 2–4 | run | Two resumes; restarts re-ran finished builders |
| 13 Nov 10:15–10:26 | Halt | idle | API 403 outage killed 14 agents; a reboot wiped temp inputs, recovered from transcripts |
| 13 Nov 10:26–13:35 | Packages finish | run | 7 → 9 packages passed after fix rounds |
| 13 Nov 13:35–15:11 | Halt | idle | 5-hour limit |
| 13 Nov 15:11–17:17 | Last checks and merge | run | All 9 branches merged (46 commits) |
| 13 Nov 17:17–20:40 | Halt | idle | 5-hour limit, merge agent cut off |
| 13 Nov 20:40–21:32 | Parallel build | run | 4 agents at once; frontend modularity finished |
| 13 Nov 21:32–14 Nov 05:04 | Halt | idle | 5-hour limit |
| 14 Nov 05:04–05:13 | Model switch restart | run | Agents relaunched pinned to one model |
| 14 Nov 05:13–10:30 | Integrate, review, fix | run | Merge checks, WP8, Python modularity, 6 reviewers, fix rounds 1 and 2 |

### Workflow runs

| Run | Start | Agents | Turns | Agent-hours |
|---|---|---|---|---|
| Strategy | 12 Nov 19:24 | 9 | 249 | 0.5 |
| Validate design | 12 Nov 19:45 | 8 | 593 | 2.3 |
| Build (4 restarts) | 12 Nov 20:43 | 67 | 3,682 | 21.5 |
| Packages finish | 13 Nov 10:26 | 20 | 1,173 | 8.2 |
| Last checks and merge | 13 Nov 15:11 | 6 | 160 | 2.4 |
| Merge resume | 13 Nov 20:40 | 1 | 6 | 0.0 |
| Parallel build | 13 Nov 20:43 | 7 | 304 | 2.6 |
| Resume after model switch | 14 Nov 05:05 | 3 | 52 | 0.4 |
| Integrate → fix | 14 Nov 05:13 | 15 | 1,575 | 9.0 |
| **Total** | | **136** | **7,794** | **46.9** |

**Totals:** ~39 h wall clock; ~17 h of active run time (sum of run segments); ~22 h idle
in 4 usage-limit halts and 1 API outage. The 46.9 agent-hours count parallel agents
separately.

### Causes of delay (estimated hours)

| Cause | ~h | Detail |
|---|---|---|
| Usage limits and being away | 21.8 | Each halt waited for the reset and for a human to resume |
| Restarts redid work | 6 | Resume caching replays only an unchanged prefix; build run 1 used 67 agents for 10 packages; WP0c was built 4 times |
| Serial, heavy verification | 5 | build → verify → fix → re-verify; each verifier rebuilt and ran full pytest, Playwright and screenshots (30–60 min) |
| One fixer per round | 3 | Round 1 had a single fixer for 40+ findings (~2 h) |
| Huge contexts | 2 | 160–180k tokens per turn, 130–180 turns per agent; ~1.26 billion cached tokens re-read |
| Big-bang scope | 1 | One branch too large for auto-merge |

## 3. Modularity audit

Requirement: built-in pages and features should use the same plugin mechanism third
parties use. Audited read-only on 2026-11-13 against the WP branches, re-verified after the
fixes.

| Score | Before | After |
|---|---|---|
| Frontend | 60 | 82 |
| Python | 35 | 68 |
| Overall | 45 | 75 |

Before: all 38 built-in pages and 44 built-in features bypassed the registry through
hardcoded lists, and the core named specific pages in about a dozen places.

| Gap | Sev. | Title | Status |
|---|---|---|---|
| G1 | blocker | Built-in pages bypass the plugin registry | Closed: first-party records in `praisonaiui/builtin`, read through `PluginRegistry` |
| G2 | blocker | Built-in features are a hardcoded list and cannot be disabled | Closed: driven by the same records; `extensions.disabled` removes routes (404) |
| G3 | blocker | The shell hard-registers the chat page | Closed: `builtin.chat` plugin; `shell/ported.ts` deleted; core-purity test |
| G4 | major | A hidden built-in page still renders in the app shell | Closed: pages absent from the manifest render not-found |
| G5 | major | Page-specific knowledge in the shell (icons, full-bleed ids, approvals, New chat, group order) | Staged: move to manifest data and first-party plugins |
| G6 | major | `server.py` is host and most features at once (~4.5k lines) | Staged: one domain per PR, route-table snapshot test |
| G7 | major | The SDK has no shell services | Closed: `navigate`, `notify`, `fetchJson`, `useManifest`, `registerCommand`, `onActivate` |
| G8 | major | `registerSlot` exported but nothing renders slots | Closed: slot hosts with multiple contributions |
| G9 | major | About 15 registration paths | Staged: make `register_page` and dashboard-plugins adapters onto plugin records |
| G10 | major | Plugins cannot replace a built-in page or feature | Staged: allowed once the built-in is disabled |
| G11 | minor | Legacy view list hardcoded in `dashboard.js` | Staged (with P3) |
| G12 | minor | Core blocks are not in the block registry | Closed: registered through `registerBlock` |
| G13 | minor | No plugin hooks for settings, theme, nav groups, middleware, icons | Staged |
| G14 | minor | Legacy runtime preloaded even when no page needs it | Closed: preload only for legacy pages or custom JS |

Back-compat check (pre-modularity archive vs HEAD): `/api/pages` and the dashboard
`index.html` byte-identical; the only manifest change is chat `legacy → native` (intended).
At re-verification: 2,483 Python tests and 275 frontend tests passed; bundle-sync matched
156 committed files.

Found during re-verification and fixed separately: config.yaml `pages.enabled` /
`pages.disabled` was silently ignored (also on main) because `create_app` called `.get()` on
`YAMLConfigStore` inside a broad `except`.

## 4. Review findings (round 1)

Six parallel reviewers produced 40 findings.

| Lens | Blocker | Major | Minor | Total |
|---|---|---|---|---|
| Security | 3 | 3 | 2 | 8 |
| Robustness | 0 | 4 | 5 | 9 |
| Design | 0 | 5 | 10 | 15 |
| Completeness | 0 | 0 | 8 | 8 |
| **Total** | **3** | **12** | **25** | **40** |

### Blockers (all pre-existing on main, fixed in fix round 1)

| Finding | Fix |
|---|---|
| `AUTH_ENFORCE` gated only `/api/*`; `/sessions`, `/run`, `/v1/*` and `/agui` were open | Deny everything except an explicit public allowlist (HTML pages, static files, health, login); a test walks every route and expects 401 |
| URL-token mode (`AIUI_REQUIRE_TOKEN`): every WebSocket unauthenticated, so any client could read all chats and run agents | WebSocket scopes are gated (cookie, Bearer or ticket); otherwise closed with 1008 |
| `require_auth=True` enforced nothing: the `"/"` exclusion matched every path; manifest public | Exact `"/"` match; middleware also rejects unauthenticated WebSockets; tests added |

### Majors

| Lens | Finding | Resolution |
|---|---|---|
| Security | `?token=` WS auth put the API key in access logs | Single-use 60 s ticket from `POST /api/auth/ws-ticket` |
| Security | `chat_abort` ownership guard bypassable (subscribe, REST abort) | Same ownership rule on both paths |
| Security | Default server accepted cross-origin WS and text/plain POSTs | `OriginGuardMiddleware`; CORS opt-in via `AIUI_ALLOWED_ORIGINS` |
| Robustness | Two tabs on one session: B shows A's reply, B's Stop aborts A | Turn correlation by client turn id |
| Robustness | `set_theme(dark_mode=...)` ignored in the app shell | Boot theme mode used as default |
| Robustness | custom.js `registerView` no longer overrode an `@aiui.page` handler | Legacy view registry checked first |
| Robustness | Regenerate duplicated turns after reload | Server-side handling of the replaced turn |
| Design | Legacy onboarding wizard covered the shell on any non-OK auth status | Only 401/403 mean unauthenticated |
| Design | Legacy pages: double padding, mixed gutters, duplicate titles | Partly fixed in round 1; the remainder was started in round 2 and carried into the final review (planned, not yet on main) |
| Design | Legacy chrome broke the design system (emoji, card-in-card, second omnibar) | Restyled through `bridge.css` under the shell only |
| Design | Sidebar icons repeated, collapsed rail unusable | ~32 distinct icons within the boot budget |
| Design | ⌘K ranked fuzzy over exact prefix | Prefix-first filter |

Minor themes: chat polish (tool-row card-in-card, empty state, composer ring, math and
reasoning rendering), long ungrouped sidebar, test gaps (leak gate tolerance, opt-in leak
probe, no WS-restart e2e, no browser test for custom JS under `app`), a missing changelog
entry for the HSL break, and plugin SRI / remote-route policy gaps.

Round 1 left 2 items open (CI eslint step failing on 6 errors; legacy-page padding).
The eslint errors were fixed in fix round 2 and PR #356. The padding fix was
started in round 2 but set aside unfinished when the branch shipped; it is carried
into the final in-depth review (planned).

## 5. PR triage (14 Nov, against v0.3.155)

| PR | Title | Decision | Reason |
|---|---|---|---|
| #354 | vite 7.3.8 (GHSA-587h-7wmj-h5pm) | Merge as-is after CI on current main | Lockfile-only dev-dependency patch; local build and gates pass |
| #344 | Describe SDK/dashboard architecture in AGENTS.md | Update, then merge | Still needed; push 4 small edits, clear stale labels; merge before the ARCHITECTURE.md PR |
| #328 | Code-execution approval gate (partial #311) | Replace (credit the author) | Auth half already fixed on main; gate duplicates the SDK's and is bypassable |
| #313 | Require recorded approval before code execution | Close | Superseded by the replacement PR; commits also in #328 |
| #312 | Gate code execution on approval; require auth to approve | Close | Auth half superseded by `http_guard.py`; default policy auto-approved, so no human decides |

Issue #311: part 2 (unauthenticated approval) is fixed on main whenever an auth mode is on;
model-invoked `execute_code` is gated by the SDK. `POST /api/code/execute` had no approval
step and a broken import. Keep #311 open until the replacement lands.

### Follow-ups (planned)

| Item | Status |
|---|---|
| Replacement PR: run Code Studio code through the SDK approval gate (fix import, wait off the event loop, 403 on deny/timeout, tests, docs) | Planned |
| `POST /register` open under `require_auth` | Planned |
| Take `approver` from the authenticated identity, not the request body | Planned |
| Consider refusing `always=true` for critical tools | Planned |
| Close #311 after the replacement merges | Planned |
| Modularity gaps G5, G6, G9, G10, G11, G13 | Staged |
| Chat parity backlog and default flip | Planned (ADR 0002, P1–P2) |
| Bundle headroom: markdown chunk 146.6/147 KB, chat route 134.6/140 KB | Watch |

## 6. Lessons and process optimisations

| Change | Status | Effect |
|---|---|---|
| Pin all agents to one model | Done | Avoided a model counting ~2× against usage |
| Explicit per-package state instead of resume cache | Done | No re-running finished builders |
| Keep inputs in the repo, not temp dirs | Done | Survives reboots |
| Parallel builders and reviewers in worktrees; clone `node_modules` | Done | 4 builders, 6 reviewers at once |
| Parallel fixers by area (Python, chat, shell) | Done in final review | Removes the single-fixer bottleneck |
| Fix loops run affected tests only; full suite once at the gate | Proposed | ~10–20 min per round |
| Build once, verify many (shared bundle and server) | Proposed | Verifiers stop rebuilding |
| Lower effort for mechanical stages | Proposed | Deep effort only for security and design |
| Commit work in progress at each milestone | Proposed | A halt never loses work |
| One PR per package (< 800 lines / 30 files) | Proposed | Auto-merge, faster and safer review |
| Run Playwright in CI, not locally | Proposed | Parallel, agents stop waiting on browsers |
| Start large fan-outs right after a usage reset; alert near the cap | Proposed | Fewer halts |

Other lessons:

- Freeze contracts (ADR §Frozen contracts) before parallel work; it let 9 packages build
  without cross-edits.
- Adversarial review found three auth blockers that pre-dated the project; security review
  should cover the whole surface touched, not only the diff.
- Broad `except Exception: pass` hid a config bug on main; prefer narrow excepts and a
  test for every config key.
- Gates must measure what users see (first content box, not the mount; 0 leak delta, not
  "no growth after first visit").
