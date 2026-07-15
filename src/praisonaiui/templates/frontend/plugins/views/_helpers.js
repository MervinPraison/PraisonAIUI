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

/** Format a token count into a compact string (mirrors usage.js). */
export function formatTokens(tokens) {
  const n = Number(tokens) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Format a USD cost into a string (mirrors usage.js). */
export function formatCost(cost) {
  const n = Number(cost) || 0;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** Strip a provider prefix from a model id (anthropic/claude-3 → claude-3). */
export function shortModelName(model) {
  const s = model == null ? '' : String(model);
  const idx = s.lastIndexOf('/');
  return idx >= 0 ? s.slice(idx + 1) : s;
}

/**
 * Sum tokens from timeseries buckets belonging to the current local day.
 * Falls back to summing all buckets when no bucket carries a hour_key.
 */
export function sumTodayTokens(timeseries) {
  const arr = Array.isArray(timeseries) ? timeseries : [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const dated = arr.filter((p) => typeof p.hour_key === 'string');
  const scope = dated.length ? dated.filter((p) => p.hour_key.startsWith(todayKey)) : arr;
  return scope.reduce((sum, p) => sum + (Number(p.tokens) || 0), 0);
}

/**
 * Percent of daily budget consumed, capped at 100.
 * Returns null when the budget is unset or non-positive (E3/E4).
 */
export function computeBudgetPct(today, budget) {
  const b = Number(budget);
  if (!b || b <= 0) return null;
  const pct = (Number(today) || 0) / b * 100;
  if (!isFinite(pct) || pct < 0) return 0;
  return Math.min(pct, 100);
}

/** Banner level from a budget percentage and thresholds. */
export function budgetLevelFor(pct, warnPct = 80, criticalPct = 95) {
  if (pct == null || isNaN(pct)) return 'none';
  if (pct >= criticalPct) return 'critical';
  if (pct >= warnPct) return 'warn';
  return 'none';
}

/** Gauge fill colour by budget percentage. */
export function budgetGaugeColor(pct) {
  if (pct == null) return 'var(--db-accent,#6366f1)';
  if (pct >= 95) return '#ef4444';
  if (pct >= 80) return '#f97316';
  if (pct >= 60) return '#eab308';
  return '#22c55e';
}

const DONUT_PALETTE = ['#3b82f6', '#8b5cf6', '#22c55e', '#64748b'];

/**
 * Pure SVG donut (no chart library).
 *
 * @param {Array<{label: string, value: number, color?: string}>} slices
 * @param {number} [size=40]
 * @returns {string} SVG markup
 */
export function MiniDonutSVG(slices, size = 40) {
  const data = (Array.isArray(slices) ? slices : [])
    .filter((s) => s && (Number(s.value) || 0) > 0);
  const total = data.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
  if (!data.length || total <= 0) {
    const r = size / 2 - 3;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="No model data"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--db-border,#3f3f46)" stroke-width="4" stroke-dasharray="3 3" /></svg>`;
  }
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const inner = r * 0.55;
  let angle = -Math.PI / 2;
  const parts = [];
  const labels = [];
  data.forEach((s, i) => {
    const frac = (Number(s.value) || 0) / total;
    const end = angle + frac * Math.PI * 2;
    const color = s.color || DONUT_PALETTE[i % DONUT_PALETTE.length];
    const large = end - angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const ix2 = cx + inner * Math.cos(end);
    const iy2 = cy + inner * Math.sin(end);
    const ix1 = cx + inner * Math.cos(angle);
    const iy1 = cy + inner * Math.sin(angle);
    parts.push(`<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${inner},${inner} 0 ${large} 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z" fill="${color}" />`);
    labels.push(`${esc(s.label)} ${Math.round(frac * 100)}%`);
    angle = end;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(labels.join(', '))}">${parts.join('')}</svg>`;
}

/**
 * Reduce per-model usage rows to donut slices: top 3 by cost + aggregated Other.
 *
 * @param {Array<{model?: string, cost_usd?: number, total_tokens?: number}>} models
 * @returns {Array<{label: string, value: number, color: string}>}
 */
export function modelDonutSlices(models) {
  const rows = (Array.isArray(models) ? models : [])
    .map((m) => ({ label: shortModelName(m.model), value: Number(m.cost_usd) || Number(m.total_tokens) || 0 }))
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 3).map((m, i) => ({ ...m, color: DONUT_PALETTE[i] }));
  const rest = rows.slice(3).reduce((sum, m) => sum + m.value, 0);
  if (rest > 0) top.push({ label: 'Other', value: rest, color: DONUT_PALETTE[3] });
  return top;
}

/**
 * Build the Overview Cost FinOps strip markup.
 *
 * @param {Object} opts
 * @param {number} opts.todayTokens
 * @param {number} [opts.todayCost]
 * @param {number|null} [opts.budget]
 * @param {number} [opts.warnPct]
 * @param {number} [opts.criticalPct]
 * @param {Array} [opts.models]
 * @param {number} [opts.delta]  - signed pct vs yesterday
 * @returns {string} HTML string
 */
export function costStripHTML({ todayTokens, todayCost, budget = null, warnPct = 80, criticalPct = 95, models = [], delta } = {}) {
  const pct = computeBudgetPct(todayTokens, budget);
  const level = budgetLevelFor(pct, warnPct, criticalPct);
  const gaugeColor = budgetGaugeColor(pct);
  const slices = modelDonutSlices(models);
  const topModel = slices.length ? slices[0].label : '';
  const budgetText = pct == null
    ? `${formatTokens(todayTokens)} tokens`
    : `${formatTokens(todayTokens)} / ${formatTokens(budget)} tokens (${Math.round(pct)}%)`;
  const gauge = pct == null ? '' : `<div class="db-finops-gauge" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" style="height:8px;border-radius:6px;background:var(--db-border,#3f3f46);overflow:hidden;margin-top:6px">
      <div class="db-finops-gauge-fill" style="width:${Math.round(pct)}%;height:100%;background:${gaugeColor};transition:width 400ms ease"></div>
    </div>`;
  const pill = level === 'none' ? '' : `<span class="db-finops-pill" style="font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;background:${level === 'critical' ? 'rgba(239,68,68,.15)' : 'rgba(234,179,8,.15)'};color:${level === 'critical' ? '#ef4444' : '#eab308'}">${Math.round(pct)}%</span>`;
  const costText = todayCost != null ? `Est. ${formatCost(todayCost)} today` : '';
  let deltaHtml = '';
  if (typeof delta === 'number' && !isNaN(delta) && delta !== 0) {
    const up = delta > 0;
    deltaHtml = `<span style="font-size:11px;color:${up ? '#ef4444' : '#22c55e'};margin-left:8px">${up ? '↗' : '↘'} ${Math.abs(delta).toFixed(0)}% vs yesterday</span>`;
  }
  return `<div id="ov-finops-strip" class="db-card db-finops-strip" role="region" aria-label="Cost and usage summary" tabindex="0" data-nav="usage"
      style="cursor:pointer;display:flex;align-items:center;gap:20px;padding:14px 18px;margin-top:16px;margin-bottom:8px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px;min-width:130px">
        <span aria-hidden="true">💰</span>
        <span style="font-size:13px;font-weight:600;color:var(--db-text)">Cost FinOps</span>${pill}
      </div>
      <div style="flex:1;min-width:200px">
        <div style="font-size:20px;font-weight:700;color:var(--db-text)">${esc(budgetText)}${deltaHtml}</div>
        <div style="font-size:12px;color:var(--db-text-dim,#a1a1aa)">${esc(costText)}</div>
        ${gauge}
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        ${MiniDonutSVG(slices, 40)}
        <span style="font-size:12px;color:var(--db-text-dim,#a1a1aa)">${esc(topModel)}</span>
      </div>
      <span style="font-size:12px;color:var(--db-accent,#6366f1)">View usage →</span>
    </div>`;
}

/**
 * Build a FinOps budget banner (Overview or Chat).
 *
 * @param {string} level - 'none' | 'warn' | 'critical'
 * @param {number} pct
 * @returns {string} HTML string ('' when level is none)
 */
export function budgetBannerHTML(level, pct) {
  if (level === 'none') return '';
  const critical = level === 'critical';
  const color = critical ? '#ef4444' : '#eab308';
  const bg = critical ? 'rgba(239,68,68,.1)' : 'rgba(234,179,8,.1)';
  const copy = critical
    ? `Daily token budget at ${Math.round(pct)}% — review usage`
    : `Daily token budget at ${Math.round(pct)}% — consider lighter models`;
  return `<div class="db-finops-banner" role="${critical ? 'alert' : 'status'}"
      style="display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid ${color};border-radius:10px;background:${bg};color:${color};font-size:12px;font-weight:500;margin-bottom:8px">
      <span aria-hidden="true">💰</span>
      <span style="flex:1">${esc(copy)}</span>
      <button type="button" class="db-finops-banner-usage" style="background:none;border:none;color:inherit;cursor:pointer;font-size:12px;text-decoration:underline">Open usage</button>
      <button type="button" class="db-finops-banner-dismiss" title="Dismiss" aria-label="Dismiss" style="background:none;border:none;color:inherit;cursor:pointer;font-size:13px;padding:0 4px">✕</button>
    </div>`;
}

/** Modal shell for view-local dialogs. */
export function modalShell(id, innerHtml) {
  return `<div id="${id}" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center;padding:20px">
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:20px">${innerHtml}</div>
  </div>`;
}

/**
 * Line-level diff between two text blocks using an LCS table.
 * Normalises CRLF/CR to LF before comparing. Bounded for large inputs.
 *
 * @param {string} before
 * @param {string} after
 * @param {number} [maxLines=2000] - Truncate each side to this many lines.
 * @returns {{type:('add'|'del'|'ctx'), text:string}[]}
 */
export function diffLines(before, after, maxLines = 2000) {
  const norm = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n');
  const a = norm(before).split('\n').slice(0, maxLines);
  const b = norm(after).split('\n').slice(0, maxLines);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

/**
 * Minimal, XSS-safe markdown preview. All content is escaped first; only a
 * small, fixed set of inline/block constructs are re-enabled. No raw HTML,
 * scripts, or attributes from source ever reach the DOM.
 *
 * @param {string} md
 * @returns {string} sanitised HTML string
 */
export function renderMarkdownPreview(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const html = [];
  let inList = false;
  const closeList = () => { if (inList) { html.push('</ul>'); inList = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    } else if (li) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inline(li[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
}

/**
 * True when a pending approval represents a skill write (rules R1-R5).
 *
 * @param {Object} a - approval record
 * @returns {boolean}
 */
export function isSkillApproval(a) {
  if (!a || typeof a !== 'object') return false;
  const NAMES = ['write_skill', 'skill_write', 'save_skill', 'create_skill'];
  const tool = String(a.tool_name || '').toLowerCase();
  const action = String(a.action || '').toLowerCase();
  if (NAMES.includes(tool) || NAMES.includes(action)) return true;
  if (String(a.type || '').toLowerCase() === 'skill_write') return true;
  if (a.metadata && String(a.metadata.kind || '').toLowerCase() === 'skill') return true;
  const path = String((a.arguments && a.arguments.path) || '');
  if (path.endsWith('SKILL.md') || path.includes('.praisonai/skills/')) return true;
  return false;
}
