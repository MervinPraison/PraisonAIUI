# Video Studio

The Video Studio integrates [PraisonAI Video](https://github.com/MervinPraison/praisonai-video) as an external Node render engine. PraisonAIUI provides the dashboard shell, project files, YAML editor, job UX, and HTTP proxying. The video engine handles parse, compile, lint, frame-accurate preview, and MP4 export.

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

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIDEO_ENGINE_URL` | `http://127.0.0.1:3921` | HTTP API base URL |
| `VIDEO_ENGINE_TOKEN` | (none) | Optional Bearer token forwarded to the engine |
| `PRAISONAI_PROJECTS_DIR` | `~/.praisonai/projects` | On-disk project roots |
| `PRAISONAI_VIDEO_CLI` | (auto-detect) | Path to `praisonai-video` or `dist/cli.js` for subprocess fallback |

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
- `GET /preview-url`, `POST /preview/start` — preview iframe URL
- `POST /render` — async render job (`type: video_render`)
- `GET /jobs/{id}` — job status and download URL
- `GET|POST /projects` — list and create projects

When the HTTP sidecar is unavailable, lint and render fall back to subprocess calls to `praisonai-video`.

## Dashboard plugin

The UI lives in `dashboard-plugins/video-studio/` (built-in) or `~/.praisonai/dashboard-plugins/video-studio/` for overrides. It uses `window.aiui.sdk.fetchJSON` and a frame scrubber with `postMessage` / `__pavSeek` for preview.

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
