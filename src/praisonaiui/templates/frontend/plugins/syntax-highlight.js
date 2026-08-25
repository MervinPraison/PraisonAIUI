/**
 * AIUI Syntax Highlighting Plugin
 *
 * Adds colourful syntax highlighting to code blocks using highlight.js.
 * Loads from CDN – no build step required.
 */

let hljsReady = false;
let pendingHighlight = false;
let currentTheme = null;

const HLJS_VERSION = '11.9.0';
const HLJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HLJS_VERSION}`;

function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

function getHljsTheme() {
  return isDarkMode() ? 'github-dark' : 'github';
}

function applyPreStyles() {
  const dark = isDarkMode();
  let override = document.getElementById('aiui-hljs-overrides');
  if (!override) {
    override = document.createElement('style');
    override.id = 'aiui-hljs-overrides';
    document.head.appendChild(override);
  }

  override.textContent = `
    pre code.hljs {
      background: transparent !important;
      padding: 0 !important;
      color: inherit !important;
    }
    pre {
      background: ${dark ? 'rgba(15, 23, 42, 0.6)' : 'var(--muted, #f4f4f5)'} !important;
      color: ${dark ? 'inherit' : 'var(--foreground, #18181b)'} !important;
      border: 1px solid ${dark ? 'rgba(148, 163, 184, 0.1)' : 'var(--border, #e4e4e7)'};
      border-radius: 0.5rem;
      padding: 1rem !important;
      overflow-x: auto;
    }
  `;
}

/**
 * Load highlight.js CSS theme and core script from CDN.
 */
function loadHljs() {
  return new Promise((resolve) => {
    const theme = getHljsTheme();
    currentTheme = theme;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'aiui-hljs-theme';
    link.href = `${HLJS_CDN}/styles/${theme}.min.css`;
    document.head.appendChild(link);

    applyPreStyles();

    const script = document.createElement('script');
    script.src = `${HLJS_CDN}/highlight.min.js`;
    script.onload = () => {
      hljsReady = true;
      console.debug('[AIUI:syntax] highlight.js core loaded');

      const langs = ['python', 'yaml', 'bash', 'javascript', 'typescript', 'json', 'css', 'html', 'xml'];
      let loaded = 0;
      for (const lang of langs) {
        const ls = document.createElement('script');
        ls.src = `${HLJS_CDN}/languages/${lang}.min.js`;
        ls.onload = () => {
          loaded++;
          if (loaded >= langs.length) {
            console.debug('[AIUI:syntax] All languages loaded');
            if (pendingHighlight) {
              pendingHighlight = false;
              highlightCodeBlocks();
            }
          }
        };
        document.head.appendChild(ls);
      }

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

function swapThemeIfNeeded() {
  const theme = getHljsTheme();
  if (theme === currentTheme) {
    applyPreStyles();
    return;
  }

  currentTheme = theme;
  const link = document.getElementById('aiui-hljs-theme');
  if (link) {
    link.href = `${HLJS_CDN}/styles/${theme}.min.css`;
  }
  applyPreStyles();

  for (const block of document.querySelectorAll('pre code[data-hljs-highlighted]')) {
    delete block.dataset.hljsHighlighted;
    block.removeAttribute('data-highlighted');
    block.classList.remove('hljs');
  }
  highlightCodeBlocks();
}

/**
 * Highlight all unprocessed code blocks.
 */
function highlightCodeBlocks() {
  if (!hljsReady || typeof hljs === 'undefined') {
    pendingHighlight = true;
    return;
  }

  swapThemeIfNeeded();

  const blocks = document.querySelectorAll('pre code:not([data-hljs-highlighted])');
  for (const block of blocks) {
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

    const observer = new MutationObserver(() => swapThemeIfNeeded());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    console.debug('[AIUI:syntax] Plugin loaded.');
  },
  onContentChange() {
    highlightCodeBlocks();
    setTimeout(highlightCodeBlocks, 300);
    setTimeout(highlightCodeBlocks, 800);
  },
};
