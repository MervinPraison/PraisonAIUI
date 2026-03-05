/**
 * AIUI Mermaid Plugin
 * 
 * Renders mermaid code blocks (```mermaid) as SVG diagrams.
 * Uses the official mermaid library loaded from CDN.
 */

let mermaidLoaded = false;
let mermaidReady = false;

/**
 * Load mermaid.js from CDN.
 */
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
  } catch (err) {
    console.warn('[AIUI:mermaid] Failed to load mermaid library:', err);
  }
}

/**
 * Find all unrendered mermaid code blocks and render them.
 * Handles both standard markdown (code.language-mermaid) and
 * Prism.js rendered blocks (code with language-mermaid class).
 */
async function renderMermaidBlocks(root) {
  if (!mermaidReady || !window.__aiuiMermaid) return;

  // Strategy 1: look for code.language-mermaid (standard + Prism)
  let codeBlocks = root.querySelectorAll('code.language-mermaid, code[class*="language-mermaid"]');

  // Strategy 2: if none found, look for CodeBlock components that wrap mermaid
  // The React CodeBlock renders: <div><div(header)><div(code area)><pre><code>
  if (codeBlocks.length === 0) {
    // Check all code blocks and see if any parent has mermaid indicator
    const allCode = root.querySelectorAll('pre code, code.block');
    codeBlocks = Array.from(allCode).filter(code => {
      const text = code.textContent.trim();
      // Heuristic: detect mermaid syntax patterns
      return /^(graph\s+[TBLR]{2}|flowchart\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|sankey|xychart)/m.test(text);
    });
  }

  if (codeBlocks.length === 0) return;

  for (const codeEl of codeBlocks) {
    // Walk up to find the outermost pre or container
    let container = codeEl.closest('pre') || codeEl.parentElement;
    if (!container) continue;

    // For the React CodeBlock component, go up to the wrapping div with the header
    const codeBlockWrapper = container.closest('.relative, [class*="rounded"]');
    if (codeBlockWrapper && codeBlockWrapper.querySelector('button')) {
      // This is the full CodeBlock component (with copy button header)
      container = codeBlockWrapper;
    }

    // Skip already-rendered blocks
    if (container.dataset.mermaidRendered) continue;

    const graphDefinition = codeEl.textContent.trim();
    if (!graphDefinition) continue;

    try {
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { svg } = await window.__aiuiMermaid.render(id, graphDefinition);

      // Replace the container with the rendered SVG
      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.style.cssText = 'display:flex;justify-content:center;margin:1rem 0;overflow-x:auto;';
      diagram.innerHTML = svg;

      container.replaceWith(diagram);
    } catch (err) {
      // Mark as attempted to avoid infinite retries
      container.dataset.mermaidRendered = 'error';
      console.warn('[AIUI:mermaid] Render error:', err.message);
    }
  }
}

export default {
  name: 'mermaid',

  async init() {
    await loadMermaidLib();
  },

  onContentChange(root) {
    renderMermaidBlocks(root);
  },
};
