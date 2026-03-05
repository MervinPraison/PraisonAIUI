/**
 * AIUI MkDocs Compatibility Plugin
 * 
 * Strips or transforms MkDocs Material-specific syntax that renders
 * as raw text in standard markdown renderers:
 * 
 * - :material-*: icon shortcodes → emoji or removes them
 * - <div class="grid cards" markdown> → removes wrapper
 * - === "Tab Title" → transforms to heading
 * - !!! note/warning → transforms to blockquote
 * - </div> visible tags → removes them
 */

/**
 * Clean MkDocs-specific patterns from rendered HTML.
 */
function cleanMkDocsContent(root) {
  // Find all text nodes and elements in the content area
  const articles = root.querySelectorAll('article.prose, main .prose');
  if (articles.length === 0) return;

  for (const article of articles) {
    if (article.dataset.mkdocsClean) continue;

    let html = article.innerHTML;
    let changed = false;

    // 1. Remove :material-*: icon shortcodes (replace with relevant emoji or empty)
    const iconMap = {
      ':material-file-document:': '📄',
      ':material-puzzle:': '🧩',
      ':material-palette:': '🎨',
      ':material-rocket-launch:': '🚀',
      ':material-code-tags:': '💻',
      ':material-cog:': '⚙️',
      ':material-lightning-bolt:': '⚡',
      ':material-shield:': '🛡️',
      ':material-database:': '🗄️',
      ':material-web:': '🌐',
      ':material-book:': '📖',
      ':material-star:': '⭐',
      ':material-check:': '✅',
      ':material-close:': '❌',
      ':material-alert:': '⚠️',
      ':material-information:': 'ℹ️',
    };

    // Replace known icons
    for (const [shortcode, emoji] of Object.entries(iconMap)) {
      if (html.includes(shortcode)) {
        html = html.replaceAll(shortcode, emoji);
        changed = true;
      }
    }

    // Replace any remaining :material-*: with generic icon
    const materialPattern = /:material-[\w-]+:/g;
    if (materialPattern.test(html)) {
      html = html.replace(materialPattern, '•');
      changed = true;
    }

    // Replace :octicons-*: shortcodes
    const octiconsPattern = /:octicons-[\w-]+(?:-\d+)?:/g;
    if (octiconsPattern.test(html)) {
      html = html.replace(octiconsPattern, '•');
      changed = true;
    }

    // 2. Remove <div class="grid cards" markdown> and </div> tags
    //    These render as visible text in react-markdown
    const gridCardPattern = /&lt;div\s+class="[^"]*"\s*(?:markdown)?&gt;/gi;
    if (gridCardPattern.test(html)) {
      html = html.replace(gridCardPattern, '');
      changed = true;
    }

    const closeDivPattern = /&lt;\/div&gt;/gi;
    if (closeDivPattern.test(html)) {
      html = html.replace(closeDivPattern, '');
      changed = true;
    }

    // Also handle cases where react-markdown renders them as actual elements
    const rawDivNodes = article.querySelectorAll('p');
    for (const p of rawDivNodes) {
      const text = p.textContent.trim();
      if (/^<\/?div[\s>]/.test(text) || text === '</div>') {
        p.style.display = 'none';
        changed = true;
      }
    }

    // 3. Transform === "Tab Title" content tabs to headings
    //    These appear as literal text like: === "Python"
    const tabPattern = /===\s+"([^"]+)"/g;
    if (tabPattern.test(html)) {
      html = html.replace(tabPattern, '<strong>$1</strong>');
      changed = true;
    }

    if (changed) {
      article.innerHTML = html;
      article.dataset.mkdocsClean = 'true';
    }
  }
}

export default {
  name: 'mkdocs-compat',

  init() {
    console.debug('[AIUI:mkdocs-compat] MkDocs compatibility plugin loaded.');
  },

  onContentChange(root) {
    cleanMkDocsContent(root);
  },
};
