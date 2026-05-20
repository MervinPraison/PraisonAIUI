/**
 * Shared A2UI surface helpers — render, load, WebSocket, actions.
 */
import { a2uiMessagesToFragment } from './a2ui-mapper.js';

let _previewWs = null;
let _previewUnsubs = [];

export async function postSurfaceAction(surfaceId, payload) {
  const res = await fetch('/api/surfaces/' + encodeURIComponent(surfaceId) + '/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || ('HTTP ' + res.status));
  }
  return res.json();
}

function customRenderer(surfaceId) {
  return window.aiui?.surfaces?.[surfaceId] ?? null;
}

function renderWithDefaultMapper(host, surfaceId, messages) {
  const fragment = a2uiMessagesToFragment(messages, surfaceId, (actionPayload) => {
    postSurfaceAction(surfaceId, actionPayload).catch((e) => {
      console.warn('[surface] action failed:', e);
    });
  });
  if (!fragment) return false;
  host.innerHTML = '';
  host.appendChild(fragment);
  return true;
}

export function renderSurfaceContent(host, surfaceId, messages) {
  if (!host) return;
  const sid = surfaceId || 'main';
  const renderer = customRenderer(sid);
  if (renderer) {
    try {
      host.innerHTML = '';
      renderer(host, messages || []);
      return;
    } catch (e) {
      console.warn('Surface renderer error:', e);
    }
  }
  if (renderWithDefaultMapper(host, sid, messages || [])) return;
  host.innerHTML = '<pre class="db-a2ui-fallback">' +
    JSON.stringify(messages || [], null, 2) + '</pre>';
}

export async function loadSurface(host, surfaceId) {
  const sid = surfaceId || 'main';
  try {
    const res = await fetch('/api/surfaces/' + encodeURIComponent(sid));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderSurfaceContent(host, sid, data.messages || []);
  } catch (e) {
    host.innerHTML = '<div class="db-card" style="padding:16px;color:var(--db-text-dim)">' +
      'Failed to load surface: ' + (e.message || e) + '</div>';
  }
}

export function connectSurfaceWs(host, surfaceId, onMessage) {
  disconnectSurfaceWs();
  const sid = surfaceId || 'main';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  _previewWs = new WebSocket(proto + '//' + location.host + '/api/chat/ws');
  _previewWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'a2ui_surface' && (data.surface_id || 'main') === sid) {
        renderSurfaceContent(host, sid, data.messages || []);
        if (typeof onMessage === 'function') onMessage(data);
      }
    } catch (_) { /* ignore */ }
  };
  return _previewWs;
}

export function disconnectSurfaceWs() {
  if (_previewWs) {
    try { _previewWs.close(); } catch (_) { /* ignore */ }
    _previewWs = null;
  }
  _previewUnsubs.forEach((fn) => {
    try { fn(); } catch (_) { /* ignore */ }
  });
  _previewUnsubs = [];
}

export function registerDefaultSurfaceRenderer(surfaceId) {
  const sid = surfaceId || 'main';
  if (window.aiui?.surfaces?.[sid]) return;
  if (typeof window.aiui?.registerSurfaceRenderer !== 'function') return;
  window.aiui.registerSurfaceRenderer(sid, (host, messages) => {
    if (!renderWithDefaultMapper(host, sid, messages || [])) {
      host.innerHTML = '<pre class="db-a2ui-fallback">' +
        JSON.stringify(messages || [], null, 2) + '</pre>';
    }
  });
}
