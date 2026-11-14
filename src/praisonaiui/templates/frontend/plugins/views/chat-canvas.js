/**
 * ChatWithCanvasComposer — chat left, live A2UI preview right.
 * Vanilla chat.js is unchanged; this view composes both panels.
 */
import * as chatView from './chat.js';
import { mountPreview, refreshPreview, unmountPreview } from '../canvas-preview.js';
import { registerDefaultSurfaceRenderer } from '../surface-utils.js';

const STYLE_ID = 'chat-canvas-styles';

// Mounts of this page whose render() has not been released yet. The embedded
// chat (its WebSocket) and the preview (its surface socket) are module-wide,
// so they are torn down only once no mount is outstanding: a render
// superseded while it loads, and cleaned up late, never closes the sockets of
// the page on screen. The legacy dashboard calls the cleanup() export once
// for every render() that returned; the shell's mountView calls the function
// render() returns once per mount, and cleanup() only while no other mount
// is live. On globalThis because the legacy dashboard imports a fresh copy
// of this file (?v=<time>) on each first visit.
const views = globalThis.__aiuiViewMounts || (globalThis.__aiuiViewMounts = {});
const state = views['chat-canvas'] || (views['chat-canvas'] = { live: new Set() });

function settle() {
  if (state.live.size > 0) return;
  chatView.cleanup();
  unmountPreview();
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .chat-canvas-root {
      display: flex;
      height: calc(100vh - 0px);
      min-height: 480px;
      gap: 0;
      overflow: hidden;
    }
    .db-clean .chat-canvas-root { height: 100vh; }
    .db-fill .chat-canvas-root { flex: 1; min-height: 0; height: auto; }
    .chat-canvas-chat {
      flex: 1 1 60%;
      min-width: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .chat-canvas-chat .chat-root { height: 100%; }
    .chat-canvas-preview {
      flex: 0 0 auto;
      border-left: 1px solid var(--db-border, #3f3f46);
      display: flex;
      flex-direction: column;
      background: var(--db-card-bg, rgba(255,255,255,0.03));
      min-width: 280px;
      max-width: 55%;
    }
    .chat-canvas-preview.collapsed {
      width: 44px !important;
      min-width: 44px;
    }
    .chat-canvas-preview.collapsed .chat-canvas-preview-body,
    .chat-canvas-preview.collapsed .chat-canvas-preview-title,
    .chat-canvas-preview.collapsed .chat-canvas-preview-actions button:not(.chat-canvas-toggle) {
      display: none;
    }
    .chat-canvas-preview-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--db-border, #3f3f46);
      gap: 8px;
      flex-shrink: 0;
    }
    .chat-canvas-preview-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--db-text-dim, #a1a1aa);
    }
    .chat-canvas-preview-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .chat-canvas-preview-body {
      flex: 1;
      overflow: auto;
      padding: 12px;
    }
    .db-a2ui-text { margin: 0 0 8px; font-size: 14px; }
    .db-a2ui-button { margin: 4px 4px 4px 0; }
    .db-a2ui-divider { border: none; border-top: 1px solid var(--db-border, #3f3f46); margin: 12px 0; }
    .db-a2ui-fallback { font-size: 11px; white-space: pre-wrap; word-break: break-word; }
  `;
  document.head.appendChild(style);
}

async function loadPreviewConfig() {
  const defaults = { enabled: true, surfaceId: 'main', width: '40%' };
  try {
    const res = await fetch('/ui-config.json');
    const cfg = await res.json();
    return { ...defaults, ...(cfg.chat?.preview || {}) };
  } catch (_) {
    return defaults;
  }
}

export async function render(container) {
  const mount = {};
  state.live.add(mount);
  // This mount's own cleanup; the shell's mountView calls it once per mount.
  const release = () => { if (state.live.delete(mount)) settle(); };
  try {
    await renderInto(container);
  } catch (err) {
    release(); // no host cleans up a render that threw
    throw err;
  }
  return release;
}

async function renderInto(container) {
  injectStyles();
  registerDefaultSurfaceRenderer('main');

  const previewCfg = await loadPreviewConfig();
  if (!container.isConnected) return; // left while loading: open no sockets
  const params = new URLSearchParams(location.search);
  const surfaceId = params.get('surface') || previewCfg.surfaceId || 'main';
  const width = previewCfg.width || '40%';

  container.innerHTML =
    '<div class="chat-canvas-root">' +
      '<div class="chat-canvas-chat" id="chat-canvas-chat-host"></div>' +
      '<div class="chat-canvas-preview" id="chat-canvas-preview" style="width:' + width + '">' +
        '<div class="chat-canvas-preview-toolbar">' +
          '<span class="chat-canvas-preview-title">Canvas · ' + surfaceId + '</span>' +
          '<div class="chat-canvas-preview-actions">' +
            '<button type="button" class="db-btn chat-canvas-toggle" title="Collapse preview">◀</button>' +
            '<button type="button" class="db-btn" id="chat-canvas-refresh" title="Refresh">↻</button>' +
            '<button type="button" class="db-btn" id="chat-canvas-full" title="Open full canvas">⛶</button>' +
          '</div>' +
        '</div>' +
        '<div class="chat-canvas-preview-body db-surface-host" id="chat-canvas-preview-body"></div>' +
      '</div>' +
    '</div>';

  const chatHost = container.querySelector('#chat-canvas-chat-host');
  const previewHost = container.querySelector('#chat-canvas-preview-body');
  const previewPanel = container.querySelector('#chat-canvas-preview');
  const toggleBtn = container.querySelector('.chat-canvas-toggle');
  const refreshBtn = container.querySelector('#chat-canvas-refresh');
  const fullBtn = container.querySelector('#chat-canvas-full');

  let collapsed = false;
  toggleBtn?.addEventListener('click', () => {
    collapsed = !collapsed;
    previewPanel?.classList.toggle('collapsed', collapsed);
    toggleBtn.textContent = collapsed ? '▶' : '◀';
    toggleBtn.title = collapsed ? 'Expand preview' : 'Collapse preview';
  });

  refreshBtn?.addEventListener('click', () => refreshPreview());
  fullBtn?.addEventListener('click', () => {
    const url = '/canvas?surface=' + encodeURIComponent(surfaceId);
    if (typeof window.aiui?.selectPage === 'function') {
      history.pushState({ pageId: 'canvas' }, '', url);
      window.aiui.selectPage('canvas');
    } else {
      location.href = url;
    }
  });

  mountPreview(previewHost, { surfaceId });
  await chatView.render(chatHost);
}

export function cleanup() {
  // Releases one render: the legacy dashboard does not say which one, and
  // only how many remain matters.
  const oldest = state.live.values().next();
  if (!oldest.done) state.live.delete(oldest.value);
  settle();
}
