/**
 * AIUI Fetch Retry Plugin
 *
 * Intercepts fetch() calls for the docs manifests (docs-nav.json,
 * ui-config.json, route-manifest.json) and retries a network error or 5xx
 * with exponential backoff (CDN cache propagation, transient network issues).
 *
 * Docs markdown (.md) is not handled here: the React docs loader
 * (src/frontend/src/docs/docLoader.ts) gives each request a time limit,
 * retries it and caches the answer. Two retry layers would multiply attempts.
 * An aborted request (the reader moved on) is never retried.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const RETRIED = ['docs-nav.json', 'ui-config.json', 'route-manifest.json'];

function isAbort(err, init) {
  return (init && init.signal && init.signal.aborted) || (err && err.name === 'AbortError');
}

export default {
  name: 'fetch-retry',

  init() {
    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url;
      const path = url ? url.split(/[?#]/)[0] : '';
      const shouldRetry = path && RETRIED.some((name) => path.endsWith(name));

      if (!shouldRetry) {
        return originalFetch.call(this, input, init);
      }

      let lastError;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await originalFetch.call(this, input, init);
          if (response.status < 500) {
            // 2xx, and 4xx such as 404 ("not found"), are answers: don't retry
            return response;
          }
          // Server error (5xx) — retry
          lastError = new Error(`HTTP ${response.status}`);
        } catch (err) {
          if (isAbort(err, init)) throw err;
          // Network error — retry
          lastError = err;
        }

        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.debug(
            `[AIUI:fetch-retry] Retrying ${url} (attempt ${attempt + 1}/${MAX_RETRIES}, wait ${delay}ms)`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (init && init.signal && init.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        }
      }

      // All retries exhausted — throw the last error
      throw lastError;
    };

    console.debug('[AIUI:fetch-retry] Fetch retry interceptor installed.');
  },
};
