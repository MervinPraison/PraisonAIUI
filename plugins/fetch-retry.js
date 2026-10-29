/**
 * AIUI Fetch Retry Plugin
 * 
 * Intercepts fetch() calls for .md files and adds exponential backoff retry.
 * Fixes intermittent "Failed to load content" errors caused by CDN cache
 * propagation or transient network issues.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export default {
  name: 'fetch-retry',

  init() {
    const originalFetch = window.fetch;

    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url;

      // Only retry markdown file fetches and config JSON
      const shouldRetry =
        url &&
        (url.endsWith('.md') ||
          url.endsWith('docs-nav.json') ||
          url.endsWith('ui-config.json') ||
          url.endsWith('route-manifest.json'));

      if (!shouldRetry) {
        return originalFetch.call(this, input, init);
      }

      let lastError;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await originalFetch.call(this, input, init);
          if (response.ok || response.status === 404) {
            // 404 is a valid "not found" — don't retry
            return response;
          }
          // Server error (5xx) — retry
          lastError = new Error(`HTTP ${response.status}`);
        } catch (err) {
          // Network error — retry
          lastError = err;
        }

        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          console.debug(
            `[AIUI:fetch-retry] Retrying ${url} (attempt ${attempt + 1}/${MAX_RETRIES}, wait ${delay}ms)`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // All retries exhausted — throw the last error
      throw lastError;
    };

    console.debug('[AIUI:fetch-retry] Fetch retry interceptor installed.');
  },
};
