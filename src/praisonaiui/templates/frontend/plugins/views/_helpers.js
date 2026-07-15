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

/** Escape a string for safe interpolation into template literals. */
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/**
 * Inline SVG sparkline (no external library).
 *
 * @param {number[]} values - Series values (empty renders a flat baseline).
 * @param {Object} [opts]
 * @param {number} [opts.width=96]
 * @param {number} [opts.height=32]
 * @param {string} [opts.color] - Stroke colour (defaults to accent token).
 * @returns {string} SVG markup.
 */
export function sparklineSVG(values, { width = 96, height = 32, color = 'var(--db-accent,#6366f1)' } = {}) {
  const data = Array.isArray(values) ? values.filter((v) => typeof v === 'number' && !isNaN(v)) : [];
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  if (data.length < 2) {
    const y = height / 2;
    return `<svg class="db-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="var(--db-border,#3f3f46)" stroke-width="1.5" /></svg>`;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const yy = pad + h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${yy.toFixed(1)}`;
  });
  const areaPts = `${pad},${(pad + h).toFixed(1)} ${pts.join(' ')} ${(pad + w).toFixed(1)},${(pad + h).toFixed(1)}`;
  return `<svg class="db-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${areaPts}" fill="${color}" opacity="0.12" />
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

/**
 * Metric card with value, subtitle, optional delta and sparkline.
 * Renders a clickable card that navigates via data-nav (handled by caller).
 *
 * @param {Object} opts
 * @param {string} opts.title      - Card label.
 * @param {string|number} opts.value - Primary value (already formatted).
 * @param {string} [opts.subtitle] - Secondary label.
 * @param {number} [opts.delta]    - Signed percentage delta.
 * @param {number[]} [opts.spark]  - Sparkline series.
 * @param {string} [opts.nav]      - Page id to navigate to on click.
 * @param {string} [opts.accent]   - Value colour override.
 * @returns {string} HTML string.
 */
export function metricCard({ title, value, subtitle = '', delta, spark, nav, accent }) {
  let deltaHtml = '';
  if (typeof delta === 'number' && !isNaN(delta) && delta !== 0) {
    const up = delta > 0;
    const col = up ? '#22c55e' : '#ef4444';
    const arrow = up ? '▲' : '▼';
    deltaHtml = `<span style="font-size:11px;color:${col};margin-left:6px">${arrow} ${Math.abs(delta).toFixed(0)}%</span>`;
  }
  const sparkHtml = Array.isArray(spark) ? `<div style="margin-top:8px">${sparklineSVG(spark)}</div>` : '';
  const clickable = nav ? `data-nav="${esc(nav)}" role="button" tabindex="0" style="cursor:pointer"` : '';
  return `<div class="db-card db-metric-card" ${clickable}>
    <div class="db-card-title">${esc(title)}</div>
    <div class="db-card-value"${accent ? ` style="color:${accent}"` : ''}>${esc(value)}${deltaHtml}</div>
    <div class="db-card-footer">${esc(subtitle)}</div>
    ${sparkHtml}
  </div>`;
}

/**
 * Bucket evaluation records into per-day average score series.
 *
 * @param {Array} evaluations - Records with `timestamp` (epoch seconds) and `score`.
 * @param {number} [days=7]    - Number of trailing days to include.
 * @param {string|null} [agentId=null] - Optional agent filter.
 * @returns {Array<{date: string, avg: number, count: number}>} Ascending by date.
 */
export function bucketByDay(evaluations, days = 7, agentId = null) {
  const list = Array.isArray(evaluations) ? evaluations : [];
  const cutoff = Date.now() / 1000 - days * 86400;
  const acc = {};
  for (const ev of list) {
    if (!ev || typeof ev.timestamp !== 'number') continue;
    if (ev.timestamp < cutoff) continue;
    if (agentId && ev.agent_id !== agentId) continue;
    if (ev.score == null || isNaN(ev.score)) continue;
    const date = new Date(ev.timestamp * 1000).toISOString().slice(0, 10);
    if (!acc[date]) acc[date] = { date, sum: 0, count: 0 };
    acc[date].sum += Number(ev.score);
    acc[date].count += 1;
  }
  return Object.values(acc)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((b) => ({ date: b.date, avg: b.sum / b.count, count: b.count }));
}

/**
 * Regression check comparing a current value against a pinned baseline.
 *
 * @param {number} current
 * @param {number} baseline
 * @param {number} [threshold=0.10] - Relative drop that counts as a regression.
 * @returns {{isRegression: boolean, delta: number, label: string}}
 */
export function detectRegression(current, baseline, threshold = 0.1) {
  const c = Number(current);
  const b = Number(baseline);
  if (!isFinite(c) || !isFinite(b) || b === 0) {
    return { isRegression: false, delta: 0, label: '' };
  }
  const delta = (c - b) / b;
  const isRegression = delta <= -threshold;
  const pct = Math.round(delta * 100);
  return { isRegression, delta, label: `${pct >= 0 ? '+' : ''}${pct}%` };
}

/**
 * Coloured trend arrow comparing current vs previous value.
 *
 * @param {number} current
 * @param {number} previous
 * @returns {string} HTML span (empty string when no meaningful change).
 */
export function trendArrow(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!isFinite(c) || !isFinite(p) || p === 0) return '';
  const delta = ((c - p) / p) * 100;
  if (Math.abs(delta) < 0.5) {
    return '<span style="font-size:11px;color:var(--db-text-dim,#a1a1aa)">→ 0%</span>';
  }
  const up = delta > 0;
  const col = up ? '#22c55e' : '#ef4444';
  const arrow = up ? '↑' : '↓';
  return `<span style="font-size:11px;color:${col}">${arrow} ${Math.abs(delta).toFixed(1)}%</span>`;
}

/**
 * Regression pill badge, colour-graded by drop severity.
 *
 * @param {number} delta - Signed relative delta (e.g. -0.12 for -12%).
 * @param {string} [suffix='vs baseline']
 * @returns {string} HTML string (empty when delta is not a regression).
 */
export function regressionBadge(delta, suffix = 'vs baseline') {
  const d = Number(delta);
  if (!isFinite(d) || d > -0.05) return '';
  const pct = Math.round(d * 100);
  const red = d <= -0.1;
  const col = red ? '#ef4444' : '#f59e0b';
  const bg = red ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:.7rem;font-weight:600;color:${col};background:${bg}">${pct}% ${esc(suffix)}</span>`;
}

/** Relative "time ago" label from an ISO string or epoch (ms or s). */
export function timeAgo(input) {
  if (input == null) return '';
  let ms;
  if (typeof input === 'number') {
    ms = input < 1e12 ? input * 1000 : input;
  } else {
    const t = Date.parse(input);
    if (isNaN(t)) return '';
    ms = t;
  }
  const diff = Date.now() - ms;
  if (diff < 0) return 'now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Modal shell for view-local dialogs. */
export function modalShell(id, innerHtml) {
  return `<div id="${id}" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center;padding:20px">
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:20px">${innerHtml}</div>
  </div>`;
}
