/** Config view — delegates to config dashboard module. */
export async function render(container) {
  container.setAttribute('data-page', 'config');
  const mod = await import('../config.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
