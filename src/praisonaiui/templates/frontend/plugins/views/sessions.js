/**
 * Sessions view — delegates to the sessions dashboard module.
 */
export async function render(container) {
  container.setAttribute('data-page', 'sessions');
  container.classList.add('sessions-page');
  const mod = await import('../sessions.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
