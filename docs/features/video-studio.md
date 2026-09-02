# Video Studio

The Video Studio integrates [PraisonAI Video](https://github.com/MervinPraison/praisonai-video) as an external Node render engine. PraisonAIUI provides the dashboard shell, project files, YAML editor, job UX, and HTTP proxying. The video engine handles parse, compile, lint, and MP4 export. **Agents live in PraisonAI (Chat + tools), not inside the renderer.**

## Prerequisites

1. Install PraisonAI Video CLI (`praisonai-video`) or run from the monorepo.
2. Start the engine sidecar (recommended):

```bash
praisonai-video serve --port 3921
```

3. Run the example app:

```bash
aiui run examples/python/video-studio/app.py
```

Open the **Video** tab, create a project, edit `scene.yaml`, and use Lint / Render.

For **Chat** to edit scenes, install `praisonaiagents` and set `OPENAI_API_KEY`. Optional: `VIDEO_STUDIO_PROJECT_ID` to target a specific project.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIDEO_ENGINE_URL` | `http://127.0.0.1:3921` | HTTP API base URL |
| `VIDEO_ENGINE_TOKEN` | (none) | Optional Bearer token forwarded to the engine |
| `PRAISONAI_PROJECTS_DIR` | `~/.praisonai/projects` | On-disk project roots |
| `PRAISONAI_VIDEO_CLI` | (auto-detect) | Path to `praisonai-video` or `dist/cli.js` for subprocess fallback |
| `VIDEO_STUDIO_PROJECT_ID` | (auto) | Active project for agent tools when not passed explicitly |
| `PRAISONAI_MODEL` | `gpt-4o-mini` | LLM for Video Editor agent in the example app |

Python API:

```python
from praisonaiui.video_config import set_video_engine

set_video_engine(url="http://127.0.0.1:3921", projects_dir="~/my-videos")
```

## Projects

Each project is a directory containing:

- `scene.yaml` — scene definition
- `scene.visual-test.yaml` — optional visual regression spec
- `.praisonai/project.json` — metadata
- `exports/` — rendered MP4 artefacts

## API routes

All routes are under `/api/video/`:

- `GET /health` — sidecar status
- `POST /lint`, `POST /compile` — scene validation
- `GET /preview-url`, `POST /preview/start` — preview iframe URL (CLI; dashboard preview hidden)
- `POST /render` — async render job (`type: video_render`); optional `backend` (`playwright` | `remotion`) overrides `scene.yaml` `render.backend`
- `GET /jobs/{id}` — job status and download URL
- `GET|POST /projects` — list and create projects
- `GET /projects/{id}/studio-refresh` — poll after agent tool updates (`refresh: true` once)

When the HTTP sidecar is unavailable, lint and render fall back to subprocess calls to `praisonai-video`.

## Dashboard plugin

The UI lives in `dashboard-plugins/video-studio/` (built-in) or `~/.praisonai/dashboard-plugins/video-studio/` for overrides. It uses `window.aiui.sdk.fetchJSON`.

**Frame-by-frame composition preview is hidden** in the dashboard (`SHOW_COMPOSITION_PREVIEW = false`) until serve preview + seek are reliable. Use **Render MP4** and the **Your video** player for output. Set the flag to `true` in `index.js` to re-enable the optional iframe scrubber.

After agent tool writes, the editor reloads via `video-studio:refresh` (custom event) or polling `studio-refresh`.

## Agent workflow (PraisonAI-first)

1. Open **Chat** with the Video Editor agent (example app registers tools when `praisonaiagents` is installed).
2. Agent calls `video_get_scene` / `video_update_scene` / `video_lint_scene` / `video_render_project` (same outcomes as UI buttons).
3. Video Studio tab picks up changes automatically.

Tools are defined in `praisonaiui/video_agent_tools.py`. For Cursor/Codex outside the UI, use the skill at `skills/praisonai-video/SKILL.md` in the PraisonAI Video repo.

### Optional render backends

Default is **Playwright** (no `render:` block in `scene.yaml`). Use Remotion only when required:

```yaml
render:
  backend: remotion   # needs Remotion licence + remotion-root export; lint will error on default YAML export
```

`video_render_project(backend="playwright")` overrides YAML for one agent run. Hyperframes is deferred.

## CLI parity

The text box edits the same `scene.yaml` the CLI uses. Equivalent commands (from the video repo):

```bash
praisonai-video project create "My video"
praisonai-video project lint <project-id>
praisonai-video project preview <project-id>
praisonai-video project test <project-id>
praisonai-video project render <project-id>
praisonai-video project reset <project-id>
```

Lint editor text without saving: `praisonai-video lint --stdin < scene.yaml`

See `docs/integrations/praisonaiui.md` in the PraisonAI Video repo for the full mapping table.

## Related

- [Agent UI host](agent-ui-host.md) — extension patterns (`registerView`, plugins, `@aiui.page`)
- PraisonAI Video integration doc: `docs/integrations/praisonaiui.md` in the video repo
- PraisonAI Video skill: `skills/praisonai-video/SKILL.md` — YAML-first invariants for agents and CI
