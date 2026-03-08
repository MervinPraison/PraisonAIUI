/**
 * AIUI Navigation Intercept Plugin
 *
 * Prevents React Router's client-side routing from crashing on static hosting.
 *
 * Strategy:
 *   Full page loads for doc routes, but with an overlay that hides the
 *   transition so the user doesn't see a black flash.
 *
 *   1. Monkey-patches history.pushState/replaceState to intercept React Router
 *   2. Shows a seamless overlay (captures current page appearance)
 *   3. Triggers window.location.href for a full page load
 *   4. The overlay persists visually until the new page renders
 *
 * Also handles:
 *   - Sidebar button click interception (capturing phase)
 *   - Trailing slash normalization (all URLs end with /)
 *   - Both with-slash and without-slash URLs resolve correctly
 */

let navData = null;
let knownPaths = new Set();

async function loadNavData() {
  try {
    const resp = await fetch('/docs-nav.json');
    if (!resp.ok) return;
    navData = await resp.json();

    function collectPaths(items) {
      for (const item of items) {
        if (item.path) {
          const normalized = item.path.replace(/\/$/, '');
          knownPaths.add(normalized);
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
 * Normalize a path: strip trailing slash (except root).
 */
function normalizePath(p) {
  const cleaned = (p || '/').replace(/\/$/, '');
  return cleaned || '/';
}

/**
 * Show a seamless overlay that covers the viewport instantly.
 * This prevents the flash during full page reload — the dark overlay
 * appears immediately (no transition), hiding the page teardown.
 */
function showTransitionOverlay() {
  // If an overlay already exists, skip
  if (document.getElementById('aiui-nav-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'aiui-nav-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 99999;
    background: #0f172a;
    pointer-events: none;
    opacity: 1;
  `;
  document.body.appendChild(overlay);
}

/**
 * Full-page navigate to a doc path with an anti-flash overlay.
 * Always uses trailing slash.
 */
function navigateFullPage(path) {
  const normalized = normalizePath(path);
  const current = normalizePath(window.location.pathname);

  if (normalized === current) return;

  const urlWithSlash = normalized === '/' ? '/' : normalized + '/';

  // Show overlay BEFORE the navigation
  showTransitionOverlay();

  // Small delay to let the overlay render, then navigate
  setTimeout(() => {
    window.location.href = urlWithSlash;
  }, 50);

  console.debug('[AIUI:nav-intercept] Navigate:', current, '→', urlWithSlash);
}

/**
 * Intercept sidebar button/link clicks in the capturing phase.
 */
function interceptSidebarClicks() {
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('aside button, aside a');
    if (!btn) return;

    // Skip group headers
    const text = btn.textContent.trim();
    if (!text) return;
    if (btn.className && /uppercase/.test(btn.className)) return;

    // Convert button text to slug and match against known paths
    const slug = text.toLowerCase().replace(/\s+/g, '-');

    for (const knownPath of knownPaths) {
      const pathSlug = knownPath.split('/').pop();
      if (pathSlug === slug) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        navigateFullPage(knownPath);
        return;
      }
    }

    // Also check <a> tags with href
    if (btn.tagName === 'A' && btn.href) {
      try {
        const url = new URL(btn.href, window.location.origin);
        const normalized = normalizePath(url.pathname);
        if (knownPaths.has(normalized)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          navigateFullPage(normalized);
          return;
        }
      } catch (err) {}
    }
  }, true); // capturing phase

  console.debug('[AIUI:nav-intercept] Sidebar click interception active');
}

/**
 * Patch history.pushState/replaceState to intercept React Router navigations.
 */
function patchHistoryPushState() {
  const originalPushState = history.pushState.bind(history);

  history.pushState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try { path = new URL(url, window.location.origin).pathname; } catch (e) {}

      const normalized = normalizePath(path);
      const current = normalizePath(window.location.pathname);

      if (knownPaths.has(normalized) && normalized !== current) {
        navigateFullPage(normalized);
        return;
      }
    }
    return originalPushState(state, title, url);
  };
}

function patchHistoryReplaceState() {
  const originalReplaceState = history.replaceState.bind(history);

  history.replaceState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path = url;
      try { path = new URL(url, window.location.origin).pathname; } catch (e) {}

      const normalized = normalizePath(path);
      const current = normalizePath(window.location.pathname);

      if (knownPaths.has(normalized) && normalized !== current) {
        navigateFullPage(normalized);
        return;
      }
    }
    return originalReplaceState(state, title, url);
  };
}

export default {
  name: 'nav-intercept',
  async init() {
    await loadNavData();
    interceptSidebarClicks();
    patchHistoryPushState();
    patchHistoryReplaceState();
    console.debug('[AIUI:nav-intercept] Full page loads with overlay —', knownPaths.size, 'routes.');
  },
  onContentChange() {
    // Remove overlay if it's still showing (back/forward navigation)
    const overlay = document.getElementById('aiui-nav-overlay');
    if (overlay) overlay.remove();
  },
};
