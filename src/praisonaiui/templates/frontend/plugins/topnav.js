/**
 * AIUI Top Navigation Plugin
 *
 * Renders a Mintlify-style top tab bar below the header.
 * Reads tab configuration from ui-config.json and highlights
 * the active tab based on the current page path.
 *
 * Navigation: Clicks the matching sidebar link (React-managed)
 * to trigger proper SPA routing instead of full page reload.
 */

let tabConfig = null;
let configLoaded = false;
let lastRenderedUrl = '';

async function loadConfig() {
  if (configLoaded) return;
  configLoaded = true;
  try {
    const resp = await fetch('/ui-config.json');
    if (!resp.ok) return;
    const config = await resp.json();
    tabConfig = config.navigation;
  } catch (e) {
    console.warn('[AIUI:topnav] Failed to load config:', e);
  }
}

function getActiveTabIndex(tabs) {
  const path = window.location.pathname;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    // Direct URL match
    if (tab.url && (path === tab.url || path === tab.url + '/')) return i;

    if (tab.groups) {
      for (const group of tab.groups) {
        if (group.prefix) {
          const prefix = '/docs/' + group.prefix;
          if (path.startsWith(prefix + '/') || path === prefix) return i;
        }
        if (group.pages) {
          for (const page of group.pages) {
            const pagePath = '/docs/' + page;
            if (path === pagePath || path === pagePath + '/') return i;
          }
        }
      }
    }
  }

  if (path === '/' || path === '' || path === '/index.html') return 0;
  return 0;
}

function getFirstPagePath(tab) {
  if (tab.groups) {
    for (const group of tab.groups) {
      if (group.pages && group.pages.length > 0) {
        return '/docs/' + group.pages[0];
      }
    }
  }
  return null;
}

/**
 * Navigate by finding a sidebar link that matches the target path
 * and clicking it — this triggers React's internal routing.
 * Falls back to window.location if no sidebar link is found.
 */
function navigateToPage(targetPath) {
  // First, look for a sidebar link with matching href
  const sidebarLinks = document.querySelectorAll('aside a[href], nav a[href]');
  for (const link of sidebarLinks) {
    const href = link.getAttribute('href');
    if (href === targetPath || href === targetPath + '/' || 
        targetPath === href + '/' ||
        (href && targetPath && href.endsWith(targetPath.replace('/docs/', '')))) {
      link.click();
      return;
    }
  }

  // Also try matching by text content of sidebar buttons
  const buttons = document.querySelectorAll('aside button, nav button');
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    const targetName = targetPath.split('/').pop().replace(/-/g, ' ');
    if (text === targetName) {
      btn.click();
      return;
    }
  }

  // Last resort: full page navigation
  window.location.href = targetPath;
}

function renderTabBar(root) {
  if (!tabConfig || !tabConfig.tabs || tabConfig.tabs.length === 0) return;

  const newUrl = window.location.pathname;
  if (lastRenderedUrl === newUrl && document.querySelector('[data-aiui-plugin="topnav"]')) return;
  lastRenderedUrl = newUrl;

  // Remove old tab bar
  const old = document.querySelector('[data-aiui-plugin="topnav"]');
  if (old) old.remove();

  const tabs = tabConfig.tabs;
  const activeIdx = getActiveTabIndex(tabs);

  const header = root.querySelector('header');
  if (!header) return;

  const bar = document.createElement('nav');
  bar.dataset.aiuiPlugin = 'topnav';
  bar.className = 'aiui-topnav';

  const inner = document.createElement('div');
  inner.className = 'aiui-topnav-inner';

  tabs.forEach(function (tab, idx) {
    const a = document.createElement('a');
    const firstPage = getFirstPagePath(tab);
    a.href = tab.url || firstPage || '/';
    a.className = 'aiui-topnav-tab' + (idx === activeIdx ? ' aiui-topnav-active' : '');
    a.textContent = tab.tab;

    a.addEventListener('click', function (e) {
      e.preventDefault();
      const target = tab.url || firstPage;
      if (!target || target === '/') {
        // Home tab — navigate to root
        window.location.href = '/';
        return;
      }
      navigateToPage(target);
      // Update active state immediately
      inner.querySelectorAll('.aiui-topnav-tab').forEach(function (t) {
        t.classList.remove('aiui-topnav-active');
      });
      a.classList.add('aiui-topnav-active');
    });

    inner.appendChild(a);
  });

  bar.appendChild(inner);
  header.insertAdjacentElement('afterend', bar);
}

function injectStyles() {
  if (document.querySelector('#aiui-topnav-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-topnav-styles';
  style.textContent = `
    .aiui-topnav {
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.97) 0%, rgba(15, 23, 42, 0.90) 100%);
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      position: sticky;
      top: 0;
      z-index: 40;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .aiui-topnav::-webkit-scrollbar { display: none; }

    .aiui-topnav-inner {
      display: flex;
      align-items: center;
      gap: 0;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .aiui-topnav-tab {
      display: inline-flex;
      align-items: center;
      padding: 0.625rem 1rem;
      font-size: 0.8125rem;
      font-weight: 500;
      color: rgba(148, 163, 184, 0.75);
      text-decoration: none;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      letter-spacing: 0.01em;
      cursor: pointer;
    }

    .aiui-topnav-tab:hover {
      color: #e2e8f0;
      background: rgba(148, 163, 184, 0.06);
    }

    .aiui-topnav-active {
      color: #38bdf8 !important;
      border-bottom-color: #38bdf8;
      font-weight: 600;
    }

    @media (max-width: 768px) {
      .aiui-topnav-inner {
        padding: 0 0.75rem;
      }
      .aiui-topnav-tab {
        padding: 0.5rem 0.625rem;
        font-size: 0.75rem;
      }
    }
  `;
  document.head.appendChild(style);
}

export default {
  name: 'topnav',
  async init() {
    injectStyles();
    await loadConfig();
    console.debug('[AIUI:topnav] Top navigation plugin loaded.');
  },
  onContentChange(root) {
    if (!tabConfig) return;
    renderTabBar(root);
  },
};
