/**
 * AIUI Homepage Plugin
 *
 * Replaces the hardcoded debug/developer landing page with actual
 * documentation content from docs/index.md.
 *
 * CRITICAL: Does NOT set style.display or any properties on React-managed
 * DOM nodes. All visibility is controlled via a <style> tag with CSS
 * selectors. This prevents React reconciler crashes (removeChild errors).
 */

let hasRendered = false;

function isHomepage() {
  const path = window.location.pathname;
  return path === '/' || path === '/index.html' || path === '';
}

function isDebugHomepage(root) {
  const h2s = root.querySelectorAll('h2');
  for (const h2 of h2s) {
    if (h2.textContent.trim() === 'Theme Configuration') return true;
  }
  return false;
}

/**
 * Inject CSS that hides the debug homepage content.
 * Uses a body class + CSS so we NEVER touch React elements directly.
 */
function setHomepageMode(active) {
  let styleEl = document.getElementById('aiui-homepage-css');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aiui-homepage-css';
    document.head.appendChild(styleEl);
  }

  if (active) {
    // Hide all direct children of main EXCEPT our injected article
    styleEl.textContent = `
      body.aiui-homepage-active main.flex-1 > :not([data-aiui-plugin="homepage"]) {
        display: none !important;
      }
    `;
    document.body.classList.add('aiui-homepage-active');
  } else {
    styleEl.textContent = '';
    document.body.classList.remove('aiui-homepage-active');
  }
}

async function replaceHomepage(root) {
  if (hasRendered) return;
  if (!isHomepage()) return;
  if (!isDebugHomepage(root)) return;

  hasRendered = true;

  const main = root.querySelector('main.flex-1');
  if (!main) return;

  // Hide React's debug content immediately (before fetch)
  setHomepageMode(true);

  try {
    const response = await fetch('/docs/index.md');
    if (!response.ok) {
      setHomepageMode(false);  // Restore if no markdown found
      hasRendered = false;
      return;
    }
    const markdown = await response.text();

    // Append our content as a new child (React won't reconcile it)
    const article = document.createElement('article');
    article.className = 'prose max-w-none dark:prose-invert p-6';
    article.dataset.aiuiPlugin = 'homepage';
    article.innerHTML = simpleMarkdownToHtml(markdown);
    main.appendChild(article);
  } catch (err) {
    console.warn('[AIUI:homepage] Failed to load homepage content:', err);
  }
}

function simpleMarkdownToHtml(md) {
  let html = md
    .replace(/<div[^>]*markdown[^>]*>/gi, '')
    .replace(/<\/div>/gi, '')
    .replace(/===\s+"([^"]+)"/g, '**$1**')
    .replace(/:material-[\w-]+:/g, '•')
    .replace(/:octicons-[\w-]+(?:-\d+)?:/g, '•');

  const lines = html.split('\n');
  const result = [];
  let inCodeBlock = false, codeContent = '', codeLang = '';
  let listItems = [];

  function flushList() {
    if (listItems.length > 0) {
      result.push('<ul>' + listItems.join('') + '</ul>');
      listItems = [];
    }
  }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre><code class="language-${codeLang}">${escapeHtml(codeContent.trim())}</code></pre>`);
        inCodeBlock = false; codeContent = '';
      } else {
        flushList(); inCodeBlock = true;
        codeLang = line.trim().replace('```', '') || 'text';
      }
      continue;
    }
    if (inCodeBlock) { codeContent += line + '\n'; continue; }

    const trimmed = line.trim();
    if (trimmed === '') { flushList(); continue; }

    const hm = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      flushList();
      const lvl = hm[1].length;
      const id = hm[2].toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      result.push(`<h${lvl} id="${id}">${inlineMarkdown(hm[2])}</h${lvl}>`);
      continue;
    }
    if (/^[-*_]{3,}$/.test(trimmed)) { flushList(); result.push('<hr>'); continue; }
    const lm = trimmed.match(/^[-*+]\s+(.*)/);
    if (lm) { listItems.push(`<li>${inlineMarkdown(lm[1])}</li>`); continue; }
    const om = trimmed.match(/^\d+\.\s+(.*)/);
    if (om) { listItems.push(`<li>${inlineMarkdown(om[1])}</li>`); continue; }

    flushList();
    result.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }
  flushList();
  return result.join('\n');
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, function (m) { return map[m]; });
}

export default {
  name: 'homepage',
  init() { console.debug('[AIUI:homepage] Homepage plugin loaded.'); },
  onContentChange(root) {
    // When navigating away from homepage, clean up
    if (!isHomepage() && hasRendered) {
      hasRendered = false;
      // Remove our injected article (this is OUR element, not React's)
      const old = document.querySelector('[data-aiui-plugin="homepage"]');
      if (old) old.remove();
      // Lift the CSS hiding rule
      setHomepageMode(false);
    }
    replaceHomepage(root);
  },
};
