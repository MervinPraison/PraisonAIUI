/**
 * AIUI Homepage Plugin
 * 
 * Replaces the hardcoded debug/developer landing page with actual
 * documentation content from docs/index.md.
 * 
 * The React bundle renders a debug view (theme config, preset indices,
 * route JSON) when no nav item is matched. This plugin detects that
 * state and replaces it with fetched markdown content.
 */

let hasRendered = false;

/**
 * Check if we're on the homepage (no /docs/ path).
 */
function isHomepage() {
  const path = window.location.pathname;
  return path === '/' || path === '/index.html' || path === '';
}

/**
 * Detect the debug landing page by checking for its unique markers.
 */
function isDebugHomepage(root) {
  // The debug page has an h2 with "Theme Configuration" text
  const h2s = root.querySelectorAll('h2');
  for (const h2 of h2s) {
    if (h2.textContent.trim() === 'Theme Configuration') {
      return true;
    }
  }
  return false;
}

/**
 * Fetch and render docs/index.md as the homepage.
 */
async function replaceHomepage(root) {
  if (hasRendered) return;
  if (!isHomepage()) return;
  if (!isDebugHomepage(root)) return;

  hasRendered = true;

  try {
    // Try to fetch docs/index.md
    const response = await fetch('/docs/index.md');
    if (!response.ok) return;

    const markdown = await response.text();

    // Find the main content area (the one with the debug view)
    const main = root.querySelector('main.flex-1');
    if (!main) return;

    // Create a container with the prose class for proper styling
    const article = document.createElement('article');
    article.className = 'prose max-w-none dark:prose-invert';

    // Use a simple markdown-to-HTML conversion for the homepage
    // Since the full react-markdown is inside the React bundle,
    // we'll do a lightweight conversion here
    article.innerHTML = simpleMarkdownToHtml(markdown);

    // Replace the debug content
    main.innerHTML = '';
    main.appendChild(article);
  } catch (err) {
    console.warn('[AIUI:homepage] Failed to load homepage content:', err);
  }
}

/**
 * Lightweight markdown to HTML converter for homepage content.
 * Handles common patterns without requiring a full markdown parser.
 */
function simpleMarkdownToHtml(md) {
  let html = md;

  // Remove MkDocs-specific syntax first
  html = html
    .replace(/<div[^>]*markdown[^>]*>/gi, '')
    .replace(/<\/div>/gi, '')
    .replace(/===\s+"([^"]+)"/g, '**$1**')
    .replace(/:material-[\w-]+:/g, '•')
    .replace(/:octicons-[\w-]+(?:-\d+)?:/g, '•');

  // Process line by line
  const lines = html.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeContent = '';
  let codeLang = '';
  let inList = false;
  let listItems = [];

  function flushList() {
    if (listItems.length > 0) {
      result.push('<ul>' + listItems.join('') + '</ul>');
      listItems = [];
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        result.push(
          `<pre><code class="language-${codeLang}">${escapeHtml(codeContent.trim())}</code></pre>`
        );
        inCodeBlock = false;
        codeContent = '';
      } else {
        flushList();
        inCodeBlock = true;
        codeLang = line.trim().replace('```', '') || 'text';
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') {
      flushList();
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = inlineMarkdown(headingMatch[2]);
      const id = headingMatch[2]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
      result.push(`<h${level} id="${id}">${text}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushList();
      result.push('<hr>');
      continue;
    }

    // Unordered list items
    const listMatch = trimmed.match(/^[-*+]\s+(.*)/);
    if (listMatch) {
      inList = true;
      listItems.push(`<li>${inlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    // Ordered list items
    const olMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      inList = true;
      listItems.push(`<li>${inlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    // Paragraph
    flushList();
    result.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return result.join('\n');
}

/**
 * Process inline markdown (bold, italic, code, links).
 */
function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export default {
  name: 'homepage',

  init() {
    console.debug('[AIUI:homepage] Homepage plugin loaded.');
  },

  onContentChange(root) {
    replaceHomepage(root);
  },
};
