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
 */
async function renderMermaidBlocks(root) {
  if (!mermaidReady || !window.__aiuiMermaid) return;

  // react-markdown renders ```mermaid as <pre><code class="language-mermaid">
  const codeBlocks = root.querySelectorAll('code.language-mermaid');
  if (codeBlocks.length === 0) return;

  for (const codeEl of codeBlocks) {
    const pre = codeEl.parentElement;
    if (!pre || pre.tagName !== 'PRE') continue;
    // Skip already-rendered blocks
    if (pre.dataset.mermaidRendered) continue;

    const graphDefinition = codeEl.textContent.trim();
    if (!graphDefinition) continue;

    try {
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { svg } = await window.__aiuiMermaid.render(id, graphDefinition);

      // Replace the <pre> block with the rendered SVG
      const container = document.createElement('div');
      container.className = 'mermaid-diagram';
      container.style.cssText = 'display:flex;justify-content:center;margin:1rem 0;overflow-x:auto;';
      container.innerHTML = svg;

      pre.replaceWith(container);
    } catch (err) {
      // Mark as attempted to avoid infinite retries
      pre.dataset.mermaidRendered = 'error';
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
