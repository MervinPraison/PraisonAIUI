/**
 * Schedules view — delegates to the schedules dashboard module.
 */
export async function render(container) {
  container.setAttribute('data-page', 'schedules');
  container.classList.add('schedules-page');
  const mod = await import('../schedules.js');
  if (mod.default?.init) await mod.default.init();
  const root = container.closest('#root') || document.getElementById('root');
  if (mod.default?.onContentChange && root) mod.default.onContentChange(root);
}
