/**
 * Shared help/info banner utility for dashboard views.
 *
 * Usage:
 *   import { helpBanner } from '/plugins/views/_helpers.js';
 *   container.innerHTML = helpBanner({ ... }) + restOfContent;
 */

/**
 * Render a collapsible info banner with user-friendly help.
 *
 * @param {Object} opts
 * @param {string} opts.title       - Feature title
 * @param {string} opts.what        - Plain-language description
 * @param {string} opts.howToUse    - How to use this feature (steps / tips)
 * @param {string} [opts.tip]       - Optional pro-tip
 * @param {boolean} [opts.collapsed] - Start collapsed (default: false)
 * @returns {string} HTML string
 */
export function helpBanner({ title, what, howToUse, tip, collapsed = false }) {
  const id = 'help-' + title.toLowerCase().replace(/\s+/g, '-');
  return `
    <div style="margin-bottom:20px;border:1px solid rgba(99,102,241,.2);border-radius:12px;background:rgba(99,102,241,.04);overflow:hidden">
      <div id="${id}-toggle" style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;user-select:none"
           onclick="(function(el){var b=document.getElementById('${id}-body');b.style.display=b.style.display==='none'?'block':'none';el.querySelector('.chevron').textContent=b.style.display==='none'?'▸':'▾'})(this)">
        <span class="chevron" style="font-size:12px;color:var(--db-accent,#6366f1)">${collapsed ? '▸' : '▾'}</span>
        <span style="font-size:13px;font-weight:600;color:var(--db-accent,#6366f1)">ℹ️ About ${title}</span>
      </div>
      <div id="${id}-body" style="padding:0 16px 14px;font-size:13px;line-height:1.8;color:var(--db-text-dim,#a1a1aa);display:${collapsed ? 'none' : 'block'}">
        <div style="margin-bottom:10px">${what}</div>
        <div style="margin-bottom:10px"><strong style="color:var(--db-text,#e4e4e7)">How to use:</strong><br>${howToUse}</div>
        ${tip ? `<div style="padding:10px 14px;background:rgba(34,197,94,.06);border-radius:8px;border-left:3px solid rgba(34,197,94,.3)"><strong style="color:#22c55e">💡 Tip:</strong> ${tip}</div>` : ''}
      </div>
    </div>`;
}
