/**
 * AIUI Content Loader Plugin
 *
 * Loads page-specific markdown content based on the current URL.
 * Replaces the default React debug/template view with actual docs content.
 *
 * SPA sidebar navigation is owned by React (App.tsx syncs on aiui:navigate).
 * This plugin only injects markdown for the initial debug shell and as a
 * fallback when React fails to render visible content.
 *
 * URL mapping: /docs/getting-started/installation/ → /docs/getting-started/installation.md
 */

let currentPath = '';
let loadedPath = '';
let spaNavigating = false;
let navGen = 0;

/** Match React Content.tsx prose classes so light-mode contrast CSS applies. */
const PROSE_ARTICLE_CLASS =
  'prose prose-neutral dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:text-foreground prose-code:text-foreground p-6';

function getMarkdownPath() {
  let path = window.location.pathname;
  if (path === '/' || path === '/index.html' || path === '') {
    return '/docs/index.md';
  }
  path = path.replace(/\/$/, '');
  return path + '.md';
}

function pathToMd(path) {
  const normalized = (path || '/').replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === '/index.html') {
    return '/docs/index.md';
  }
  return normalized + '.md';
}

function setContentMode(active) {
  let styleEl = document.getElementById('aiui-content-loader-css');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aiui-content-loader-css';
    document.head.appendChild(styleEl);
  }

  if (active) {
    styleEl.textContent = `
      body.aiui-content-loaded main.flex-1 > :not([data-aiui-plugin]) {
        opacity: 0 !important;
        position: absolute !important;
        pointer-events: none !important;
      }
    `;
    document.body.classList.add('aiui-content-loaded');
  } else {
    styleEl.textContent = '';
    document.body.classList.remove('aiui-content-loaded');
  }
}

function hasPluginArticle() {
  return !!document.querySelector('[data-aiui-plugin="content-loader"]');
}

function mainHasVisibleContent() {
  const main = document.querySelector('main.flex-1');
  if (!main) return false;
  const text = main.textContent?.trim() ?? '';
  return text.length > 30;
}

function teardownPluginContent() {
  document.querySelectorAll('[data-aiui-plugin="content-loader"]').forEach(el => el.remove());
  setContentMode(false);
}

function isDefaultView(root) {
  const h2s = root.querySelectorAll('h2');
  for (const h2 of h2s) {
    if (h2.textContent.trim() === 'Theme Configuration') return true;
  }
  return false;
}

async function injectPluginContent(targetPath) {
  let path = (targetPath || '/').replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index.html') {
    return false;
  }

  const mdPath = pathToMd(path);
  const root = document.getElementById('root');
  if (!root) return false;

  let main = root.querySelector('main.flex-1');
  if (!main) {
    await new Promise(r => setTimeout(r, 200));
    main = document.getElementById('root')?.querySelector('main.flex-1') ?? null;
  }
  const container = main || root;

  const response = await fetch(mdPath);
  if (!response.ok) {
    console.debug('[AIUI:content-loader] No markdown at', mdPath);
    return false;
  }

  const markdown = await response.text();
  loadedPath = mdPath;
  currentPath = window.location.pathname;

  document.querySelectorAll('[data-aiui-plugin="content-loader"]').forEach(el => el.remove());

  const article = document.createElement('article');
  article.className = PROSE_ARTICLE_CLASS;
  article.dataset.aiuiPlugin = 'content-loader';
  article.innerHTML = markdownToHtml(markdown);
  container.appendChild(article);

  if (main) setContentMode(true);

  const h1 = article.querySelector('h1');
  if (h1) {
    document.title = h1.textContent.trim() + ' | PraisonAIUI Docs';
  }

  updateTocSidebar(article);
  window.dispatchEvent(new CustomEvent('aiui:content-loaded', { detail: { root: article } }));

  const af = document.getElementById('aiui-anti-flicker');
  if (af) af.remove();

  console.debug('[AIUI:content-loader] Injected fallback content from', mdPath);
  return true;
}

async function loadContent(root) {
  if (spaNavigating) return;

  const mdPath = getMarkdownPath();
  if (mdPath === loadedPath && hasPluginArticle()) return;
  if (!isDefaultView(root)) return;

  const main = root.querySelector('main.flex-1');
  if (!main) return;

  try {
    await injectPluginContent(window.location.pathname.replace(/\/$/, '') || '/');
  } catch (err) {
    console.warn('[AIUI:content-loader] Failed to load:', mdPath, err);
  }
}

function repairIfEmpty() {
  if (mainHasVisibleContent() || hasPluginArticle()) return;
  if (document.body.classList.contains('aiui-content-loaded')) {
    setContentMode(false);
  }
  loadedPath = '';
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index.html') return;
  injectPluginContent(path);
}

async function navigateToContent(targetPath) {
  const gen = ++navGen;
  spaNavigating = true;

  try {
    currentPath = window.location.pathname;
    teardownPluginContent();
    loadedPath = '';

    let path = (targetPath || '/').replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/index.html') {
      return;
    }

    // React App.tsx syncs selectedItem on aiui:navigate and renders markdown.
    window.setTimeout(async () => {
      if (gen !== navGen) return;
      if (mainHasVisibleContent()) return;
      await injectPluginContent(path);
    }, 600);
  } catch (err) {
    console.warn('[AIUI:content-loader] Failed to navigate:', targetPath, err);
    setContentMode(false);
  } finally {
    setTimeout(() => { spaNavigating = false; }, 300);
  }
}

function updateTocSidebar(article) {
  const headings = article.querySelectorAll('h2, h3');
  if (headings.length === 0) return;

  const asides = document.querySelectorAll('aside');
  for (const aside of asides) {
    const nav = aside.querySelector('nav');
    if (!nav) continue;
    const header = aside.querySelector('h4, h3, p');
    if (header && /on this page/i.test(header.textContent)) {
      const existingLinks = nav.querySelectorAll('a');
      existingLinks.forEach(a => a.style.display = 'none');

      headings.forEach(h => {
        const link = document.createElement('a');
        link.href = '#' + h.id;
        link.textContent = h.textContent;
        link.className = existingLinks[0] ? existingLinks[0].className : '';
        link.style.paddingLeft = h.tagName === 'H3' ? '1rem' : '0';
        nav.appendChild(link);
      });
      break;
    }
  }
}

/* ───────── Markdown → HTML Converter ───────── */

function convertMkdocsTabs(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const tabMatch = lines[i].match(/^===\s+"([^"]+)"\s*$/);
    if (!tabMatch) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const title = tabMatch[1];
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;

    const block = [];
    while (i < lines.length) {
      if (/^===\s+"[^"]+"\s*$/.test(lines[i])) break;
      if (lines[i].trim() === '' && i + 1 < lines.length && /^===\s+"[^"]+"\s*$/.test(lines[i + 1])) break;

      if (lines[i].startsWith('    ') || lines[i].trimStart().startsWith('```')) {
        block.push(lines[i].replace(/^    /, ''));
        i++;
        continue;
      }

      if (block.length > 0 && lines[i].trim() === '') {
        block.push('');
        i++;
        continue;
      }

      break;
    }

    out.push(`### \u200Btab:${title}`);
    out.push('');
    out.push(...block);
    out.push('');
  }

  return out.join('\n');
}

function markdownToHtml(md) {
  let html = md
    .replace(/<div[^>]*markdown[^>]*>\s*/gi, '')
    .replace(/<\/div>\s*/gi, '');

  const iconMap = {
    ':material-file-document:': '📄',
    ':material-puzzle:': '🧩',
    ':material-palette:': '🎨',
    ':material-rocket-launch:': '🚀',
  };
  for (const [shortcode, emoji] of Object.entries(iconMap)) {
    html = html.replaceAll(shortcode, emoji);
  }
  html = html
    .replace(/:material-[\w-]+:/g, '•')
    .replace(/:octicons-[\w-]+(?:-\d+)?:/g, '•');

  html = convertMkdocsTabs(html);

  const lines = html.split('\n');
  const result = [];
  let inCodeBlock = false, codeContent = '', codeLang = '';
  let listItems = [];
  let inTable = false, tableRows = [];

  function flushList() {
    if (listItems.length > 0) {
      result.push('<ul class="list-disc pl-6 my-2 text-foreground">' + listItems.join('') + '</ul>');
      listItems = [];
    }
  }

  function flushTable() {
    if (tableRows.length > 0) {
      let tableHtml = '<table class="min-w-full my-4"><thead><tr>';
      const headers = tableRows[0];
      headers.forEach(h => { tableHtml += `<th class="px-4 py-2 text-left font-semibold text-foreground">${inlineMarkdown(h.trim())}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      for (let i = 2; i < tableRows.length; i++) {
        tableHtml += '<tr>';
        tableRows[i].forEach(cell => { tableHtml += `<td class="px-4 py-2 text-foreground">${inlineMarkdown(cell.trim())}</td>`; });
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      result.push(tableHtml);
      tableRows = [];
      inTable = false;
    }
  }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre class="bg-muted text-foreground border border-border rounded-lg p-4 my-4 overflow-x-auto"><code class="language-${codeLang}">${escapeHtml(codeContent.trim())}</code></pre>`);
        inCodeBlock = false; codeContent = '';
      } else {
        flushList(); flushTable(); inCodeBlock = true;
        codeLang = line.trim().replace('```', '') || 'text';
      }
      continue;
    }
    if (inCodeBlock) { codeContent += line + '\n'; continue; }

    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      if (!inTable) inTable = true;
      if (/^\|[\s\-:]+\|/.test(trimmed) && !trimmed.replace(/[\s\-:|]/g, '').length) {
        tableRows.push('---');
        continue;
      }
      const cells = trimmed.split('|').slice(1, -1);
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (trimmed === '') { flushList(); continue; }

    const hm = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      flushList();
      const lvl = hm[1].length;
      const text = hm[2];
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      result.push(`<h${lvl} id="${id}" class="scroll-mt-20 text-foreground">${inlineMarkdown(text)}</h${lvl}>`);
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) { flushList(); result.push('<hr class="my-6">'); continue; }

    if (trimmed.startsWith('>')) {
      flushList();
      const content = trimmed.replace(/^>\s*/, '');
      if (/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(content)) {
        const type = content.match(/^\[!(\w+)\]/i)[1].toLowerCase();
        const text = content.replace(/^\[!\w+\]\s*/, '');
        const colors = {
          note: 'border-blue-500 bg-blue-500/10',
          tip: 'border-green-500 bg-green-500/10',
          important: 'border-purple-500 bg-purple-500/10',
          warning: 'border-yellow-500 bg-yellow-500/10',
          caution: 'border-red-500 bg-red-500/10',
        };
        result.push(`<div class="border-l-4 ${colors[type] || colors.note} p-4 my-4 rounded-r"><p class="font-semibold">${type.toUpperCase()}</p><p>${inlineMarkdown(text)}</p></div>`);
      } else {
        result.push(`<blockquote class="border-l-4 border-gray-500 pl-4 my-4 italic"><p>${inlineMarkdown(content)}</p></blockquote>`);
      }
      continue;
    }

    const lm = trimmed.match(/^[-*+]\s+(.*)/);
    if (lm) { listItems.push(`<li class="text-foreground">${inlineMarkdown(lm[1])}</li>`); continue; }
    const om = trimmed.match(/^\d+\.\s+(.*)/);
    if (om) { listItems.push(`<li class="text-foreground">${inlineMarkdown(om[1])}</li>`); continue; }

    flushList();
    result.push(`<p class="my-2 text-foreground">${inlineMarkdown(trimmed)}</p>`);
  }
  flushList();
  flushTable();
  return result.join('\n');
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary hover:underline">$1</a>');
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, function (m) { return map[m]; });
}

export default {
  name: 'content-loader',
  init() {
    currentPath = window.location.pathname;

    window.addEventListener('aiui:navigate', function (e) {
      const path = e.detail && e.detail.path;
      if (path) {
        navigateToContent(path);
      }
    });

    console.debug('[AIUI:content-loader] Plugin loaded for path:', currentPath);
  },
  onContentChange(root) {
    if (document.body.classList.contains('aiui-content-loaded') && !hasPluginArticle() && !mainHasVisibleContent()) {
      setContentMode(false);
      loadedPath = '';
    }
    loadContent(root);
    repairIfEmpty();
  },
};
