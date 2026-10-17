/**
 * AIUI Dynamic Table of Contents Plugin
 *
 * Replaces the hardcoded "Overview" / "Usage" links in the
 * "On this page" sidebar with headings from the actual rendered content.
 *
 * CRITICAL: Does NOT set style.display or any properties on React-managed
 * DOM nodes. All visibility is controlled via a <style> tag so React's
 * reconciler is never confused about the DOM state.
 */

/**
 * Use CSS to hide the React-managed ToC items.
 * We target "the nav inside the aside that has an h4 with 'On this page'"
 * by giving it a data attribute (which is safe since React doesn't track
 * custom data-* attrs), then hiding its original children via CSS.
 */
function setTocHidingCSS(active) {
  let styleEl = document.getElementById('aiui-toc-css');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aiui-toc-css';
    document.head.appendChild(styleEl);
  }

  if (active) {
    styleEl.textContent = `
      nav[data-aiui-toc-managed] > :not([data-aiui-plugin="toc"]) {
        display: none !important;
      }
    `;
  } else {
    styleEl.textContent = '';
  }
}

function findTocNav(root) {
  const asides = root.querySelectorAll('aside');
  for (const aside of asides) {
    const heading = aside.querySelector('h4');
    if (heading && heading.textContent.trim().toLowerCase().includes('on this page')) {
      return aside.querySelector('nav');
    }
  }
  return null;
}

function updateToc(root) {
  const article = root.querySelector('article.prose');
  if (!article) return;

  const tocNav = findTocNav(root);
  if (!tocNav) return;
  if (tocNav.dataset.tocDynamic) return;

  // Extract headings
  const headings = article.querySelectorAll('h1, h2, h3');
  if (headings.length === 0) return;

  // Mark the nav so our CSS can target it (data-* attributes are React-safe)
  tocNav.dataset.aiuiTocManaged = 'true';

  // Activate CSS hiding rule
  setTocHidingCSS(true);

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

let lastUrl = '';

export default {
  name: 'toc',
  init() { console.debug('[AIUI:toc] Dynamic table of contents plugin loaded.'); },
  onContentChange(root) {
    const currentUrl = location.pathname + location.hash;

    // Only tear down on actual navigation
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // Remove OUR injected element (not React's)
      const old = root.querySelector('[data-aiui-plugin="toc"]');
      if (old) old.remove();

      // Clear the managed flag and CSS hiding
      const tocNav = findTocNav(root);
      if (tocNav) {
        delete tocNav.dataset.tocDynamic;
        delete tocNav.dataset.aiuiTocManaged;
      }
      setTocHidingCSS(false);
    }

    // Build ToC if not already built
    setTimeout(function () { updateToc(root); }, 250);
  },
};
