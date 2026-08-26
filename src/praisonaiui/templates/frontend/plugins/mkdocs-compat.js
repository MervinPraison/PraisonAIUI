/**
 * AIUI MkDocs Compatibility Plugin
 *
 * Strips or transforms MkDocs Material-specific syntax that renders
 * as raw text in standard markdown renderers.
 */

const ICON_MAP = {
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

const TAB_HEADING_PREFIX = '\u200Btab:';

function replaceIcons(text) {
  let result = text;
  for (const [shortcode, emoji] of Object.entries(ICON_MAP)) {
    result = result.replaceAll(shortcode, emoji);
  }
  return result
    .replace(/:material-[\w-]+:/g, '•')
    .replace(/:octicons-[\w-]+(?:-\d+)?:/g, '•');
}

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

    out.push(`### ${TAB_HEADING_PREFIX}${title}`);
    out.push('');
    out.push(...block);
    out.push('');
  }

  return out.join('\n');
}

function isTabHeading(text) {
  return text.startsWith(TAB_HEADING_PREFIX) || text.startsWith('tab:');
}

function tabTitle(text) {
  return text.replace(/^\u200Btab:/, '').replace(/^tab:/, '');
}

function enhanceFeatureGrid(article) {
  for (const ul of article.querySelectorAll('ul')) {
    if (ul.classList.contains('aiui-feature-grid')) continue;

    const firstLi = ul.querySelector('li');
    const looksLikeCards = Boolean(
      firstLi?.textContent?.includes('YAML-Driven')
      || firstLi?.textContent?.includes('Component Slots')
      || firstLi?.querySelector('strong'),
    );
    if (!looksLikeCards) continue;

    ul.classList.add(
      'aiui-feature-grid',
      'grid',
      'grid-cols-1',
      'md:grid-cols-2',
      'gap-4',
      'my-6',
      'list-none',
      'pl-0',
    );

    for (const li of ul.querySelectorAll('li')) {
      li.classList.add('border', 'border-border', 'rounded-lg', 'p-4', 'bg-card');
    }
  }
}

function enhanceTabs(article) {
  if (article.querySelector('[data-aiui-tabs]')) return;

  const tabHeadings = Array.from(article.querySelectorAll('h3')).filter((h3) =>
    isTabHeading(h3.textContent?.trim() ?? ''),
  );
  if (tabHeadings.length < 2) return;

  const sections = tabHeadings.map((heading) => {
    const title = tabTitle(heading.textContent?.trim() ?? '');
    const nodes = [];
    let sibling = heading.nextSibling;

    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        const el = sibling;
        if (el.tagName === 'H3' && isTabHeading(el.textContent?.trim() ?? '')) break;
        if (['H1', 'H2'].includes(el.tagName)) break;
      }
      const next = sibling.nextSibling;
      nodes.push(sibling);
      sibling = next;
    }

    return { heading, title, nodes };
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'aiui-tabs my-6 border border-border rounded-lg overflow-hidden';
  wrapper.dataset.aiuiTabs = 'true';

  const buttons = document.createElement('div');
  buttons.className = 'aiui-tab-buttons flex flex-wrap gap-0 border-b border-border bg-muted/30';
  wrapper.appendChild(buttons);

  const panels = document.createElement('div');
  panels.className = 'aiui-tab-panels';
  wrapper.appendChild(panels);

  sections.forEach((section, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = [
      'aiui-tab-button px-4 py-2 text-sm font-medium transition-colors',
      index === 0
        ? 'bg-background text-foreground border-b-2 border-primary'
        : 'text-muted-foreground hover:text-foreground',
    ].join(' ');
    btn.textContent = section.title;
    btn.dataset.tabIndex = String(index);
    buttons.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = index === 0 ? 'aiui-tab-panel p-4 block' : 'aiui-tab-panel p-4 hidden';
    panel.dataset.tabPanel = String(index);
    for (const node of section.nodes) {
      panel.appendChild(node);
    }
    panels.appendChild(panel);
  });

  article.insertBefore(wrapper, sections[0].heading);
  for (const section of sections) {
    section.heading.remove();
  }

  buttons.addEventListener('click', (event) => {
    const target = event.target.closest('.aiui-tab-button');
    if (!target) return;
    const index = target.dataset.tabIndex ?? '0';

    for (const btn of buttons.querySelectorAll('.aiui-tab-button')) {
      const active = btn.dataset.tabIndex === index;
      btn.classList.toggle('bg-background', active);
      btn.classList.toggle('text-foreground', active);
      btn.classList.toggle('border-b-2', active);
      btn.classList.toggle('border-primary', active);
      btn.classList.toggle('text-muted-foreground', !active);
    }

    for (const panel of panels.querySelectorAll('.aiui-tab-panel')) {
      panel.classList.toggle('hidden', panel.dataset.tabPanel !== index);
      panel.classList.toggle('block', panel.dataset.tabPanel === index);
    }
  });
}

/**
 * Clean MkDocs-specific patterns from rendered HTML.
 */
function cleanMkDocsContent(root) {
  const articles = new Set();
  if (root.matches?.('article.prose, main .prose, .prose, #main-content')) {
    articles.add(root);
  }
  root.querySelectorAll('article.prose, main .prose, .prose, #main-content').forEach((el) => articles.add(el));
  if (articles.size === 0) return;

  for (const article of articles) {
    delete article.dataset.mkdocsClean;

    let html = article.innerHTML;
    let changed = false;

    for (const [shortcode, emoji] of Object.entries(ICON_MAP)) {
      if (html.includes(shortcode)) {
        html = html.replaceAll(shortcode, emoji);
        changed = true;
      }
    }

    const materialPattern = /:material-[\w-]+:/g;
    if (materialPattern.test(html)) {
      html = html.replace(materialPattern, '•');
      changed = true;
    }

    const octiconsPattern = /:octicons-[\w-]+(?:-\d+)?:/g;
    if (octiconsPattern.test(html)) {
      html = html.replace(octiconsPattern, '•');
      changed = true;
    }

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

    if (changed) {
      article.innerHTML = html;
    }

    for (const p of article.querySelectorAll('p')) {
      const text = p.textContent.trim();
      if (/^<\/?div[\s>]/.test(text) || text === '</div>') {
        p.remove();
      }
    }

    enhanceFeatureGrid(article);
    enhanceTabs(article);
    article.dataset.mkdocsClean = 'true';
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

export { replaceIcons, convertMkdocsTabs, ICON_MAP };
