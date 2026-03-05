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
      const url = `${PLUGINS_BASE}${name}.js`;
      const mod = await import(url);
      const plugin = mod.default || mod;
      plugin.name = plugin.name || name;

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
   * Main entry point — fetch config, load plugins, observe changes.
   */
  async function main() {
    try {
      const res = await fetch(PLUGINS_CONFIG);
      if (!res.ok) {
        console.debug('[AIUI] No plugins.json found, skipping plugins.');
        return;
      }

      const config = await res.json();
      const pluginNames = config.plugins || [];

      if (pluginNames.length === 0) return;

      // Load all plugins in parallel
      await Promise.allSettled(pluginNames.map(loadPlugin));

      // Set up observer for SPA content changes
      observeContentChanges();

      // Initial content change notification (content may already be loaded)
      setTimeout(notifyContentChange, 500);

      console.debug(`[AIUI] ${loadedPlugins.length} plugin(s) active.`);
    } catch (err) {
      console.warn('[AIUI] Plugin loader error:', err);
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
