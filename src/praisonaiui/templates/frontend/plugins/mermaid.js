/**
 * AIUI Mermaid Plugin
 *
 * Renders mermaid code blocks as beautiful SVG diagrams with
 * high-contrast, Mintlify-inspired styling and transparent backgrounds.
 *
 * IMPORTANT: Hides the original code block via CSS and inserts
 * the SVG diagram as a sibling to avoid React reconciler crashes.
 */

let mermaidLoaded = false;
let mermaidReady = false;

/** Inject CSS for hiding mermaid originals (React-safe, no inline style mutations). */
function ensureMermaidCSS() {
  if (document.getElementById('aiui-mermaid-css')) return;
  const s = document.createElement('style');
  s.id = 'aiui-mermaid-css';
  s.textContent = '.aiui-mermaid-hidden { display: none !important; }';
  document.head.appendChild(s);
}

/**
 * High-contrast dark theme — Mintlify-inspired vibrant colors.
 */
const DARK_THEME = {
  theme: 'base',
  themeVariables: {
    // Background
    background: 'transparent',
    mainBkg: '#0d9488',          // Vibrant teal for primary nodes

    // Primary nodes — teal (like Mintlify green)
    primaryColor: '#0d9488',
    primaryBorderColor: '#14b8a6',
    primaryTextColor: '#ffffff',

    // Secondary nodes — indigo/purple
    secondaryColor: '#6366f1',
    secondaryBorderColor: '#818cf8',
    secondaryTextColor: '#ffffff',

    // Tertiary nodes — rose/red
    tertiaryColor: '#e11d48',
    tertiaryBorderColor: '#fb7185',
    tertiaryTextColor: '#ffffff',

    // Text and labels — high contrast white
    textColor: '#f1f5f9',
    labelTextColor: '#f1f5f9',

    // Lines and arrows — visible but not harsh
    lineColor: '#94a3b8',
    arrowheadColor: '#cbd5e1',

    // Flowchart
    nodeBorder: '#14b8a6',
    clusterBkg: 'rgba(13, 148, 136, 0.08)',
    clusterBorder: 'rgba(20, 184, 166, 0.4)',
    defaultLinkColor: '#94a3b8',
    edgeLabelBackground: 'rgba(15, 23, 42, 0.85)',
    nodeTextColor: '#ffffff',

    // Sequence diagram
    actorBkg: '#0d9488',
    actorBorder: '#14b8a6',
    actorTextColor: '#ffffff',
    actorLineColor: '#64748b',
    signalColor: '#cbd5e1',
    signalTextColor: '#f1f5f9',
    activationBorderColor: '#14b8a6',
    activationBkgColor: 'rgba(13, 148, 136, 0.2)',
    sequenceNumberColor: '#ffffff',

    // Notes — purple tint
    noteBkgColor: 'rgba(99, 102, 241, 0.2)',
    noteBorderColor: '#818cf8',
    noteTextColor: '#f1f5f9',

    // Title
    titleColor: '#f8fafc',

    // Fonts
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: '14px',
  },
};

const LIGHT_THEME = {
  theme: 'base',
  themeVariables: {
    background: 'transparent',
    mainBkg: '#0d9488',

    primaryColor: '#0d9488',
    primaryBorderColor: '#0f766e',
    primaryTextColor: '#ffffff',

    secondaryColor: '#6366f1',
    secondaryBorderColor: '#4f46e5',
    secondaryTextColor: '#ffffff',

    tertiaryColor: '#e11d48',
    tertiaryBorderColor: '#be123c',
    tertiaryTextColor: '#ffffff',

    textColor: '#1e293b',
    labelTextColor: '#334155',
    lineColor: '#94a3b8',
    arrowheadColor: '#64748b',

    nodeBorder: '#0f766e',
    clusterBkg: 'rgba(13, 148, 136, 0.06)',
    clusterBorder: 'rgba(15, 118, 110, 0.3)',
    defaultLinkColor: '#94a3b8',
    edgeLabelBackground: 'rgba(255, 255, 255, 0.9)',
    nodeTextColor: '#ffffff',

    actorBkg: '#0d9488',
    actorBorder: '#0f766e',
    actorTextColor: '#ffffff',
    actorLineColor: '#cbd5e1',
    signalColor: '#64748b',
    signalTextColor: '#1e293b',

    noteBkgColor: 'rgba(99, 102, 241, 0.1)',
    noteBorderColor: '#6366f1',
    noteTextColor: '#1e293b',

    titleColor: '#0f172a',
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: '14px',
  },
};

/**
 * Inject CSS for mermaid diagram containers + page title fix.
 */
function injectStyles() {
  if (document.getElementById('aiui-mermaid-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-mermaid-styles';
  style.textContent = `
    /* Mermaid diagram container */
    .mermaid-diagram {
      display: flex;
      justify-content: center;
      margin: 1.5rem 0;
      padding: 1.5rem;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.15);
      overflow-x: auto;
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
    }
    .mermaid-diagram:hover {
      border-color: rgba(20, 184, 166, 0.4);
      box-shadow: 0 0 24px rgba(13, 148, 136, 0.12);
    }
    .mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }
    /* Force high-contrast text in nodes */
    .mermaid-diagram .nodeLabel,
    .mermaid-diagram .label div,
    .mermaid-diagram .cluster-label .nodeLabel {
      color: #ffffff !important;
      fill: #ffffff !important;
      font-family: "Inter", system-ui, -apple-system, sans-serif !important;
      font-weight: 500 !important;
    }
    .mermaid-diagram .edgeLabel {
      color: #e2e8f0 !important;
      fill: #e2e8f0 !important;
      background-color: rgba(15, 23, 42, 0.85) !important;
      padding: 2px 6px;
      border-radius: 4px;
    }
    /* Cluster / subgraph labels */
    .mermaid-diagram .cluster-label .nodeLabel {
      font-weight: 600 !important;
      font-size: 0.95em;
    }
    /* Rounded nodes */
    .mermaid-diagram .node rect,
    .mermaid-diagram .node circle,
    .mermaid-diagram .node polygon {
      rx: 8;
      ry: 8;
    }

    /* ===== Heading visibility fix ===== */
    /* Headings use gradient/opacity that's nearly invisible in dark mode */
    article.prose h1, article.prose h2, article.prose h3,
    article.prose h4, article.prose h5, article.prose h6,
    main h1, main h2, main h3, main h4, main h5, main h6,
    .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
      color: #f1f5f9 !important;
      opacity: 1 !important;
      -webkit-text-fill-color: #f1f5f9 !important;
      background: none !important;
      -webkit-background-clip: unset !important;
      background-clip: unset !important;
    }
  `;
  document.head.appendChild(style);
}

async function loadMermaidLib() {
  if (mermaidLoaded) return;
  mermaidLoaded = true;
  try {
    const mermaid = await import(
      'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
    );
    const isDark = document.documentElement.classList.contains('dark');
    const themeConfig = isDark ? DARK_THEME : LIGHT_THEME;

    mermaid.default.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      ...themeConfig,
    });
    window.__aiuiMermaid = mermaid.default;
    mermaidReady = true;
    injectStyles();
    console.debug('[AIUI:mermaid] Mermaid loaded with', isDark ? 'dark' : 'light', 'theme.');
  } catch (err) {
    console.warn('[AIUI:mermaid] Failed to load mermaid library:', err);
  }
}

/**
 * Detect mermaid syntax in a text string.
 */
function isMermaidSyntax(text) {
  return /^(graph\s+(TD|TB|BT|LR|RL)|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|sankey|xychart|block-beta|requirement)/m.test(text);
}

/**
 * Find and render mermaid code blocks.
 */
async function renderMermaidBlocks(root) {
  if (!mermaidReady || !window.__aiuiMermaid) return;

  let targets = [];

  // Strategy 1: language-mermaid class
  const byClass = root.querySelectorAll('code.language-mermaid, code[class*="language-mermaid"]');
  byClass.forEach(function (code) { targets.push(code); });

  // Strategy 2: syntax heuristic
  if (targets.length === 0) {
    const allCode = root.querySelectorAll('pre code, code.block');
    allCode.forEach(function (code) {
      if (isMermaidSyntax(code.textContent.trim())) targets.push(code);
    });
  }

  if (targets.length === 0) return;

  for (const codeEl of targets) {
    let container = codeEl.closest('pre') || codeEl.parentElement;
    if (!container) continue;

    // Find the full CodeBlock wrapper (with copy button header)
    const wrapper = container.closest('.relative, [class*="rounded"]');
    if (wrapper && wrapper.querySelector('button')) {
      container = wrapper;
    }

    if (container.dataset.mermaidProcessed) continue;
    container.dataset.mermaidProcessed = 'true';

    const graphDef = codeEl.textContent.trim();
    if (!graphDef) continue;

    try {
      const id = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const { svg } = await window.__aiuiMermaid.render(id, graphDef);

      // HIDE original via CSS class (don't use style.display — breaks React reconciler)
      ensureMermaidCSS();
      container.classList.add('aiui-mermaid-hidden');

      // INSERT diagram as sibling
      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.dataset.aiuiPlugin = 'mermaid';
      diagram.innerHTML = svg;
      container.parentNode.insertBefore(diagram, container.nextSibling);
    } catch (err) {
      console.warn('[AIUI:mermaid] Render error:', err.message);
    }
  }
}

let lastUrl = '';

export default {
  name: 'mermaid',
  async init() { await loadMermaidLib(); },
  onContentChange(root) {
    const currentUrl = location.pathname + location.hash;

    // Only tear down on actual navigation
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      root.querySelectorAll('[data-aiui-plugin="mermaid"]').forEach(function (el) { el.remove(); });
      root.querySelectorAll('[data-mermaid-processed]').forEach(function (el) {
        el.classList.remove('aiui-mermaid-hidden');
        delete el.dataset.mermaidProcessed;
      });
    }

    // Render any unprocessed blocks (idempotent — skips already-processed)
    renderMermaidBlocks(root);
  },
};
