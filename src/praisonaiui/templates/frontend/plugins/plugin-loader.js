console.log('[AIUI Loader] Starting...');

/**
 * AIUI Plugin Loader
 * 
 * Core infrastructure that loads and manages frontend plugins.
 * Each plugin is a self-contained JS module with init() and onContentChange() hooks.
 * 
 * Plugin contract:
 *   - name: string           — unique identifier
 *   - init(): Promise<void>  — called once on load
 *   - onContentChange(root): void — called when SPA content changes
 */
(function () {
  'use strict';

  const PLUGINS_CONFIG = '/plugins/plugins.json';
  const PLUGINS_BASE = '/plugins/';
  const ROOT_SELECTOR = '#root';

  /** @type {Array<{name: string, init?: Function, onContentChange?: Function}>} */
  const loadedPlugins = [];

  /**
   * Dynamically import a plugin module and call its init().
   */
  async function loadPlugin(name) {
    try {
      const url = `${PLUGINS_BASE}${name}.js?v=${Date.now()}`;
      const mod = await import(url);
      // ESM module namespaces are frozen — spread into a mutable object
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

  /**
   * Notify all plugins that content has changed.
   */
  function notifyContentChange() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    for (const plugin of loadedPlugins) {
      if (typeof plugin.onContentChange === 'function') {
        try {
          plugin.onContentChange(root);
        } catch (err) {
          console.warn(`[AIUI] Plugin "${plugin.name}" error in onContentChange:`, err);
        }
      }
    }
  }

  /**
   * Set up MutationObserver to detect SPA content changes.
   */
  function observeContentChanges() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      // Debounce rapid DOM mutations (SPA transitions)
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(notifyContentChange, 150);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Remove the server-injected anti-flicker CSS after plugins have rendered.
   */
  function removeAntiFlicker() {
    const el = document.getElementById('aiui-anti-flicker');
    if (el) el.remove();
  }

  /**
   * Main entry point — fetch config, load plugins, observe changes.
   */
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

      // Load all plugins in parallel
      await Promise.allSettled(pluginNames.map(loadPlugin));

      // Set up observer for SPA content changes
      observeContentChanges();

      // Initial content change — immediate, no delay
      notifyContentChange();

      // Remove the anti-flicker CSS now that plugins have rendered
      removeAntiFlicker();

      console.debug(`[AIUI] ${loadedPlugins.length} plugin(s) active.`);
    } catch (err) {
      console.warn('[AIUI] Plugin loader error:', err);
      removeAntiFlicker();
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
