/**
 * AIUI Top Navigation Plugin
 *
 * Implements Mintlify-style tab navigation:
 *  – Renders a tab bar below the header
 *  – Clicking a tab filters the sidebar (hides non-matching groups, shows matching ones)
 *  – Does NOT click sidebar buttons (that would break the React app)
 *  – Auto-detects the active tab from which sidebar group contains the current page
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
 * Find all sidebar sections in the DOM.
 * The sidebar structure is:
 *   <nav>
 *     <button>PraisonAIUI</button>          ← standalone page
 *     <button>Testing</button>              ← standalone page
 *     <div>                                 ← GROUP section
 *       <div class="uppercase">Api</div>    ← group header
 *       <div class="space-y-0.5">           ← group items
 *         <button>CLI API Reference</button>
 *       </div>
 *     </div>
 *   </nav>
 */
function getSidebarSections() {
  const nav = document.querySelector('aside nav');
  if (!nav) return [];

  const sections = [];
  for (const child of nav.children) {
    if (child.tagName === 'BUTTON') {
      sections.push({
        headerText: child.textContent.trim().toLowerCase(),
        element: child,
        isStandalone: true,
      });
    } else if (child.tagName === 'DIV') {
      // Group section – find the header element (has 'uppercase' in class)
      const headerEl = child.querySelector('[class*="uppercase"]');
      if (headerEl) {
        sections.push({
          headerText: headerEl.textContent.trim().toLowerCase(),
          element: child,
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

/**
 * Check if a sidebar section belongs to a tab.
 */
function sectionBelongsToTab(section, tab) {
  if (!tab.groups) return false;

  for (const grp of tab.groups) {
    const groupName = grp.group.toLowerCase();
    
    // Direct match on group name
    if (section.headerText === groupName) return true;
    
    // Match standalone pages by name
    if (section.isStandalone) {
      if (grp.pages) {
        for (const page of grp.pages) {
          const slug = page.split('/').pop().replace(/-/g, ' ');
          if (section.headerText === slug) return true;
          // Also match exact page name
          if (section.headerText === page.toLowerCase()) return true;
        }
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Active tab detection                                                */
/* ------------------------------------------------------------------ */

/**
 * Detect which tab is active based on which sidebar button is highlighted.
 */
function detectActiveTab(tabs) {
  const activeBtn = document.querySelector(
    'aside button[class*="font-medium"], aside button[class*="bg-accent"]'
  );
  if (!activeBtn) return 0;

  const sections = getSidebarSections();

  for (const section of sections) {
    // Check if this section contains the active button
    const containsActive = section.isStandalone
      ? section.element === activeBtn
      : section.element.contains(activeBtn);

    if (containsActive) {
      for (let i = 0; i < tabs.length; i++) {
        if (sectionBelongsToTab(section, tabs[i])) return i;
      }
    }
  }

  return currentTabIndex;
}

/* ------------------------------------------------------------------ */
/*  Tab switching: sidebar filter only (NO navigation)                  */
/* ------------------------------------------------------------------ */

function filterSidebar(tabIndex) {
  const tabs = tabConfig.tabs;
  const tab = tabs[tabIndex];
  const sections = getSidebarSections();
  
  if (sections.length === 0) return;

  currentTabIndex = tabIndex;

  // Home tab or tab with url="/" → show everything
  if (tab.url === '/') {
    for (const section of sections) {
      section.element.style.display = '';
    }
    return;
  }

  // Filter: show only sections belonging to this tab
  for (const section of sections) {
    const belongs = sectionBelongsToTab(section, tab);
    section.element.style.display = belongs ? '' : 'none';
  }
}

/* ------------------------------------------------------------------ */
/*  Tab bar rendering                                                   */
/* ------------------------------------------------------------------ */

function renderTabBar(root) {
  if (!tabConfig || !tabConfig.tabs || tabConfig.tabs.length === 0) return;

  const existing = document.querySelector('[data-aiui-plugin="topnav"]');
  if (existing) {
    // Just update active state
    updateActiveHighlight();
    return;
  }

  const tabs = tabConfig.tabs;
  const activeIdx = detectActiveTab(tabs);

  const header = root.querySelector('header');
  if (!header) return;

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

      // Update active styling on tabs
      inner.querySelectorAll('.aiui-topnav-tab').forEach(t =>
        t.classList.remove('aiui-topnav-active')
      );
      el.classList.add('aiui-topnav-active');

      // Filter sidebar to show only this tab's groups
      filterSidebar(idx);
    });

    inner.appendChild(el);
  });

  bar.appendChild(inner);
  header.insertAdjacentElement('afterend', bar);
}

function updateActiveHighlight() {
  if (!tabConfig || !tabConfig.tabs) return;
  const bar = document.querySelector('[data-aiui-plugin="topnav"]');
  if (!bar) return;

  const activeIdx = detectActiveTab(tabConfig.tabs);
  bar.querySelectorAll('.aiui-topnav-tab').forEach((tab, idx) => {
    tab.classList.toggle('aiui-topnav-active', idx === activeIdx);
  });
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
  },
};
