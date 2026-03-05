/**
 * AIUI Dynamic Table of Contents Plugin
 *
 * Replaces the hardcoded "Overview" / "Usage" links in the
 * "On this page" sidebar with headings from the actual rendered content.
 *
 * IMPORTANT: Hides React-managed ToC content via CSS and appends
 * new content as siblings to avoid React reconciler crashes.
 */

function updateToc(root) {
  const article = root.querySelector('article.prose');
  if (!article) return;

  // Find the ToC sidebar
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
  if (tocNav.dataset.tocDynamic) return;

  // Extract headings
  const headings = article.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) return;

  // HIDE the existing React-managed ToC content (don't remove it)
  Array.from(tocNav.children).forEach(function (child) {
    child.style.display = 'none';
  });

  // Build and APPEND new ToC as a sibling container
  const container = document.createElement('div');
  container.className = 'space-y-2';
  container.dataset.aiuiPlugin = 'toc';

  headings.forEach(function (heading, i) {
    if (!heading.id) {
      heading.id = heading.textContent.trim().toLowerCase()
        .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    }

    const link = document.createElement('a');
    link.href = '#' + heading.id;
    link.className = 'flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors';

    if (heading.tagName === 'H3') {
      link.classList.add('pl-3');
      link.style.fontSize = '0.8rem';
    }
    if (i === 0) {
      link.className = 'flex items-center gap-2 text-primary font-medium';
    }

    const dot = document.createElement('span');
    dot.className = 'w-1 h-1 rounded-full ' + (i === 0 ? 'bg-primary' : 'bg-muted-foreground/30');
    link.appendChild(dot);
    link.appendChild(document.createTextNode(heading.textContent.trim()));
    container.appendChild(link);
  });

  tocNav.appendChild(container);
  tocNav.dataset.tocDynamic = 'true';
}

export default {
  name: 'toc',
  init() { console.debug('[AIUI:toc] Dynamic table of contents plugin loaded.'); },
  onContentChange(root) {
    // Clean up previous plugin-generated ToC on navigation
    const old = root.querySelector('[data-aiui-plugin="toc"]');
    if (old) old.remove();
    // Reset flag and hidden elements
    const asides = root.querySelectorAll('aside');
    for (const aside of asides) {
      const nav = aside.querySelector('nav');
      if (nav) {
        delete nav.dataset.tocDynamic;
        // Restore hidden React children
        Array.from(nav.children).forEach(function (child) {
          if (!child.dataset.aiuiPlugin) child.style.display = '';
        });
      }
    }
    setTimeout(function () { updateToc(root); }, 250);
  },
};
