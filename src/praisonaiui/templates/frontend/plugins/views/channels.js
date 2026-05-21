/** Channels view — delegates to channels dashboard module. */
export async function render(container) {
  container.setAttribute('data-page', 'channels');
  const mod = await import('../channels.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
