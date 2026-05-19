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

/** Page toolbar row (title left, actions right). */
export function pageToolbar(title, actionsHtml = '') {
  return `
    <div class="db-page-toolbar" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <h2 style="margin:0;font-size:1.1rem;font-weight:600">${title}</h2>
      ${actionsHtml ? `<div class="db-page-toolbar-actions" style="display:flex;gap:8px;flex-wrap:wrap">${actionsHtml}</div>` : ''}
    </div>`;
}

/** Filter chip buttons. */
export function filterChips(values, active, dataAttr = 'data-filter') {
  return values.map((v) => {
    const label = v.charAt(0).toUpperCase() + v.slice(1);
    const on = v === active;
    return `<button type="button" class="db-filter-chip" ${dataAttr}="${v}" style="padding:5px 14px;border:1px solid var(--db-border);background:${on ? 'var(--db-accent)' : 'transparent'};color:${on ? '#fff' : 'var(--db-text)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">${label}</button>`;
  }).join('');
}

/** Search input using dashboard theme tokens. */
export function searchInput(placeholder = 'Search…', id = 'db-search-input') {
  return `<input id="${id}" type="search" placeholder="${placeholder}" style="width:100%;max-width:320px;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;color:var(--db-text);font-size:13px;box-sizing:border-box" />`;
}

/** Modal shell for view-local dialogs. */
export function modalShell(id, innerHtml) {
  return `<div id="${id}" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center;padding:20px">
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:20px">${innerHtml}</div>
  </div>`;
}
