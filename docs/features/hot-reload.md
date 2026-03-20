# Hot Reload

Instant rebuilds during development.

## Dev Mode

Start development mode with file watching:

```bash
aiui dev
```

## What Gets Watched

The dev server watches:

- `aiui.template.yaml` - Configuration changes
- `docs/` - Content changes
- Any configured content directories

## Rebuild Triggers

| Change Type | Action |
|-------------|--------|
| Config change | Full rebuild |
| Doc added/removed | Nav rebuild |
| Doc content change | Single page rebuild |

## WebSocket Updates

The dev server uses WebSocket for instant updates:

```
⏳ Watching aiui.template.yaml for changes...
🔄 Config changed, rebuilding...
✅ Rebuilt in 45ms
```

## Options

```bash
aiui dev --port 3000    # Change port
aiui dev --no-open      # Don't open browser
aiui dev --verbose      # Show all events
```

## Integration with Next.js

When using Next.js development:

```bash
# Terminal 1: Watch aiui config
aiui dev

# Terminal 2: Run Next.js
npm run dev
```

Or use concurrently:

```json
{
  "scripts": {
    "dev": "concurrently \"aiui dev\" \"next dev\""
  }
}
```
