/**
 * AIUI Navigation Intercept Plugin
 *
 * SPA-style client-side navigation for the docs site.
 * Instead of full page reloads, intercepts sidebar clicks and
 * swaps content in-place — just like Mintlify.
 *
 * Strategy:
 *  1. Intercept sidebar button clicks in the capturing phase
 *  2. Prevent React's default routing (which crashes on static hosting)
 *  3. Update URL via pushState (no reload)
 *  4. Dispatch 'aiui:navigate' custom event so other plugins can react
 *  5. Handle browser back/forward via popstate listener
 */

let navData = null;
let knownPaths = new Set();
let pathToTitle = new Map();

async function loadNavData() {
  try {
    const resp = await fetch('/docs-nav.json');
    if (!resp.ok) return;
    navData = await resp.json();

    // Collect all known doc paths and their titles
    function collectPaths(items) {
      for (const item of items) {
        if (item.path) {
          knownPaths.add(item.path);
          if (item.title) pathToTitle.set(item.path, item.title);
        }
        if (item.children) collectPaths(item.children);
      }
    }
    collectPaths(navData.items || []);

    console.debug('[AIUI:nav-intercept] Loaded', knownPaths.size, 'known paths');
  } catch (e) {
    console.warn('[AIUI:nav-intercept] Failed to load nav data:', e);
  }
}

/**
 * Navigate to a doc path client-side (no full page reload).
 */
function navigateTo(path) {
  const normalized = path.replace(/\/$/, '') || '/';
  const current = window.location.pathname.replace(/\/$/, '') || '/';

  // Already on this page
  if (normalized === current) return;

  // Update URL without reload
  history.pushState(null, '', normalized + '/');

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
 */
function interceptSidebarClicks() {
  document.addEventListener('click', function (e) {
    // Find the closest button or anchor
    const btn = e.target.closest('aside button, aside a');
    if (!btn) return;

    // Skip if it's a section header (has uppercase class = group header)
    if (btn.className && btn.className.includes('uppercase')) return;

    // For sidebar buttons, find the matching nav path by text
    const text = btn.textContent.trim().toLowerCase();
    const slug = text.replace(/\s+/g, '-');

    // Search known paths for a match
    for (const knownPath of knownPaths) {
      const pathSlug = knownPath.split('/').pop();
      if (pathSlug === slug) {
        e.preventDefault();
        e.stopPropagation();
        navigateTo(knownPath);
        return;
      }
    }

    // Also check for <a> tags with href
    if (btn.tagName === 'A' && btn.href) {
      try {
        const url = new URL(btn.href, window.location.origin);
        const normalized = url.pathname.replace(/\/$/, '') || '/';
        if (knownPaths.has(normalized)) {
          e.preventDefault();
          e.stopPropagation();
          navigateTo(normalized);
          return;
        }
      } catch (err) {
        // Not a valid URL, let it through
      }
    }
  }, true); // true = capturing phase (before React)

  console.debug('[AIUI:nav-intercept] Sidebar click interception active');
}

/**
 * Monkey-patch pushState/replaceState to intercept React Router navigations.
 * Instead of full page reloads, do client-side navigation.
 */
function patchHistoryMethods() {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try {
        const parsed = new URL(url, window.location.origin);
        path = parsed.pathname;
      } catch (e) {}

      const normalized = path.replace(/\/$/, '') || '/';
      const current = window.location.pathname.replace(/\/$/, '') || '/';

      // If React Router is trying to navigate to a known doc path,
      // do SPA navigation instead of a full reload
      if (knownPaths.has(normalized) && normalized !== current) {
        // Use original pushState to update URL
        originalPushState(state, title, url);
        // Dispatch navigate event for SPA content swap
        window.dispatchEvent(new CustomEvent('aiui:navigate', {
          detail: { path: normalized, fromPath: current }
        }));
        window.scrollTo(0, 0);
        console.debug('[AIUI:nav-intercept] SPA pushState:', current, '→', normalized);
        return;
      }
    }
    return originalPushState(state, title, url);
  };

  history.replaceState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try {
        const parsed = new URL(url, window.location.origin);
        path = parsed.pathname;
      } catch (e) {}

      const normalized = path.replace(/\/$/, '') || '/';
      const current = window.location.pathname.replace(/\/$/, '') || '/';

      if (knownPaths.has(normalized) && normalized !== current) {
        originalReplaceState(state, title, url);
        window.dispatchEvent(new CustomEvent('aiui:navigate', {
          detail: { path: normalized, fromPath: current }
        }));
        window.scrollTo(0, 0);
        return;
      }
    }
    return originalReplaceState(state, title, url);
  };

  console.debug('[AIUI:nav-intercept] History methods patched for SPA navigation');
}

/**
 * Handle browser back/forward buttons.
 */
function handlePopState() {
  window.addEventListener('popstate', function () {
    const normalized = window.location.pathname.replace(/\/$/, '') || '/';
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
