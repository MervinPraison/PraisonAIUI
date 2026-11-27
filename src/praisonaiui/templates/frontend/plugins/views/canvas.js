/**
 * Canvas View — live A2UI surface workspace backed by /api/surfaces/{id}.
 * Supports switching between multiple surfaces on the same page and live WS updates.
 * Renders into [data-page="canvas"]
 */
import {
  connectSurfaceWs,
  disconnectSurfaceWs,
  loadSurface,
  registerDefaultSurfaceRenderer,
} from '../surface-utils.js';

let _canvasSurfaceId = 'main';

async function loadSurfaceList(selectEl, activeId) {
  try {
    const res = await fetch('/api/surfaces');
    if (!res.ok) return;
    const data = await res.json();
    const ids = new Set([activeId]);
    for (const s of data.surfaces || []) {
      if (s && s.id) ids.add(String(s.id));
    }
    selectEl.replaceChildren();
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      opt.selected = id === activeId;
      selectEl.appendChild(opt);
    }
  } catch (_) {
    /* ignore */
  }
}

export async function render(container) {
  registerDefaultSurfaceRenderer('main');

  const params = new URLSearchParams(location.search);
  _canvasSurfaceId = params.get('surface') || 'main';

  container.innerHTML =
    '<div class="db-canvas-view">' +
      '<div class="db-canvas-toolbar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:13px">' +
          '<span>Surface</span>' +
          '<select id="canvas-surface-select" aria-label="Select A2UI surface" class="db-btn" style="padding:4px 8px"></select>' +
        '</label>' +
        '<button type="button" class="db-btn" id="canvas-refresh">Refresh</button>' +
      '</div>' +
      '<div class="db-surface-host" id="canvas-surface-host"></div>' +
    '</div>';

  const host = container.querySelector('#canvas-surface-host');
  const refreshBtn = container.querySelector('#canvas-refresh');
  const selectEl = container.querySelector('#canvas-surface-select');

  await loadSurfaceList(selectEl, _canvasSurfaceId);
  await loadSurface(host, _canvasSurfaceId);
  connectSurfaceWs(host, _canvasSurfaceId);

  selectEl?.addEventListener('change', async () => {
    _canvasSurfaceId = selectEl.value || 'main';
    registerDefaultSurfaceRenderer(_canvasSurfaceId);
    await loadSurface(host, _canvasSurfaceId);
    connectSurfaceWs(host, _canvasSurfaceId);
  });

  refreshBtn?.addEventListener('click', async () => {
    await loadSurfaceList(selectEl, _canvasSurfaceId);
    await loadSurface(host, _canvasSurfaceId);
  });
}

export function cleanup() {
  disconnectSurfaceWs();
}
