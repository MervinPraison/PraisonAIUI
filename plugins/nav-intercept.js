/**
 * AIUI Navigation Intercept Plugin
 *
 * Implements true SPA navigation for docs pages:
 *   1. Intercepts sidebar clicks in the CAPTURE phase on `document`
 *      (before React 18's event delegation on `#root` can see them)
 *   2. Calls stopPropagation() so React Router never learns about the click
 *   3. Updates URL via native History.prototype.pushState (bypasses
 *      React Router's monkey-patch of window.history.pushState)
 *   4. Dispatches `aiui:navigate` custom event so content-loader.js
 *      fetches & swaps the markdown in-place — no page reload
 *
 * Also patches window.history.pushState / replaceState so if React Router
 * tries to navigate on its own, we intercept that too.
 */

// ── Native pushState — captured BEFORE React Router can patch it ─────
const _nativePushState = History.prototype.pushState;
const _nativeReplaceState = History.prototype.replaceState;

let knownPaths = new Set();

/* ── Load navigation data ────────────────────────────────────────── */

async function loadNavData() {
  try {
    const resp = await fetch('/docs-nav.json');
    if (!resp.ok) return;
    const data = await resp.json();

    function collectPaths(items) {
      for (const item of items) {
        if (item.path) {
          knownPaths.add(normalizePath(item.path));
        }
        if (item.children) collectPaths(item.children);
      }
    }
    collectPaths(data.items || []);
    console.debug('[AIUI:nav] Loaded', knownPaths.size, 'known paths');
  } catch (e) {
    // Silently continue — nav data is optional
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function normalizePath(p) {
  const cleaned = (p || '/').replace(/\/+$/, '');
  return cleaned || '/';
}

/* ── SPA Navigation ──────────────────────────────────────────────── */

/**
 * Navigate to a path WITHOUT a page reload.
 *   - Updates URL via native pushState (React Router can't see it)
 *   - Dispatches aiui:navigate so content-loader.js swaps content
 */
function spaNavigate(path) {
  const target = normalizePath(path);
  const current = normalizePath(window.location.pathname);
  if (target === current) return;

  const targetUrl = target === '/' ? '/' : target + '/';

  // Update browser URL using the NATIVE pushState (not React Router's wrapper)
  _nativePushState.call(window.history, null, '', targetUrl);

  // Tell content-loader + topnav + homepage plugins to update
  window.dispatchEvent(new CustomEvent('aiui:navigate', {
    detail: { path: target, fromPath: current }
  }));

  // Scroll to top
  window.scrollTo(0, 0);

  console.debug('[AIUI:nav] SPA:', current, '→', target);
}

/* ── Click interception ──────────────────────────────────────────── */

function interceptClicks() {
  // CAPTURE phase on document — fires BEFORE React 18's event delegation on #root
  document.addEventListener('click', function (e) {
    // Only intercept sidebar nav buttons/links
    const btn = e.target.closest('aside button, aside a');
    if (!btn) return;

    // Skip group headers (uppercase section labels like "CONCEPTS", "FEATURES")
    if (btn.className && /uppercase/.test(btn.className)) return;
    const text = btn.textContent.trim();
    if (!text) return;

    // Try to match by <a> href first (most reliable)
    if (btn.tagName === 'A' && btn.href) {
      try {
        const url = new URL(btn.href, window.location.origin);
        if (url.origin === window.location.origin) {
          const normalized = normalizePath(url.pathname);
          if (knownPaths.has(normalized)) {
            e.preventDefault();
            e.stopPropagation();        // stops event before it reaches #root
            e.stopImmediatePropagation();
            spaNavigate(normalized);
            return;
          }
        }
      } catch (_) {}
    }

    // Fallback: match button text to a known slug
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const knownPath of knownPaths) {
      const pathSlug = knownPath.split('/').pop();
      if (pathSlug === slug) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        spaNavigate(knownPath);
        return;
      }
    }
  }, true); // true = capture phase
}

/* ── History monkey-patch (catches React Router's own pushState calls) ── */

function patchHistory() {
  // Save whatever pushState currently is (may already be wrapped by React Router)
  const wrappedPush = window.history.pushState;
  const wrappedReplace = window.history.replaceState;

  window.history.pushState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path;
      try { path = new URL(url, window.location.origin).pathname; } catch (_) { path = url; }
      const normalized = normalizePath(path);
      const current = normalizePath(window.location.pathname);

      if (knownPaths.has(normalized) && normalized !== current) {
        // Hijack: do SPA navigation instead of React Router's navigation
        spaNavigate(normalized);
        return; // don't call the wrapped pushState
      }
    }
    return wrappedPush.call(this, state, title, url);
  };

  window.history.replaceState = function (state, title, url) {
    if (url && typeof url === 'string') {
      let path;
      try { path = new URL(url, window.location.origin).pathname; } catch (_) { path = url; }
      const normalized = normalizePath(path);
      const current = normalizePath(window.location.pathname);

      if (knownPaths.has(normalized) && normalized !== current) {
        spaNavigate(normalized);
        return;
      }
    }
    return wrappedReplace.call(this, state, title, url);
  };
}

/* ── Handle browser back/forward ─────────────────────────────────── */

function handlePopState() {
  window.addEventListener('popstate', function () {
    const path = normalizePath(window.location.pathname);
    // Dispatch navigate event so content-loader handles it
    window.dispatchEvent(new CustomEvent('aiui:navigate', {
      detail: { path: path, fromPath: '' }
    }));
  });
}

/* ── Plugin export ───────────────────────────────────────────────── */

export default {
  name: 'nav-intercept',
  async init() {
    await loadNavData();
    interceptClicks();
    patchHistory();
    handlePopState();
    console.debug('[AIUI:nav] SPA navigation active —', knownPaths.size, 'routes');
  },
  onContentChange() {
    // Clean up any leftover overlay from previous approach
    const overlay = document.getElementById('aiui-nav-overlay');
    if (overlay) overlay.remove();
  },
};
