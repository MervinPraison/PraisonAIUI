/**
 * AIUI Syntax Highlighting Plugin
 *
 * Adds colorful syntax highlighting to code blocks using highlight.js.
 * Loads from CDN – no build step required.
 */

let hljsReady = false;
let pendingHighlight = false;

const HLJS_VERSION = '11.9.0';
const HLJS_THEME = 'github-dark';
const HLJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HLJS_VERSION}`;

/**
 * Load highlight.js CSS theme and core script from CDN.
 */
function loadHljs() {
  return new Promise((resolve) => {
    // Load theme CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${HLJS_CDN}/styles/${HLJS_THEME}.min.css`;
    document.head.appendChild(link);

    // Override styles for better integration
    const override = document.createElement('style');
    override.id = 'aiui-hljs-overrides';
    override.textContent = `
      pre code.hljs {
        background: transparent !important;
        padding: 0 !important;
      }
      pre {
        background: rgba(15, 23, 42, 0.6) !important;
        border: 1px solid rgba(148, 163, 184, 0.1);
        border-radius: 0.5rem;
        padding: 1rem !important;
        overflow-x: auto;
      }
    `;
    document.head.appendChild(override);

    // Load highlight.js core
    const script = document.createElement('script');
    script.src = `${HLJS_CDN}/highlight.min.js`;
    script.onload = () => {
      hljsReady = true;
      console.debug('[AIUI:syntax] highlight.js core loaded');
      
      // Load additional language packs
      const langs = ['python', 'yaml', 'bash', 'javascript', 'typescript', 'json', 'css', 'html', 'xml'];
      let loaded = 0;
      for (const lang of langs) {
        const ls = document.createElement('script');
        ls.src = `${HLJS_CDN}/languages/${lang}.min.js`;
        ls.onload = () => {
          loaded++;
          if (loaded >= langs.length) {
            console.debug('[AIUI:syntax] All languages loaded');
            // Highlight any pending content
            if (pendingHighlight) {
              pendingHighlight = false;
              highlightCodeBlocks();
            }
          }
        };
        document.head.appendChild(ls);
      }

      // Also highlight immediately with core languages
      setTimeout(() => highlightCodeBlocks(), 200);
      resolve();
    };
    script.onerror = () => {
      console.warn('[AIUI:syntax] Failed to load highlight.js');
      resolve();
    };
    document.head.appendChild(script);
  });
}

/**
 * Highlight all unprocessed code blocks.
 */
function highlightCodeBlocks() {
  if (!hljsReady || typeof hljs === 'undefined') {
    pendingHighlight = true;
    return;
  }

  const blocks = document.querySelectorAll('pre code:not([data-hljs-highlighted])');
  for (const block of blocks) {
    // Skip mermaid blocks
    if (block.classList.contains('language-mermaid') ||
        block.closest('.mermaid') ||
        block.closest('[data-aiui-plugin="mermaid"]')) {
      continue;
    }

    try {
      hljs.highlightElement(block);
      block.dataset.hljsHighlighted = 'true';
    } catch (e) {
      // Silently ignore
    }
  }
}

export default {
  name: 'syntax-highlight',
  async init() {
    await loadHljs();
    console.debug('[AIUI:syntax] Plugin loaded.');
  },
  onContentChange() {
    // Try immediately and with delay (for dynamically inserted content)
    highlightCodeBlocks();
    setTimeout(highlightCodeBlocks, 300);
    setTimeout(highlightCodeBlocks, 800);
  },
};
