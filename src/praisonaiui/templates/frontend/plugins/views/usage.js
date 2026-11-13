/** Usage view — delegates to usage dashboard module. */
// Renders not yet matched by a cleanup(). Hosts (the legacy dashboard's
// selectPage, the shell's mountView) pair every render() that returns with
// exactly one cleanup(); a render superseded while it loads is cleaned up
// late, possibly after a newer render of this page has started. The
// delegated module is one shared instance, so it is only stopped once no
// render is outstanding: a late cleanup never stops the page on screen.
// The count lives on globalThis because the legacy dashboard imports a fresh
// copy of this file (?v=<time>) on each first visit, and copies must agree.
const views = globalThis.__aiuiViewRenders || (globalThis.__aiuiViewRenders = {});
const state = views['usage'] || (views['usage'] = { count: 0, mod: null });

export async function render(container) {
  state.count++;
  try {
    container.setAttribute('data-page', 'usage');
    const m = await import('../usage.js');
    state.mod = m;
    if (!container.isConnected) return; // left while loading
    if (m.default?.init) await m.default.init();
    if (!container.isConnected) return;
    const root = container.closest('#root') || document.getElementById('root');
    if (m.default?.onContentChange && root) m.default.onContentChange(root);
  } catch (err) {
    release(); // hosts do not call cleanup() for a render that threw
    throw err;
  }
}

function release() {
  if (state.count > 0) state.count--;
  if (state.count === 0) state.mod?.default?.stop?.();
}

/**
 * Stop the module's 30 s refresh poll.
 * Idempotent and safe when render() never ran; the next render() starts
 * fresh. The legacy dashboard calls it when the page is left, the shell when
 * the page unmounts.
 */
export function cleanup() {
  release();
}
