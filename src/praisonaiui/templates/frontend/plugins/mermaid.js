/**
 * AIUI Mermaid Plugin
 *
 * Renders mermaid code blocks as beautiful SVG diagrams with
 * transparent backgrounds and a premium color palette that
 * matches the dark documentation theme.
 *
 * IMPORTANT: Hides the original code block via CSS and inserts
 * the SVG diagram as a sibling to avoid React reconciler crashes.
 */

let mermaidLoaded = false;
let mermaidReady = false;

/**
 * Premium color palette for dark mode mermaid diagrams.
 */
const DARK_THEME = {
  theme: 'base',
  themeVariables: {
    // Background — fully transparent
    background: 'transparent',
    mainBkg: 'transparent',

    // Primary nodes — teal/cyan gradient feel
    primaryColor: '#1a3a4a',
    primaryBorderColor: '#38bdf8',
    primaryTextColor: '#e2e8f0',

    // Secondary nodes — purple accent
    secondaryColor: '#2d1f4e',
    secondaryBorderColor: '#a78bfa',
    secondaryTextColor: '#e2e8f0',

    // Tertiary nodes — emerald accent
    tertiaryColor: '#1a3a2a',
    tertiaryBorderColor: '#34d399',
    tertiaryTextColor: '#e2e8f0',

    // Text and labels
    textColor: '#e2e8f0',
    labelTextColor: '#cbd5e1',

    // Lines and arrows
    lineColor: '#64748b',
    arrowheadColor: '#94a3b8',

    // Flowchart specific
    nodeBorder: '#38bdf8',
    clusterBkg: 'rgba(56, 189, 248, 0.06)',
    clusterBorder: 'rgba(56, 189, 248, 0.25)',
    defaultLinkColor: '#64748b',
    edgeLabelBackground: 'rgba(15, 23, 42, 0.8)',
    nodeTextColor: '#e2e8f0',

    // Sequence diagram
    actorBkg: '#1a3a4a',
    actorBorder: '#38bdf8',
    actorTextColor: '#e2e8f0',
    actorLineColor: '#475569',
    signalColor: '#94a3b8',
    signalTextColor: '#e2e8f0',
    activationBorderColor: '#38bdf8',
    activationBkgColor: 'rgba(56, 189, 248, 0.1)',
    sequenceNumberColor: '#0f172a',

    // Notes
    noteBkgColor: 'rgba(167, 139, 250, 0.15)',
    noteBorderColor: '#a78bfa',
    noteTextColor: '#e2e8f0',

    // Title
    titleColor: '#f1f5f9',

    // Fonts
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: '14px',
  },
};

const LIGHT_THEME = {
  theme: 'base',
  themeVariables: {
    background: 'transparent',
    mainBkg: 'transparent',

    primaryColor: '#dbeafe',
    primaryBorderColor: '#3b82f6',
    primaryTextColor: '#1e293b',

    secondaryColor: '#ede9fe',
    secondaryBorderColor: '#8b5cf6',
    secondaryTextColor: '#1e293b',

    tertiaryColor: '#d1fae5',
    tertiaryBorderColor: '#10b981',
    tertiaryTextColor: '#1e293b',

    textColor: '#1e293b',
    labelTextColor: '#475569',
    lineColor: '#94a3b8',
    arrowheadColor: '#64748b',

    nodeBorder: '#3b82f6',
    clusterBkg: 'rgba(59, 130, 246, 0.06)',
    clusterBorder: 'rgba(59, 130, 246, 0.25)',
    defaultLinkColor: '#94a3b8',
    edgeLabelBackground: 'rgba(255, 255, 255, 0.9)',
    nodeTextColor: '#1e293b',

    actorBkg: '#dbeafe',
    actorBorder: '#3b82f6',
    actorTextColor: '#1e293b',
    actorLineColor: '#cbd5e1',
    signalColor: '#64748b',
    signalTextColor: '#1e293b',

    noteBkgColor: 'rgba(139, 92, 246, 0.1)',
    noteBorderColor: '#8b5cf6',
    noteTextColor: '#1e293b',

    titleColor: '#0f172a',
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    fontSize: '14px',
  },
};

/**
 * Inject CSS for mermaid diagram containers.
 */
function injectStyles() {
  if (document.getElementById('aiui-mermaid-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-mermaid-styles';
  style.textContent = `
    .mermaid-diagram {
      display: flex;
      justify-content: center;
      margin: 1.5rem 0;
      padding: 1.5rem;
      border-radius: 12px;
      background: rgba(56, 189, 248, 0.04);
      border: 1px solid rgba(56, 189, 248, 0.12);
      overflow-x: auto;
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
    }
    .mermaid-diagram:hover {
      border-color: rgba(56, 189, 248, 0.3);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.08);
    }
    .mermaid-diagram svg {
      max-width: 100%;
      height: auto;
    }
    /* Make text crisper */
    .mermaid-diagram .nodeLabel,
    .mermaid-diagram .edgeLabel,
    .mermaid-diagram .label {
      font-family: "Inter", system-ui, -apple-system, sans-serif !important;
    }
    /* Smooth node borders */
    .mermaid-diagram .node rect,
    .mermaid-diagram .node circle,
    .mermaid-diagram .node polygon {
      rx: 8;
      ry: 8;
    }
    /* Subgraph labels */
    .mermaid-diagram .cluster-label .nodeLabel {
      font-weight: 600;
      font-size: 0.9em;
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
  return /^(graph\s+[TBLR]{2}|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|sankey|xychart)/m.test(text);
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

      // HIDE original (React still owns it)
      container.style.display = 'none';

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

export default {
  name: 'mermaid',
  async init() { await loadMermaidLib(); },
  onContentChange(root) {
    // Clean up previous diagrams on navigation
    root.querySelectorAll('[data-aiui-plugin="mermaid"]').forEach(function (el) { el.remove(); });
    root.querySelectorAll('[data-mermaid-processed]').forEach(function (el) {
      el.style.display = '';
      delete el.dataset.mermaidProcessed;
    });
    renderMermaidBlocks(root);
  },
};
