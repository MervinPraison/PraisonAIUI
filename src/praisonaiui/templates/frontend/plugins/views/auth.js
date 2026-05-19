/**
 * Auth view — delegates to the auth dashboard module.
 */
export async function render(container) {
  container.setAttribute('data-page', 'auth');
  container.classList.add('auth-page');
  const mod = await import('../auth.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
