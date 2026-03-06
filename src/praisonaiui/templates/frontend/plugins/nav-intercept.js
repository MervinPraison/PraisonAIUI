/**
 * AIUI Navigation Intercept Plugin
 *
 * Prevents React's client-side routing from crashing on static hosting.
 *
 * Strategy: Monkey-patches history.pushState so that any React Router
 * navigation is converted into a full page load (window.location.href).
 * Since each route now has its own index.html (with SEO tags),
 * full page loads are the correct behavior for statically-hosted docs.
 *
 * Also intercepts sidebar button clicks in the capturing phase as a backup.
 */

let navData = null;
let knownPaths = new Set();

async function loadNavData() {
  try {
    const resp = await fetch('/docs-nav.json');
    if (!resp.ok) return;
    navData = await resp.json();

    // Collect all known doc paths
    const items = navData.items || [];
    for (const item of items) {
      if (item.path) knownPaths.add(item.path);
      for (const child of item.children || []) {
        if (child.path) knownPaths.add(child.path);
        for (const gc of child.children || []) {
          if (gc.path) knownPaths.add(gc.path);
        }
      }
    }

    console.debug('[AIUI:nav-intercept] Loaded', knownPaths.size, 'known paths');
  } catch (e) {
    console.warn('[AIUI:nav-intercept] Failed to load nav data:', e);
  }
}

/**
 * Monkey-patch history.pushState to intercept React Router navigations.
 * Instead of letting React do a virtual route change (which crashes on
 * static hosting), we do a full page load to the per-route index.html.
 */
function patchHistoryPushState() {
  const originalPushState = history.pushState.bind(history);

  history.pushState = function (state, title, url) {
    if (url && typeof url === 'string') {
      // Normalize path
      let path = url;
      try {
        const parsed = new URL(url, window.location.origin);
        path = parsed.pathname;
      } catch (e) {
        // url is already a pathname
      }

      // Remove trailing slash for comparison
      const normalized = path.replace(/\/$/, '') || '/';

      // If this is a known doc path, do a full page load instead
      if (knownPaths.has(normalized) && normalized !== window.location.pathname.replace(/\/$/, '')) {
        console.debug('[AIUI:nav-intercept] Redirecting pushState to full load:', normalized);
        window.location.href = normalized + '/';
        return; // Don't actually pushState
      }
    }

    // For non-doc paths, let pushState proceed normally
    return originalPushState(state, title, url);
  };

  console.debug('[AIUI:nav-intercept] history.pushState patched');
}

/**
 * Also patch replaceState as React Router uses it for some navigations.
 */
function patchHistoryReplaceState() {
  const originalReplaceState = history.replaceState.bind(history);

  history.replaceState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try {
        const parsed = new URL(url, window.location.origin);
        path = parsed.pathname;
      } catch (e) {}

      const normalized = path.replace(/\/$/, '') || '/';

      if (knownPaths.has(normalized) && normalized !== window.location.pathname.replace(/\/$/, '')) {
        console.debug('[AIUI:nav-intercept] Redirecting replaceState to full load:', normalized);
        window.location.href = normalized + '/';
        return;
      }
    }

    return originalReplaceState(state, title, url);
  };

  console.debug('[AIUI:nav-intercept] history.replaceState patched');
}

export default {
  name: 'nav-intercept',
  async init() {
    await loadNavData();
    patchHistoryPushState();
    patchHistoryReplaceState();
    console.debug('[AIUI:nav-intercept] Plugin loaded — full page loads enabled for docs routes.');
  },
  onContentChange() {
    // No-op — history patches are already active
  },
};
