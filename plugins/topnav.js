/**
 * AIUI Top Navigation Plugin
 *
 * Implements Mintlify-style tab navigation:
 *  – Renders a tab bar below the header
 *  – Clicking a tab filters the sidebar via CSS (no React DOM mutation)
 *  – Auto-detects the active tab from which sidebar group contains the current page
 *
 * CRITICAL: This plugin NEVER sets style.display or modifies attributes on
 * React-managed elements. All visibility is controlled via an injected <style>
 * tag with nth-child selectors. This prevents React reconciler crashes.
 */

let tabConfig = null;
let configLoaded = false;
let currentTabIndex = 0;

async function loadConfig() {
  if (configLoaded) return;
  configLoaded = true;
  try {
    const resp = await fetch('/ui-config.json');
    if (!resp.ok) return;
    const config = await resp.json();
    tabConfig = config.navigation;
  } catch (e) {
    console.warn('[AIUI:topnav] Config load error:', e);
  }
}

/* ------------------------------------------------------------------ */
/*  Sidebar group discovery                                            */
/* ------------------------------------------------------------------ */

/**
 * Find all sidebar sections in the DOM (read-only, no mutations).
 */
function getSidebarSections() {
  const nav = document.querySelector('aside nav');
  if (!nav) return [];

  const sections = [];
  const children = nav.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.tagName === 'BUTTON') {
      sections.push({
        index: i,
        headerText: child.textContent.trim().toLowerCase(),
        isStandalone: true,
      });
    } else if (child.tagName === 'DIV') {
      const headerEl = child.querySelector('[class*="uppercase"]');
      if (headerEl) {
        sections.push({
          index: i,
          headerText: headerEl.textContent.trim().toLowerCase(),
          isStandalone: false,
        });
      }
    }
  }
  return sections;
}

/* ------------------------------------------------------------------ */
/*  Tab ↔ sidebar group matching                                       */
/* ------------------------------------------------------------------ */

function sectionBelongsToTab(section, tab) {
  if (!tab.groups) return false;
  for (const grp of tab.groups) {
    const groupName = grp.group.toLowerCase();
    if (section.headerText === groupName) return true;

    // Also match by prefix: prefix "api" matches sidebar header "api"
    if (grp.prefix && section.headerText === grp.prefix.toLowerCase()) return true;

    if (section.isStandalone && grp.pages) {
      for (const page of grp.pages) {
        const slug = page.split('/').pop().replace(/-/g, ' ');
        if (section.headerText === slug) return true;
        if (section.headerText === page.toLowerCase()) return true;
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  CSS-only sidebar filtering (NEVER touches React DOM)               */
/* ------------------------------------------------------------------ */

/**
 * Inject/update a <style> tag that hides sidebar items by nth-child.
 * This is React-safe because we only modify our own <style> element.
 */
function filterSidebarCSS(tabIndex) {
  const tabs = tabConfig.tabs;
  const tab = tabs[tabIndex];
  currentTabIndex = tabIndex;

  let styleEl = document.getElementById('aiui-topnav-filter');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aiui-topnav-filter';
    document.head.appendChild(styleEl);
  }

  // Find which children indices to HIDE
  const sections = getSidebarSections();
  const hiddenIndices = [];

  for (const section of sections) {
    if (!sectionBelongsToTab(section, tab)) {
      hiddenIndices.push(section.index);
    }
  }

  // Generate CSS rules using nth-child (1-indexed)
  if (hiddenIndices.length > 0) {
    const rules = hiddenIndices.map(
      (i) => `aside nav > :nth-child(${i + 1})`
    ).join(',\n');
    styleEl.textContent = `${rules} { display: none !important; }`;
  } else {
    styleEl.textContent = '';
  }
}

/* ------------------------------------------------------------------ */
/*  Active tab detection (read-only)                                    */
/* ------------------------------------------------------------------ */

function detectActiveTab(tabs) {
  // 1. URL-based detection (highest priority)
  //    Check more-specific tabs first by iterating in reverse
  //    (API Reference has prefix "api" — more specific than Documentation's many groups)
  const path = window.location.pathname.toLowerCase();
  // Find the best match: prefer the tab whose prefix appears latest in the URL
  // e.g. /docs/api/features-api/ should match "api" prefix
  let bestMatch = -1;
  let bestMatchLen = 0;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab.groups) continue;
    for (const grp of tab.groups) {
      if (!grp.prefix) continue;
      const needle = '/' + grp.prefix.toLowerCase() + '/';
      if (path.includes(needle) && needle.length > bestMatchLen) {
        bestMatch = i;
        bestMatchLen = needle.length;
      }
    }
  }
  if (bestMatch >= 0) return bestMatch;

  // 2. DOM-based detection (fallback)
  const activeBtn = document.querySelector(
    'aside button[class*="font-medium"], aside button[class*="bg-accent"]'
  );
  if (!activeBtn) return 0; // Default to first tab

  const nav = document.querySelector('aside nav');
  if (!nav) return 0;

  const sections = getSidebarSections();
  for (const section of sections) {
    const child = nav.children[section.index];
    const containsActive = section.isStandalone
      ? child === activeBtn
      : child.contains(activeBtn);

    if (containsActive) {
      for (let i = 0; i < tabs.length; i++) {
        if (sectionBelongsToTab(section, tabs[i])) return i;
      }
    }
  }

  return 0; // Default to first tab
}

/* ------------------------------------------------------------------ */
/*  Tab bar rendering                                                   */
/* ------------------------------------------------------------------ */

function renderTabBar(root) {
  if (!tabConfig || !tabConfig.tabs || tabConfig.tabs.length === 0) return;

  const existing = document.querySelector('[data-aiui-plugin="topnav"]');
  if (existing) {
    updateActiveHighlight();
    return;
  }

  const tabs = tabConfig.tabs;
  const activeIdx = detectActiveTab(tabs);

  const header = root.querySelector('header');
  if (!header) return;

  // Create tab bar OUTSIDE React's managed tree (insertAdjacentElement is safe)
  const bar = document.createElement('nav');
  bar.dataset.aiuiPlugin = 'topnav';
  bar.className = 'aiui-topnav';

  const inner = document.createElement('div');
  inner.className = 'aiui-topnav-inner';

  tabs.forEach(function (tab, idx) {
    const el = document.createElement('button');
    el.className = 'aiui-topnav-tab' + (idx === activeIdx ? ' aiui-topnav-active' : '');
    el.textContent = tab.tab;
    el.dataset.tabIndex = idx;

    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      inner.querySelectorAll('.aiui-topnav-tab').forEach(t =>
        t.classList.remove('aiui-topnav-active')
      );
      el.classList.add('aiui-topnav-active');

      // Filter sidebar with CSS only — no React DOM mutation
      filterSidebarCSS(idx);
    });

    inner.appendChild(el);
  });

  bar.appendChild(inner);
  header.insertAdjacentElement('afterend', bar);

  // Apply sidebar filtering immediately on first render
  filterSidebarCSS(activeIdx);
}

function updateActiveHighlight() {
  if (!tabConfig || !tabConfig.tabs) return;
  const bar = document.querySelector('[data-aiui-plugin="topnav"]');
  if (!bar) return;

  const activeIdx = detectActiveTab(tabConfig.tabs);
  bar.querySelectorAll('.aiui-topnav-tab').forEach((tab, idx) => {
    tab.classList.toggle('aiui-topnav-active', idx === activeIdx);
  });

  // Also re-apply sidebar filtering for the detected tab
  filterSidebarCSS(activeIdx);
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

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
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
      cursor: pointer;
      transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      letter-spacing: 0.01em;
      font-family: inherit;
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
      .aiui-topnav-inner { padding: 0 0.75rem; }
      .aiui-topnav-tab { padding: 0.5rem 0.625rem; font-size: 0.75rem; }
    }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Active sidebar item highlighting (URL-based)                       */
/* ------------------------------------------------------------------ */

/**
 * Highlight the sidebar button that matches the current URL.
 * React doesn't add active classes to sidebar items, so we do it via CSS.
 */
function highlightActiveSidebarItem() {
  // Clean up any previous highlight
  let styleEl = document.getElementById('aiui-sidebar-highlight');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aiui-sidebar-highlight';
    document.head.appendChild(styleEl);
  }

  const path = window.location.pathname.replace(/\/$/, '') || '/';
  
  // Homepage doesn't have a sidebar item to highlight
  if (path === '/' || path === '/index.html') {
    styleEl.textContent = '';
    return;
  }

  // Extract the page slug from the URL
  // e.g. /docs/getting-started/installation → "installation"
  // e.g. /features/model-fallback → "model fallback"
  const slug = path.split('/').pop().replace(/-/g, ' ').toLowerCase();
  if (!slug) {
    styleEl.textContent = '';
    return;
  }

  // Find all sidebar nav buttons
  const nav = document.querySelector('aside nav');
  if (!nav) return;

  const buttons = nav.querySelectorAll('button');
  let matchIndex = -1;

  for (let i = 0; i < buttons.length; i++) {
    const btnText = buttons[i].textContent.trim().toLowerCase();
    if (btnText === slug) {
      // Find this button's index among nav's children (for nth-child)
      // Walk up to find the parent child index in nav
      let el = buttons[i];
      while (el.parentElement && el.parentElement !== nav) {
        el = el.parentElement;
      }
      const children = Array.from(nav.children);
      matchIndex = children.indexOf(el);
      break;
    }
  }

  if (matchIndex >= 0) {
    // Target the specific nav child and any button inside it
    styleEl.textContent = `
      aside nav > :nth-child(${matchIndex + 1}) button,
      aside nav > :nth-child(${matchIndex + 1}).aiui-sidebar-active-item {
        border-left: 3px solid #38bdf8 !important;
        padding-left: calc(1rem - 3px) !important;
        color: #e2e8f0 !important;
        font-weight: 500 !important;
      }
    `;
  } else {
    styleEl.textContent = '';
  }
}

/* ------------------------------------------------------------------ */
/*  Plugin export                                                       */
/* ------------------------------------------------------------------ */

export default {
  name: 'topnav',
  async init() {
    injectStyles();
    await loadConfig();
    console.debug('[AIUI:topnav] Loaded.', tabConfig ? tabConfig.tabs.length + ' tabs' : 'No tabs');
  },
  onContentChange(root) {
    if (!tabConfig) return;
    renderTabBar(root);
    highlightActiveSidebarItem();
  },
};

