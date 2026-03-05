/**
 * AIUI Homepage Plugin
 *
 * Replaces the hardcoded debug/developer landing page with actual
 * documentation content from docs/index.md.
 *
 * IMPORTANT: Does NOT use replaceWith/removeChild on React-managed
 * nodes to avoid crashing React's reconciler. Instead, hides the
 * debug content via CSS and appends new content as a sibling.
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

async function replaceHomepage(root) {
  if (hasRendered) return;
  if (!isHomepage()) return;
  if (!isDebugHomepage(root)) return;

  hasRendered = true;

  try {
    const response = await fetch('/docs/index.md');
    if (!response.ok) return;
    const markdown = await response.text();

    const main = root.querySelector('main.flex-1');
    if (!main) return;

    // HIDE React's debug content instead of removing it
    Array.from(main.children).forEach(function (child) {
      child.style.display = 'none';
    });

    // Append our content as a new child (React won't try to reconcile it)
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
    // Reset if navigated away and back
    if (!isHomepage() && hasRendered) {
      hasRendered = false;
      const old = document.querySelector('[data-aiui-plugin="homepage"]');
      if (old) old.remove();
    }
    replaceHomepage(root);
  },
};
