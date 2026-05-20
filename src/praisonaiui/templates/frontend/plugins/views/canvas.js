/**
 * Canvas View — live A2UI surface backed by /api/surfaces/{id}
 * Renders into [data-page="canvas"]
 */
import {
  connectSurfaceWs,
  disconnectSurfaceWs,
  loadSurface,
  registerDefaultSurfaceRenderer,
} from '../surface-utils.js';

let _canvasSurfaceId = 'main';

export async function render(container) {
  registerDefaultSurfaceRenderer('main');

  const params = new URLSearchParams(location.search);
  _canvasSurfaceId = params.get('surface') || 'main';

  container.innerHTML =
    '<div class="db-canvas-view">' +
      '<div class="db-canvas-toolbar" style="display:flex;justify-content:flex-end;margin-bottom:12px">' +
        '<button type="button" class="db-btn" id="canvas-refresh">Refresh</button>' +
      '</div>' +
      '<div class="db-surface-host" id="canvas-surface-host"></div>' +
    '</div>';

  const host = container.querySelector('#canvas-surface-host');
  const refreshBtn = container.querySelector('#canvas-refresh');

  await loadSurface(host, _canvasSurfaceId);
  connectSurfaceWs(host, _canvasSurfaceId);

  refreshBtn?.addEventListener('click', () => loadSurface(host, _canvasSurfaceId));
}

export function cleanup() {
  disconnectSurfaceWs();
}
