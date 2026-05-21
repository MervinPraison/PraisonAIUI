/** Logs view — delegates to logs dashboard module. */
export async function render(container) {
  container.setAttribute('data-page', 'logs');
  const mod = await import('../logs.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
