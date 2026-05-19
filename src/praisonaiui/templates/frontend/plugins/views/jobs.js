/**
 * Jobs view — delegates to the jobs dashboard module.
 */
export async function render(container) {
  container.setAttribute('data-page', 'jobs');
  container.classList.add('jobs-page');
  const mod = await import('../jobs.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
