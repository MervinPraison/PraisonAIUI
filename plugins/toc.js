/**
 * AIUI Dynamic Table of Contents Plugin
 *
 * Replaces the hardcoded "Overview" / "Usage" links in the
 * "On this page" sidebar with headings extracted from the
 * actual rendered markdown content.
 */

/**
 * Build a dynamic ToC from article headings and replace the static one.
 */
function updateToc(root) {
  // Find the rendered article (markdown content area)
  const article = root.querySelector('article.prose');
  if (!article) return;

  // Find the ToC sidebar nav — it's inside an <aside> with "On this page"
  const asides = root.querySelectorAll('aside');
  let tocNav = null;
  for (const aside of asides) {
    const heading = aside.querySelector('h4');
    if (heading && heading.textContent.trim().toLowerCase().includes('on this page')) {
      tocNav = aside.querySelector('nav');
      break;
    }
  }
  if (!tocNav) return;

  // Skip if already dynamically populated
  if (tocNav.dataset.tocDynamic) return;

  // Extract headings (h2, h3) from the article
  const headings = article.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) return;

  // Build new ToC links
  const container = document.createElement('div');
  container.className = 'space-y-2';

  headings.forEach((heading, i) => {
    // Ensure heading has an id for anchor linking
    if (!heading.id) {
      heading.id = heading.textContent
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
    }

    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.className =
      'flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors';

    // Indent h3 entries
    const isH1 = heading.tagName === 'H1';
    const isH3 = heading.tagName === 'H3';
    if (isH3) {
      link.classList.add('pl-3');
      link.style.fontSize = '0.8rem';
    }

    // First item gets primary styling
    if (i === 0) {
      link.className = 'flex items-center gap-2 text-primary font-medium';
    }

    // Add dot indicator
    const dot = document.createElement('span');
    dot.className = `w-1 h-1 rounded-full ${i === 0 ? 'bg-primary' : 'bg-muted-foreground/30'}`;
    link.appendChild(dot);

    // Add heading text
    link.appendChild(document.createTextNode(heading.textContent.trim()));

    container.appendChild(link);
  });

  // Replace the static ToC content
  const existingDiv = tocNav.querySelector('div');
  if (existingDiv) {
    existingDiv.replaceWith(container);
  } else {
    tocNav.innerHTML = '';
    tocNav.appendChild(container);
  }

  tocNav.dataset.tocDynamic = 'true';
}

export default {
  name: 'toc',

  init() {
    console.debug('[AIUI:toc] Dynamic table of contents plugin loaded.');
  },

  onContentChange(root) {
    // Reset flag so ToC re-generates on SPA navigation
    const asides = root.querySelectorAll('aside');
    for (const aside of asides) {
      const nav = aside.querySelector('nav');
      if (nav) delete nav.dataset.tocDynamic;
    }
    // Small delay to let markdown render complete
    setTimeout(() => updateToc(root), 200);
  },
};
