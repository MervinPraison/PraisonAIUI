/**
 * Schedules view — delegates to the schedules dashboard module.
 */
// Mounts of this page whose render() has not been released yet. The
// delegated module is one shared instance, so it is torn down only once no
// mount is outstanding: a render superseded while it loads, and cleaned up
// late, never tears down the page on screen. Both host policies hold:
// - the legacy dashboard (selectPage) calls the cleanup() export once for
//   every render() that returned, superseded or not;
// - the shell (mountView) calls the function render() returns once per
//   mount, and the cleanup() export only while no other mount is live.
// The set lives on globalThis because the legacy dashboard imports a fresh
// copy of this file (?v=<time>) on each first visit, and copies must agree.
const views = globalThis.__aiuiViewMounts || (globalThis.__aiuiViewMounts = {});
const state = views['schedules'] || (views['schedules'] = { live: new Set(), mod: null });

export async function render(container) {
  const mount = {};
  state.live.add(mount);
  // This mount's own cleanup; the shell's mountView calls it once per mount.
  const release = () => { if (state.live.delete(mount)) settle(); };
  try {
    container.setAttribute('data-page', 'schedules');
    container.classList.add('schedules-page');
    const m = await import('../schedules.js');
    state.mod = m;
    if (!container.isConnected) return release; // left while loading
    if (m.default?.init) await m.default.init();
    if (!container.isConnected) return release;
    const root = container.closest('#root') || document.getElementById('root');
    if (m.default?.onContentChange && root) m.default.onContentChange(root);
    return release;
  } catch (err) {
    release(); // no host cleans up a render that threw
    throw err;
  }
}

// Tear the delegated module down once no mount is outstanding.
function settle() {
  if (state.live.size === 0) state.mod?.default?.stop?.();
}

/**
 * Stop the module's 30 s refresh poll.
 * Idempotent and safe when render() never ran; the next render() starts
 * fresh. The legacy dashboard calls it when the page is left, the shell once
 * the last mount of the page goes.
 */
export function cleanup() {
  // Releases one render: the legacy dashboard does not say which one, and
  // only how many remain matters.
  const oldest = state.live.values().next();
  if (!oldest.done) state.live.delete(oldest.value);
  settle();
}
