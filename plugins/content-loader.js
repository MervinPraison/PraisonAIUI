/**
 * AIUI Content Loader Plugin
 *
 * Loads page-specific markdown content based on the current URL.
 * Replaces the default React debug/template view with actual docs content.
 *
 * CRITICAL: Does NOT modify React-managed DOM elements directly.
 * Uses CSS to hide debug content and appends our content as a new child.
 *
 * URL mapping: /docs/getting-started/installation/ → /docs/getting-started/installation.md
 */

let currentPath = '';
let loadedPath = '';
let spaNavigating = false;  // Guard: prevent loadContent from racing with SPA nav

/**
 * Map the current URL to a markdown file path.
 * /docs/getting-started/installation → /docs/getting-started/installation.md
 * /docs/getting-started/installation/ → /docs/getting-started/installation.md
 * / or /index.html → /docs/index.md
 */
function getMarkdownPath() {
  let path = window.location.pathname;
  // Homepage
  if (path === '/' || path === '/index.html' || path === '') {
    return '/docs/index.md';
  }
  // Strip trailing slash
  path = path.replace(/\/$/, '');
  // Strip /index suffix if present
  path = path.replace(/\/index$/, '');
  // The path is already /docs/something, add .md
  return path + '.md';
}

/**
 * Inject CSS that hides the debug content in main.
 * Uses a body class + CSS so we NEVER touch React elements directly.
 */
function setContentMode(active) {
  let styleEl = document.getElementById('aiui-content-loader-css');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aiui-content-loader-css';
    document.head.appendChild(styleEl);
  }

  if (active) {
    // Use opacity + absolute positioning instead of display:none
    // to prevent layout collapse (the "black flash")
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

/**
 * Check if the page is showing the debug/default view
 */
function isDefaultView(root) {
  const h2s = root.querySelectorAll('h2');
  for (const h2 of h2s) {
    if (h2.textContent.trim() === 'Theme Configuration') return true;
  }
  return false;
}

/**
 * Fetch markdown and render into the content area
 */
async function loadContent(root) {
  // Skip if SPA navigation is in progress
  if (spaNavigating) return;

  const mdPath = getMarkdownPath();
  
  // Don't reload the same content
  if (mdPath === loadedPath) return;
  
  // Check if the default/debug view is showing
  if (!isDefaultView(root)) return;
  
  const main = root.querySelector('main.flex-1');
  if (!main) return;

  try {
    const response = await fetch(mdPath);
    if (!response.ok) {
      console.debug('[AIUI:content-loader] No markdown at', mdPath);
      return;
    }
    const markdown = await response.text();
    
    loadedPath = mdPath;
    
    // Remove ALL previously injected content
    document.querySelectorAll('[data-aiui-plugin="content-loader"]').forEach(el => el.remove());
    document.querySelectorAll('[data-aiui-plugin="homepage"]').forEach(el => el.remove());

    // Create and inject our article FIRST
    const article = document.createElement('article');
    article.className = 'prose max-w-none dark:prose-invert p-6';
    article.dataset.aiuiPlugin = 'content-loader';
    article.innerHTML = markdownToHtml(markdown);
    main.appendChild(article);

    // NOW hide React's debug content — our article is already in the DOM
    setContentMode(true);

    // Remove anti-flicker CSS (ensures content is visible)
    const af = document.getElementById('aiui-anti-flicker');
    if (af) af.remove();

    // Update the "On This Page" ToC if toc plugin is active
    updateTocSidebar(article);
    
    console.debug('[AIUI:content-loader] Loaded content from', mdPath);
  } catch (err) {
    console.warn('[AIUI:content-loader] Failed to load:', mdPath, err);
  }
}

/**
 * Update the "On This Page" sidebar with headings from the loaded content
 */
function updateTocSidebar(article) {
  const headings = article.querySelectorAll('h2, h3');
  if (headings.length === 0) return;

  // Find the ToC aside (the one with "On this page" or similar)
  const asides = document.querySelectorAll('aside');
  for (const aside of asides) {
    const nav = aside.querySelector('nav');
    if (!nav) continue;
    // Check if this is the ToC sidebar (usually has a heading like "On this page")
    const header = aside.querySelector('h4, h3, p');
    if (header && /on this page/i.test(header.textContent)) {
      // Clear old ToC links and add new ones
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

function markdownToHtml(md) {
  // Clean up MkDocs-specific syntax
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
  let inTable = false, tableRows = [];

  function flushList() {
    if (listItems.length > 0) {
      result.push('<ul class="list-disc pl-6 my-2">' + listItems.join('') + '</ul>');
      listItems = [];
    }
  }

  function flushTable() {
    if (tableRows.length > 0) {
      let tableHtml = '<table class="min-w-full my-4"><thead><tr>';
      const headers = tableRows[0];
      headers.forEach(h => { tableHtml += `<th class="px-4 py-2 text-left font-semibold">${inlineMarkdown(h.trim())}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      for (let i = 2; i < tableRows.length; i++) {
        tableHtml += '<tr>';
        tableRows[i].forEach(cell => { tableHtml += `<td class="px-4 py-2">${inlineMarkdown(cell.trim())}</td>`; });
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      result.push(tableHtml);
      tableRows = [];
      inTable = false;
    }
  }

  for (const line of lines) {
    // Code blocks
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre class="bg-gray-900 rounded-lg p-4 my-4 overflow-x-auto"><code class="language-${codeLang}">${escapeHtml(codeContent.trim())}</code></pre>`);
        inCodeBlock = false; codeContent = '';
      } else {
        flushList(); flushTable(); inCodeBlock = true;
        codeLang = line.trim().replace('```', '') || 'text';
      }
      continue;
    }
    if (inCodeBlock) { codeContent += line + '\n'; continue; }

    const trimmed = line.trim();
    
    // Table rows
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      if (!inTable) inTable = true;
      // Skip separator rows like |---|---|
      if (/^\|[\s\-:]+\|/.test(trimmed) && !trimmed.replace(/[\s\-:|]/g, '').length) {
        tableRows.push('---'); // placeholder for separator
        continue;
      }
      const cells = trimmed.split('|').slice(1, -1);
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }
    
    if (trimmed === '') { flushList(); continue; }

    // Headings
    const hm = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      flushList();
      const lvl = hm[1].length;
      const text = hm[2];
      const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      result.push(`<h${lvl} id="${id}" class="scroll-mt-20">${inlineMarkdown(text)}</h${lvl}>`);
      continue;
    }
    
    // Horizontal rules
    if (/^[-*_]{3,}$/.test(trimmed)) { flushList(); result.push('<hr class="my-6">'); continue; }
    
    // Blockquotes / Admonitions
    if (trimmed.startsWith('>')) {
      flushList();
      const content = trimmed.replace(/^>\s*/, '');
      // Check for admonition types
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
    
    // List items
    const lm = trimmed.match(/^[-*+]\s+(.*)/);
    if (lm) { listItems.push(`<li>${inlineMarkdown(lm[1])}</li>`); continue; }
    const om = trimmed.match(/^\d+\.\s+(.*)/);
    if (om) { listItems.push(`<li>${inlineMarkdown(om[1])}</li>`); continue; }

    // Regular paragraphs
    flushList();
    result.push(`<p class="my-2">${inlineMarkdown(trimmed)}</p>`);
  }
  flushList();
  flushTable();
  return result.join('\n');
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-800 px-1.5 py-0.5 rounded text-sm">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 hover:text-blue-300 underline">$1</a>');
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, function (m) { return map[m]; });
}

/**
 * Navigate to new content via SPA (called from aiui:navigate event).
 * Unlike loadContent(), this doesn't check isDefaultView() — we know we need to swap.
 */
async function navigateToContent(targetPath) {
  // Set guard to prevent loadContent from racing
  spaNavigating = true;

  try {
    // Map the target path to a markdown file
    let path = (targetPath || '/').replace(/\/+$/, '') || '/';

    // Skip homepage — handled by homepage.js
    if (path === '/' || path === '/index.html') {
      spaNavigating = false;
      return;
    }

    const mdPath = path + '.md';

    // Don't reload the same content
    if (mdPath === loadedPath) {
      spaNavigating = false;
      return;
    }

    // Find the main container
    let root = document.getElementById('root');
    if (!root) { spaNavigating = false; return; }

    let main = root.querySelector('main.flex-1');

    // If main doesn't exist, wait and retry
    if (!main) {
      await new Promise(r => setTimeout(r, 200));
      root = document.getElementById('root');
      if (!root) { spaNavigating = false; return; }
      main = root.querySelector('main.flex-1');
    }

    const container = main || root;

    const response = await fetch(mdPath);
    if (!response.ok) {
      console.debug('[AIUI:content-loader] No markdown at', mdPath);
      spaNavigating = false;
      return;
    }
    const markdown = await response.text();

    loadedPath = mdPath;
    currentPath = window.location.pathname;

    // Remove ALL previously injected plugin content
    document.querySelectorAll('[data-aiui-plugin]').forEach(el => el.remove());

    // Create and inject our article
    const article = document.createElement('article');
    article.className = 'prose max-w-none dark:prose-invert p-6';
    article.dataset.aiuiPlugin = 'content-loader';
    article.innerHTML = markdownToHtml(markdown);
    container.appendChild(article);

    // Hide React's debug content
    if (main) setContentMode(true);

    // Update page title from first heading
    const h1 = article.querySelector('h1');
    if (h1) {
      document.title = h1.textContent.trim() + ' | PraisonAIUI Docs';
    }

    // Update the "On This Page" ToC
    updateTocSidebar(article);

    // Remove anti-flicker CSS (critical: ensures content is visible)
    const af = document.getElementById('aiui-anti-flicker');
    if (af) af.remove();

    console.debug('[AIUI:content-loader] SPA navigated to', mdPath);
  } catch (err) {
    console.warn('[AIUI:content-loader] Failed to navigate:', targetPath, err);
  } finally {
    // Always clear the guard after a short delay
    setTimeout(() => { spaNavigating = false; }, 300);
  }
}

export default {
  name: 'content-loader',
  init() {
    currentPath = window.location.pathname;

    // Listen for SPA navigation events
    window.addEventListener('aiui:navigate', function (e) {
      const path = e.detail && e.detail.path;
      if (path) {
        navigateToContent(path);
      }
    });

    console.debug('[AIUI:content-loader] Plugin loaded for path:', currentPath);
  },
  onContentChange(root) {
    loadContent(root);
  },
};

