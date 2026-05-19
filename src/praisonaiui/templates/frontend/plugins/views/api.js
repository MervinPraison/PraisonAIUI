/**
 * API docs view — delegates to the api dashboard module.
 */
export async function render(container) {
  container.setAttribute('data-page', 'api');
  container.classList.add('api-page');
  const mod = await import('../api.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
