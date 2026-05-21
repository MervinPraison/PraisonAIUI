/** Usage view — delegates to usage dashboard module. */
export async function render(container) {
  container.setAttribute('data-page', 'usage');
  const mod = await import('../usage.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
