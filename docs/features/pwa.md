# Progressive Web App (PWA)

Install PraisonAIUI as a **native-like app** on any device — manifest, service worker, and offline support.

## Quick Start

```bash
# Get PWA manifest
curl http://localhost:8083/manifest.json

# Get service worker
curl http://localhost:8083/sw.js

# Check PWA configuration
curl http://localhost:8083/api/pwa/config
```

## How It Works

The PWA feature automatically serves three endpoints:

| URL | Purpose |
|-----|---------|
| `/manifest.json` | Web Application Manifest for installability |
| `/sw.js` | Service Worker for caching and offline support |
| `/api/pwa/config` | PWA configuration for frontend consumption |

### Service Worker Strategy

The service worker uses a **cache-first** strategy for the app shell and a **network-first** strategy for navigation:

1. **Install**: Pre-caches the root URL and health endpoint
2. **Activate**: Cleans up old caches
3. **Fetch**: Navigation requests fall back to cached root for offline support

## Configuration

```python
from praisonaiui.features.pwa import DefaultPWAManager, set_pwa_manager

# Customize PWA settings
mgr = DefaultPWAManager(
    name="My AI Assistant",
    short_name="AI",
    theme_color="#1a1a2e",
    bg_color="#16213e",
    display="standalone"
)
set_pwa_manager(mgr)
```

## Generated Manifest

```json
{
    "name": "PraisonAI",
    "short_name": "AI",
    "start_url": "/",
    "display": "standalone",
    "theme_color": "#1a1a2e",
    "background_color": "#16213e",
    "icons": [
        {"src": "/api/pwa/icon/192", "sizes": "192x192", "type": "image/png"},
        {"src": "/api/pwa/icon/512", "sizes": "512x512", "type": "image/png"}
    ],
    "orientation": "portrait-primary",
    "scope": "/"
}
```

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/manifest.json` | GET | Web Application Manifest |
| `/sw.js` | GET | Service Worker JavaScript |
| `/api/pwa/config` | GET | PWA configuration details |

## Related

- [Theme System](theme-system.md) — Colors used by PWA manifest
