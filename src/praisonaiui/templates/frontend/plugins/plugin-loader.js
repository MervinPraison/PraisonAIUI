console.log('[AIUI Loader] Starting...');

/**
 * AIUI Plugin Loader
 *
 * Loads frontend plugins and notifies them only on explicit content events.
 * Avoids MutationObserver during React reconciliation (prevents removeChild crashes).
 */
(function () {
  'use strict';

  const PLUGINS_CONFIG = '/plugins/plugins.json';
  const PLUGINS_BASE = '/plugins/';
  const ROOT_SELECTOR = '#root';

  /** @type {Array<{name: string, init?: Function, onContentChange?: Function}>} */
  const loadedPlugins = [];
  let spaNavigating = false;

  function isReactDocsActive() {
    return Boolean(document.querySelector('#main-content article.prose'));
  }

  function isReactDocsRoot(root) {
    if (!root) return isReactDocsActive();
    if (root.matches && root.matches('#main-content article.prose')) return true;
    if (root.closest && root.closest('#main-content article.prose')) return true;
    return isReactDocsActive();
  }

  async function loadPlugin(name) {
    try {
      const url = `${PLUGINS_BASE}${name}.js?v=${Date.now()}`;
      const mod = await import(url);
      const raw = mod.default || mod;
      const plugin = { ...raw, name: raw.name || name };

      if (typeof plugin.init === 'function') {
        await plugin.init();
      }

      loadedPlugins.push(plugin);
      console.debug(`[AIUI] Plugin loaded: ${name}`);
    } catch (err) {
      console.warn(`[AIUI] Failed to load plugin "${name}":`, err);
    }
  }

  function teardownPluginDom(root) {
    if (!root || isReactDocsActive()) return;
    root.querySelectorAll('[data-aiui-plugin]').forEach(function (el) { el.remove(); });
    root.querySelectorAll('[data-mermaid-processed]').forEach(function (el) {
      el.classList.remove('aiui-mermaid-hidden');
      delete el.dataset.mermaidProcessed;
    });
    root.querySelectorAll('.aiui-code-wrapper').forEach(function (wrapper) {
      const pre = wrapper.querySelector('pre');
      if (pre && wrapper.parentNode) {
        wrapper.parentNode.insertBefore(pre, wrapper);
        wrapper.remove();
      }
    });
    root.querySelectorAll('pre.aiui-code-has-copy > .aiui-copy-btn').forEach(function (btn) {
      btn.remove();
    });
    root.querySelectorAll('pre[data-copy-processed]').forEach(function (pre) {
      pre.classList.remove('aiui-code-has-copy');
      delete pre.dataset.copyProcessed;
    });
  }

  function notifyContentChange(root) {
    if (spaNavigating || isReactDocsRoot(root)) return;
    const target = root || document.querySelector(ROOT_SELECTOR);
    if (!target) return;

    for (const plugin of loadedPlugins) {
      if (typeof plugin.onContentChange === 'function') {
        try {
          plugin.onContentChange(target);
        } catch (err) {
          console.warn(`[AIUI] Plugin "${plugin.name}" error in onContentChange:`, err);
        }
      }
    }
  }

  function bindContentEvents() {
    window.addEventListener('aiui:navigate', function () {
      spaNavigating = true;
      teardownPluginDom(document.querySelector(ROOT_SELECTOR));
    });

    window.addEventListener('aiui:content-loaded', function (event) {
      spaNavigating = false;
      const root = event.detail && event.detail.root;
      if (isReactDocsRoot(root)) return;
      window.requestAnimationFrame(function () {
        notifyContentChange(root || document.querySelector(ROOT_SELECTOR));
      });
    });
  }

  function removeAntiFlicker() {
    const el = document.getElementById('aiui-anti-flicker');
    if (el) el.remove();
  }

  async function main() {
    try {
      const res = await fetch(PLUGINS_CONFIG);
      if (!res.ok) {
        console.debug('[AIUI] No plugins.json found, skipping plugins.');
        removeAntiFlicker();
        return;
      }

      const config = await res.json();
      const pluginNames = config.plugins || [];

      if (pluginNames.length === 0) {
        removeAntiFlicker();
        return;
      }

      bindContentEvents();
      await Promise.allSettled(pluginNames.map(loadPlugin));
      if (!isReactDocsActive()) {
        notifyContentChange(document.querySelector(ROOT_SELECTOR));
      }
      removeAntiFlicker();

      console.debug(`[AIUI] ${loadedPlugins.length} plugin(s) active.`);
    } catch (err) {
      console.warn('[AIUI] Plugin loader error:', err);
      removeAntiFlicker();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
