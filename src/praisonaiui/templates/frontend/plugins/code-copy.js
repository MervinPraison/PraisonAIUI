/**
 * AIUI Code Copy Plugin
 *
 * Adds a "Copy" button to every code block (<pre><code>).
 * Shows "Copied!" feedback with a smooth animation.
 * Excludes mermaid diagram blocks.
 */

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'aiui-code-copy-styles';
  style.textContent = `
    .aiui-code-wrapper {
      position: relative;
    }

    .aiui-copy-btn {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      font-size: 0.6875rem;
      font-weight: 500;
      color: rgba(148, 163, 184, 0.7);
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.15);
      border-radius: 0.375rem;
      cursor: pointer;
      opacity: 0;
      transition: all 0.2s ease;
      z-index: 10;
      font-family: inherit;
      line-height: 1.2;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .aiui-code-wrapper:hover .aiui-copy-btn {
      opacity: 1;
    }

    .aiui-copy-btn:hover {
      color: #e2e8f0;
      background: rgba(51, 65, 85, 0.9);
      border-color: rgba(148, 163, 184, 0.3);
    }

    .aiui-copy-btn.copied {
      color: #34d399 !important;
      border-color: rgba(52, 211, 153, 0.3);
    }

    .aiui-copy-btn svg {
      width: 12px;
      height: 12px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;
  document.head.appendChild(style);
}

const COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function addCopyButtons(root) {
  const codeBlocks = root.querySelectorAll('pre');

  codeBlocks.forEach(function (pre) {
    // Skip if already processed or is a mermaid block
    if (pre.dataset.copyProcessed) return;
    if (pre.closest('.mermaid-diagram')) return;
    if (pre.querySelector('.mermaid')) return;

    pre.dataset.copyProcessed = 'true';

    // Wrap in a relative container
    const wrapper = document.createElement('div');
    wrapper.className = 'aiui-code-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    // Create copy button
    const btn = document.createElement('button');
    btn.className = 'aiui-copy-btn';
    btn.innerHTML = COPY_ICON + '<span>Copy</span>';
    btn.setAttribute('aria-label', 'Copy code');

    btn.addEventListener('click', function () {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;

      navigator.clipboard.writeText(text).then(function () {
        btn.innerHTML = CHECK_ICON + '<span>Copied!</span>';
        btn.classList.add('copied');
        setTimeout(function () {
          btn.innerHTML = COPY_ICON + '<span>Copy</span>';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(function () {
        // Fallback for non-HTTPS contexts
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          btn.innerHTML = CHECK_ICON + '<span>Copied!</span>';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.innerHTML = COPY_ICON + '<span>Copy</span>';
            btn.classList.remove('copied');
          }, 2000);
        } catch (e) {
          console.warn('[AIUI:code-copy] Copy failed:', e);
        }
        document.body.removeChild(textarea);
      });
    });

    wrapper.appendChild(btn);
  });
}

export default {
  name: 'code-copy',
  init() {
    injectStyles();
    console.debug('[AIUI:code-copy] Code copy plugin loaded.');
  },
  onContentChange(root) {
    addCopyButtons(root);
  },
};
