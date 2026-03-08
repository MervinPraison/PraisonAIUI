/**
 * AIUI Navigation Intercept Plugin
 *
 * SPA-style client-side navigation for the docs site.
 * Instead of full page reloads, intercepts sidebar clicks and
 * swaps content in-place — just like Mintlify.
 *
 * Key design:
 *  - Uses History.prototype.pushState (the NATIVE one) to update URLs
 *    WITHOUT triggering React Router's internal listener, which would
 *    unmount the entire DOM and cause a black screen.
 *  - Intercepts sidebar button clicks in the capturing phase
 *  - Dispatches 'aiui:navigate' custom event so other plugins react
 *  - Handles browser back/forward via popstate listener
 *  - All paths normalized with trailing slash
 */

// Save a reference to the REAL native pushState before anyone patches it.
// React Router patches history.pushState, so using history.pushState
// from within our patch triggers React's re-render → DOM wipe.
const nativePushState = History.prototype.pushState;
const nativeReplaceState = History.prototype.replaceState;

let navData = null;
let knownPaths = new Set();
let pathToTitle = new Map();

async function loadNavData() {
  try {
    const resp = await fetch('/docs-nav.json');
    if (!resp.ok) return;
    navData = await resp.json();

    function collectPaths(items) {
      for (const item of items) {
        if (item.path) {
          // Store paths both with and without trailing slash
          const normalized = item.path.replace(/\/$/, '');
          knownPaths.add(normalized);
          if (item.title) pathToTitle.set(normalized, item.title);
        }
        if (item.children) collectPaths(item.children);
      }
    }
    collectPaths(navData.items || []);

    // Also add the homepage
    knownPaths.add('');
    knownPaths.add('/');

    console.debug('[AIUI:nav-intercept] Loaded', knownPaths.size, 'known paths');
  } catch (e) {
    console.warn('[AIUI:nav-intercept] Failed to load nav data:', e);
  }
}

/**
 * Normalize a path: remove trailing slash (except for root '/').
 */
function normalizePath(p) {
  const cleaned = (p || '/').replace(/\/$/, '');
  return cleaned || '/';
}

/**
 * Navigate to a doc path client-side (no full page reload).
 * Uses native pushState to bypass React Router completely.
 */
function navigateTo(path) {
  const normalized = normalizePath(path);
  const current = normalizePath(window.location.pathname);

  // Already on this page
  if (normalized === current) return;

  // Use NATIVE pushState to update URL WITHOUT triggering React Router.
  // Always use trailing slash for consistency with static hosting.
  const urlWithSlash = normalized === '/' ? '/' : normalized + '/';
  nativePushState.call(history, null, '', urlWithSlash);

  // Notify all plugins about the navigation
  window.dispatchEvent(new CustomEvent('aiui:navigate', {
    detail: { path: normalized, fromPath: current }
  }));

  // Scroll to top
  window.scrollTo(0, 0);

  console.debug('[AIUI:nav-intercept] SPA navigate:', current, '→', normalized);
}

/**
 * Intercept sidebar clicks in the capturing phase.
 * This fires BEFORE React's own handlers.
 * Uses stopImmediatePropagation to prevent React from seeing the event at all.
 */
function interceptSidebarClicks() {
  document.addEventListener('click', function (e) {
    // Find the closest button or anchor inside the sidebar
    const btn = e.target.closest('aside button, aside a');
    if (!btn) return;

    // Skip section headers (group labels in the sidebar)
    const text = btn.textContent.trim();
    if (!text) return;

    // Skip if this is a group header (usually uppercase styled)
    if (btn.className && /uppercase/.test(btn.className)) return;

    // Convert button text to a slug and search known paths
    const slug = text.toLowerCase().replace(/\s+/g, '-');

    // Search all known paths for one that ends with this slug
    for (const knownPath of knownPaths) {
      const pathSlug = knownPath.split('/').pop();
      if (pathSlug === slug) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Prevent React from seeing this
        navigateTo(knownPath);
        return;
      }
    }

    // Also check <a> tags with href attributes
    if (btn.tagName === 'A' && btn.href) {
      try {
        const url = new URL(btn.href, window.location.origin);
        const normalized = normalizePath(url.pathname);
        if (knownPaths.has(normalized)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          navigateTo(normalized);
          return;
        }
      } catch (err) {}
    }
  }, true); // true = capturing phase

  console.debug('[AIUI:nav-intercept] Sidebar click interception active');
}

/**
 * Patch history.pushState/replaceState to intercept React Router navigations.
 * When React Router tries to navigate to a doc path, we do SPA content swap
 * instead of letting React unmount everything.
 */
function patchHistoryMethods() {
  const currentPushState = history.pushState.bind(history);
  const currentReplaceState = history.replaceState.bind(history);

  history.pushState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try { path = new URL(url, window.location.origin).pathname; } catch (e) {}

      const normalized = normalizePath(path);
      const current = normalizePath(window.location.pathname);

      if (knownPaths.has(normalized) && normalized !== current) {
        // Use native pushState to update URL without React knowing
        const urlWithSlash = normalized === '/' ? '/' : normalized + '/';
        nativePushState.call(history, state, title, urlWithSlash);

        window.dispatchEvent(new CustomEvent('aiui:navigate', {
          detail: { path: normalized, fromPath: current }
        }));
        window.scrollTo(0, 0);
        console.debug('[AIUI:nav-intercept] Intercepted pushState:', normalized);
        return;
      }
    }
    return currentPushState(state, title, url);
  };

  history.replaceState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try { path = new URL(url, window.location.origin).pathname; } catch (e) {}

      const normalized = normalizePath(path);
      const current = normalizePath(window.location.pathname);

      if (knownPaths.has(normalized) && normalized !== current) {
        const urlWithSlash = normalized === '/' ? '/' : normalized + '/';
        nativeReplaceState.call(history, state, title, urlWithSlash);

        window.dispatchEvent(new CustomEvent('aiui:navigate', {
          detail: { path: normalized, fromPath: current }
        }));
        window.scrollTo(0, 0);
        return;
      }
    }
    return currentReplaceState(state, title, url);
  };

  console.debug('[AIUI:nav-intercept] History methods patched (native bypass)');
}

/**
 * Handle browser back/forward buttons.
 */
function handlePopState() {
  window.addEventListener('popstate', function () {
    const normalized = normalizePath(window.location.pathname);
    window.dispatchEvent(new CustomEvent('aiui:navigate', {
      detail: { path: normalized, fromPath: null }
    }));
    window.scrollTo(0, 0);
    console.debug('[AIUI:nav-intercept] Popstate:', normalized);
  });
}

export default {
  name: 'nav-intercept',
  async init() {
    await loadNavData();
    interceptSidebarClicks();
    patchHistoryMethods();
    handlePopState();
    console.debug('[AIUI:nav-intercept] SPA navigation active —', knownPaths.size, 'routes.');
  },
  onContentChange() {
    // No-op — event-driven navigation handles everything
  },
};
