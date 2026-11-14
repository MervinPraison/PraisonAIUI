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
    if (res.status === 404) {
      renderEmptySurface(host);
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const messages = data.messages || [];
    if (!messages.length) {
      renderEmptySurface(host);
      return;
    }
    renderSurfaceContent(host, sid, messages);
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('404')) {
      renderEmptySurface(host);
      return;
    }
    host.innerHTML = '<div class="db-card" style="padding:16px;color:var(--db-text-dim)">' +
      'Failed to load surface: ' + msg + '</div>';
  }
}

function renderEmptySurface(host) {
  host.innerHTML =
    '<div class="db-card" style="padding:20px;color:var(--db-text-dim);text-align:center">' +
      '<div style="font-size:28px;margin-bottom:8px">🖼️</div>' +
      '<p style="margin:0 0 6px">Canvas is empty</p>' +
      '<p style="margin:0;font-size:12px">Ask the agent to build UI — it will appear here live.</p>' +
    '</div>';
}

// Under AUTH_ENFORCE the server also gates WebSocket handshakes, and browsers
// cannot set an Authorization header on them. dashboard.js trades the stored
// key for a single-use ticket (window.aiui.wsAuthParam); without it, fall back
// to ?token= as before. Resolves to "name=value" or ''.
function wsAuthParam() {
  const shared = window.aiui && window.aiui.wsAuthParam;
  if (typeof shared === 'function') return shared().catch(() => '');
  try {
    const token = window.sessionStorage.getItem('aiui_gateway_token') || '';
    return Promise.resolve(token ? 'token=' + encodeURIComponent(token) : '');
  } catch (e) {
    return Promise.resolve('');
  }
}

let _previewGen = 0;

export function connectSurfaceWs(host, surfaceId, onMessage) {
  disconnectSurfaceWs();
  const gen = ++_previewGen;
  const sid = surfaceId || 'main';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return wsAuthParam().then((param) => {
    if (gen !== _previewGen) return null; // disconnected or reconnected meanwhile
    _previewWs = new WebSocket(proto + '//' + location.host + '/api/chat/ws' + (param ? '?' + param : ''));
    attachSurfaceHandler(host, sid, onMessage);
    return _previewWs;
  });
}

function attachSurfaceHandler(host, sid, onMessage) {
  _previewWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'a2ui_surface' && (data.surface_id || 'main') === sid) {
        renderSurfaceContent(host, sid, data.messages || []);
        if (typeof onMessage === 'function') onMessage(data);
      }
    } catch (_) { /* ignore */ }
  };
}

export function disconnectSurfaceWs() {
  _previewGen += 1;
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
