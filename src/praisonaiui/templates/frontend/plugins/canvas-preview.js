/**
 * CanvasPreviewComponent — dedicated live A2UI preview panel.
 */
import {
  connectSurfaceWs,
  disconnectSurfaceWs,
  loadSurface,
  renderSurfaceContent,
} from './surface-utils.js';

let _mount = null;

export function mountPreview(host, options) {
  if (!host) return;
  unmountPreview();
  const surfaceId = options?.surfaceId || 'main';
  _mount = { host, surfaceId };
  loadSurface(host, surfaceId);
  connectSurfaceWs(host, surfaceId);
}

export function refreshPreview() {
  if (!_mount) return;
  return loadSurface(_mount.host, _mount.surfaceId);
}

export function updatePreviewMessages(messages) {
  if (!_mount) return;
  renderSurfaceContent(_mount.host, _mount.surfaceId, messages || []);
}

export function unmountPreview() {
  disconnectSurfaceWs();
  _mount = null;
}
