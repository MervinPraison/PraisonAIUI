/**
 * Agents view — delegates to the agents dashboard module.
 */
export async function render(container) {
  container.setAttribute('data-page', 'agents');
  container.classList.add('agents-page');
  const mod = await import('../agents.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
