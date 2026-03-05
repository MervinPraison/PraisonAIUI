/**
 * AIUI Mermaid Plugin
 *
 * Renders mermaid code blocks as SVG diagrams.
 * Uses the official mermaid library loaded from CDN.
 *
 * IMPORTANT: Hides the original code block via CSS and inserts
 * the SVG diagram as a sibling to avoid React reconciler crashes.
 */

let mermaidLoaded = false;
let mermaidReady = false;

async function loadMermaidLib() {
  if (mermaidLoaded) return;
  mermaidLoaded = true;
  try {
    const mermaid = await import(
      'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
    );
    mermaid.default.initialize({
      startOnLoad: false,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    });
    window.__aiuiMermaid = mermaid.default;
    mermaidReady = true;
    console.debug('[AIUI:mermaid] Mermaid library loaded.');
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
 * Strategy: find code blocks via class OR syntax heuristic,
 * then HIDE the original and INSERT diagram as sibling.
 */
async function renderMermaidBlocks(root) {
  if (!mermaidReady || !window.__aiuiMermaid) return;

  // Find code blocks: by class first, then by syntax heuristic
  let targets = [];

  // Strategy 1: language-mermaid class
  const byClass = root.querySelectorAll('code.language-mermaid, code[class*="language-mermaid"]');
  byClass.forEach(function (code) { targets.push(code); });

  // Strategy 2: syntax heuristic for all code blocks
  if (targets.length === 0) {
    const allCode = root.querySelectorAll('pre code, code.block');
    allCode.forEach(function (code) {
      if (isMermaidSyntax(code.textContent.trim())) targets.push(code);
    });
  }

  if (targets.length === 0) return;

  for (const codeEl of targets) {
    // Find the outermost container (CodeBlock component or <pre>)
    let container = codeEl.closest('pre') || codeEl.parentElement;
    if (!container) continue;

    // Try to find the full CodeBlock wrapper (has copy button)
    const wrapper = container.closest('.relative, [class*="rounded"]');
    if (wrapper && wrapper.querySelector('button')) {
      container = wrapper;
    }

    // Skip already-processed blocks
    if (container.dataset.mermaidProcessed) continue;
    container.dataset.mermaidProcessed = 'true';

    const graphDef = codeEl.textContent.trim();
    if (!graphDef) continue;

    try {
      const id = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const { svg } = await window.__aiuiMermaid.render(id, graphDef);

      // HIDE the original code block (don't remove — React still owns it)
      container.style.display = 'none';

      // INSERT diagram as a sibling AFTER the hidden block
      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.dataset.aiuiPlugin = 'mermaid';
      diagram.style.cssText = 'display:flex;justify-content:center;margin:1rem 0;overflow-x:auto;';
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
    // Clean up previous plugin-generated diagrams on navigation
    root.querySelectorAll('[data-aiui-plugin="mermaid"]').forEach(function (el) { el.remove(); });
    // Restore hidden code blocks
    root.querySelectorAll('[data-mermaid-processed]').forEach(function (el) {
      el.style.display = '';
      delete el.dataset.mermaidProcessed;
    });
    renderMermaidBlocks(root);
  },
};
