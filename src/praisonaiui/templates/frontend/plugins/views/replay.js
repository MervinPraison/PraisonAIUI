/**
 * PraisonAI Replay view (/replay) — who did what, when, why, and at what cost.
 *
 *   Run picker  : recorded runs from /api/replay/runs (newest first, live badge).
 *   Timeline    : one lane per agent + Manager + You, time left to right, LLM and
 *                 tool blocks, hand-off/delegate arrows, parallel sub-lanes,
 *                 repeats collapsed to ×N, task/step chapters, scrubber (← →).
 *   Map         : the recorded graph (or a derived who-talked-to-whom map).
 *   Narration   : one plain sentence per meaningful event, synced with the canvas.
 *   Drawer      : What happened / Why (recorded evidence only) / Raw JSON.
 *   You lane    : pending approvals can be approved, denied or edited here.
 *
 * Deep link: /replay?run=<id> (also #/replay?run=<id>). Live runs follow
 * /api/replay/runs/<id>/stream (SSE). Plain DOM + SVG, no dependencies, no CDN.
 *
 * Standalone: with window.__REPLAY_DATA__ = {events, graph} set and no aiui
 * dashboard present, the module renders itself into #replay-root (or <body>).
 * Pure logic lives in replay-core.js.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const GUTTER = 184;
const LANE_H = 48;
const SUB_H = 38;
const CH_ROW = 24;
const AXIS_H = 26;
const PAD_R = 96; // room for arrow and cursor labels at the right edge
const MIN_BLOCK = 6;

let S = null; // the one mounted view's state

// ── tiny DOM helpers (textContent only, never innerHTML with data) ─────

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  append(node, kids);
  return node;
}

function s(tag, attrs, ...kids) {
  const node = document.createElementNS(SVG_NS, tag);
  setAttrs(node, attrs);
  append(node, kids);
  return node;
}

function setAttrs(node, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.setAttribute('class', v);
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(node, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
}

function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
}

async function getCore() {
  if (globalThis.PraisonReplayCore) return globalThis.PraisonReplayCore;
  const mod = await import(new URL('./replay-core.js', import.meta.url).href);
  return mod.default || mod;
}

// ── styles ────────────────────────────────────────────────────────────

const STYLE = `
.rp-root{--rp-bg:#FFFFFF;--rp-surface:#F6F7F9;--rp-lane:#F1F3F6;--rp-text:#17181C;--rp-dim:#4F535C;--rp-border:#D5D9E0;--rp-control:#767B85;
  --rp-focus:#1A56DB;--rp-agent:#8B0000;--rp-tool:#0F7287;--rp-human:#8A5A00;--rp-manager:#3C4A5C;--rp-neutral:#5B6270;--rp-on-fill:#FFFFFF;
  --rp-agent-ink:#8B0000;--rp-tool-ink:#0F7287;--rp-human-ink:#8A5A00;--rp-manager-ink:#3C4A5C;--rp-outline:transparent;
  --rp-heat-lo:#C0772F;--rp-heat-hi:#8F2D07;--rp-live:#B3261E;--rp-ok:#1E6B34;--rp-err:#B3261E;--rp-chapter:#E9ECF1;--rp-sel:#DCE7FB;
  color:var(--rp-text);background:var(--rp-bg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  border:1px solid var(--rp-border);border-radius:12px;overflow:hidden;color-scheme:light}
.rp-root[data-theme="dark"]{--rp-bg:#16171B;--rp-surface:#1E2026;--rp-lane:#22252C;--rp-text:#F2F3F5;--rp-dim:#B4B8C2;--rp-border:#3A3E48;--rp-control:#8A909C;
  --rp-focus:#7FB0FF;--rp-agent-ink:#FF9A9A;--rp-tool-ink:#5FD0E3;--rp-human-ink:#F0BE63;--rp-manager-ink:#B3C0D3;--rp-outline:#E6E8EC;
  --rp-heat-lo:#B86A2B;--rp-heat-hi:#FF8A4C;--rp-live:#FF8A80;--rp-ok:#7BD88F;--rp-err:#FF8A80;--rp-chapter:#2A2E37;--rp-sel:#24344F;color-scheme:dark}
.rp-root *{box-sizing:border-box}
.rp-root :focus{outline:none}
.rp-root :focus-visible{outline:3px solid var(--rp-focus);outline-offset:2px}
.rp-sr{position:absolute!important;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.rp-shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:72vh}
.rp-shell.rp-solo{grid-template-columns:minmax(0,1fr)}
.rp-runs{border-right:1px solid var(--rp-border);background:var(--rp-surface);overflow:auto;max-height:88vh}
.rp-runs h2{font-size:13px;letter-spacing:.02em;text-transform:uppercase;margin:0;padding:12px 14px 6px;color:var(--rp-dim)}
.rp-runs ul{list-style:none;margin:0;padding:4px 8px 12px}
.rp-run{display:block;width:100%;text-align:left;background:transparent;color:var(--rp-text);border:1px solid transparent;border-radius:8px;padding:8px 10px;margin:2px 0;cursor:pointer;font:inherit}
.rp-run:hover{border-color:var(--rp-control)}
.rp-run[aria-current="true"]{background:var(--rp-sel);border-color:var(--rp-focus)}
.rp-run-name{font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rp-run-meta{display:block;color:var(--rp-dim);font-size:12px}
.rp-badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;border:1px solid currentColor;border-radius:999px;padding:0 8px;line-height:18px;white-space:nowrap}
.rp-b-live{color:var(--rp-live)}.rp-b-completed{color:var(--rp-ok)}.rp-b-failed{color:var(--rp-err)}.rp-b-running,.rp-b-incomplete{color:var(--rp-dim)}
.rp-dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}
.rp-main{display:flex;flex-direction:column;min-width:0}
.rp-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--rp-border)}
.rp-title{font-size:16px;margin:0;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40ch}
.rp-meta{color:var(--rp-dim);font-size:13px}
.rp-spacer{flex:1}
.rp-btn{font:inherit;font-size:13px;color:var(--rp-text);background:var(--rp-bg);border:1px solid var(--rp-control);border-radius:8px;padding:4px 10px;cursor:pointer;min-height:30px}
.rp-btn:hover{background:var(--rp-surface)}
.rp-btn[aria-pressed="true"]{background:var(--rp-text);color:var(--rp-bg);border-color:var(--rp-text)}
.rp-btn[disabled]{opacity:.55;cursor:not-allowed}
.rp-btn-primary{background:var(--rp-human);border-color:var(--rp-human);color:var(--rp-on-fill)}
.rp-seg{display:inline-flex;gap:0}.rp-seg .rp-btn{border-radius:0}.rp-seg .rp-btn:first-child{border-radius:8px 0 0 8px}.rp-seg .rp-btn:last-child{border-radius:0 8px 8px 0;margin-left:-1px}
.rp-select{font:inherit;font-size:13px;color:var(--rp-text);background:var(--rp-bg);border:1px solid var(--rp-control);border-radius:8px;padding:3px 6px;min-height:30px}
.rp-pending{display:flex;flex-direction:column;gap:8px;padding:10px 14px;border-bottom:1px solid var(--rp-border);background:var(--rp-surface)}
.rp-pending[hidden]{display:none}
.rp-ask{border:2px solid var(--rp-human-ink);border-radius:10px;padding:10px 12px;background:var(--rp-bg)}
.rp-ask h3{margin:0 0 4px;font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rp-ask pre{margin:6px 0;max-height:120px}
.rp-ask-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px}
.rp-ask label{font-size:13px;font-weight:600;display:block;margin-top:6px}
.rp-ask textarea,.rp-ask input[type=text]{width:100%;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--rp-text);background:var(--rp-bg);border:1px solid var(--rp-control);border-radius:8px;padding:6px 8px}
.rp-ask input[type=text]{font:inherit;font-size:13px}
.rp-ask textarea[aria-invalid="true"]{border:2px solid var(--rp-err)}
.rp-err{color:var(--rp-err);font-size:13px;margin:4px 0 0;min-height:1em}
.rp-note{color:var(--rp-dim);font-size:13px;margin:4px 0 0}
.rp-stage{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:360px}
.rp-canvas{overflow:auto;position:relative;max-height:62vh;background:var(--rp-bg)}
.rp-canvas svg{display:block}
.rp-narr{position:relative;border-left:1px solid var(--rp-border);overflow:auto;max-height:62vh;background:var(--rp-surface)}
.rp-narr h2{font-size:13px;text-transform:uppercase;letter-spacing:.02em;color:var(--rp-dim);margin:0;padding:10px 12px 4px}
.rp-narr ol{list-style:none;margin:0;padding:0 6px 10px}
.rp-step{display:grid;grid-template-columns:58px 14px minmax(0,1fr);gap:6px;align-items:start;width:100%;text-align:left;font:inherit;font-size:13px;color:var(--rp-text);background:transparent;border:1px solid transparent;border-radius:8px;padding:5px 6px;cursor:pointer}
.rp-step:hover,.rp-step.rp-hl{border-color:var(--rp-control)}
.rp-step[aria-current="step"]{background:var(--rp-sel);border-color:var(--rp-focus);font-weight:600}
.rp-step.rp-future .rp-step-text{font-style:italic}
.rp-step-t{color:var(--rp-dim);font-variant-numeric:tabular-nums;font-size:12px}
.rp-g{width:12px;height:12px;margin-top:3px;display:inline-block;background:var(--rp-neutral)}
.rp-g-agent{border-radius:50%;background:var(--rp-agent)}.rp-g-manager{background:var(--rp-manager)}
.rp-g-tool{border-radius:4px;background:var(--rp-tool);width:14px}.rp-g-human{background:var(--rp-human);transform:rotate(45deg) scale(.8)}
.rp-root[data-theme="dark"] .rp-g{outline:2px solid var(--rp-outline);outline-offset:-1px}
.rp-scrub{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid var(--rp-border);flex-wrap:wrap}
.rp-scrub input[type=range]{flex:1;min-width:160px;accent-color:var(--rp-focus)}
.rp-scrub output{font-variant-numeric:tabular-nums;color:var(--rp-dim);font-size:13px;min-width:12ch}
.rp-hint{color:var(--rp-dim);font-size:12px}
.rp-drawer{border-top:1px solid var(--rp-border);padding:0 14px 14px;min-height:180px}
.rp-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rp-border);margin:0 -14px 10px;padding:6px 14px 0}
.rp-tab{font:inherit;font-size:13px;color:var(--rp-dim);background:transparent;border:0;border-bottom:3px solid transparent;padding:6px 10px;cursor:pointer}
.rp-tab[aria-selected="true"]{color:var(--rp-text);border-bottom-color:var(--rp-text);font-weight:650}
.rp-drawer h3{font-size:15px;margin:4px 0 8px}
.rp-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 14px;margin:0 0 8px;font-size:13px}
.rp-facts dt{color:var(--rp-dim)}.rp-facts dd{margin:0;overflow-wrap:anywhere}
.rp-root pre{background:var(--rp-surface);border:1px solid var(--rp-border);border-radius:8px;padding:8px 10px;overflow:auto;max-height:280px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px;color:var(--rp-text)}
.rp-evidence{list-style:none;margin:0;padding:0}
.rp-evidence li{margin:0 0 10px}
.rp-evidence .rp-src{color:var(--rp-dim);font-size:12px;font-weight:400}
.rp-passes{border-collapse:collapse;font-size:13px;margin:4px 0 10px}
.rp-passes th,.rp-passes td{border-bottom:1px solid var(--rp-border);padding:3px 10px 3px 0;text-align:left;font-variant-numeric:tabular-nums}
.rp-empty{padding:28px 22px;max-width:720px}
.rp-empty h2{font-size:18px;margin:0 0 6px}
.rp-empty p{color:var(--rp-dim);margin:6px 0}
.rp-legend{display:flex;flex-wrap:wrap;gap:6px 14px;padding:6px 14px;font-size:12px;color:var(--rp-dim);border-top:1px solid var(--rp-border)}
.rp-legend span{display:inline-flex;align-items:center;gap:6px}
/* svg */
.rp-svg text{fill:var(--rp-text);font-size:12px}
.rp-svg .rp-dimtext{fill:var(--rp-dim)}
.rp-svg .rp-lanebg{fill:var(--rp-lane)}
.rp-svg .rp-lanebg-alt{fill:var(--rp-bg)}
.rp-svg .rp-grid{stroke:var(--rp-border);stroke-width:1}
.rp-svg .rp-onfill{fill:var(--rp-on-fill);font-weight:600}
.rp-svg .rp-f-agent{fill:var(--rp-agent)}.rp-svg .rp-f-tool{fill:var(--rp-tool)}.rp-svg .rp-f-human{fill:var(--rp-human)}.rp-svg .rp-f-manager{fill:var(--rp-manager)}.rp-svg .rp-f-neutral{fill:var(--rp-neutral)}
.rp-svg .rp-body{stroke:var(--rp-outline);stroke-width:2}
.rp-svg .rp-glyph{fill:var(--rp-on-fill)}
.rp-svg .rp-ring{fill:none;stroke:none}
.rp-svg .rp-block{cursor:pointer}
.rp-svg .rp-block:focus .rp-ring,.rp-svg .rp-block.rp-sel .rp-ring,.rp-svg .rp-node:focus .rp-ring,.rp-svg .rp-node.rp-sel .rp-ring{stroke:var(--rp-focus);stroke-width:3}
.rp-svg .rp-block.rp-hl .rp-ring,.rp-svg .rp-node.rp-hl .rp-ring{stroke:var(--rp-text);stroke-width:2;stroke-dasharray:4 2}
.rp-svg .rp-future .rp-body{fill:var(--rp-bg);stroke-dasharray:4 3;stroke-width:1.5}
.rp-svg .rp-future.rp-k-llm.rp-o-agent .rp-body{stroke:var(--rp-agent-ink)}.rp-svg .rp-future.rp-k-llm.rp-o-manager .rp-body{stroke:var(--rp-manager-ink)}
.rp-svg .rp-future.rp-k-tool .rp-body{stroke:var(--rp-tool-ink)}.rp-svg .rp-future.rp-k-approval .rp-body{stroke:var(--rp-human-ink)}
.rp-svg .rp-future .rp-glyph{fill:var(--rp-dim)}
.rp-svg .rp-future .rp-onfill{fill:var(--rp-text);font-weight:400}
.rp-svg .rp-open .rp-body{stroke:var(--rp-text);stroke-dasharray:5 3;stroke-width:1.5}
.rp-svg .rp-chapter rect{fill:var(--rp-chapter);stroke:var(--rp-border)}
.rp-svg .rp-chapter.rp-future rect{fill:var(--rp-bg);stroke-dasharray:4 3}
.rp-svg .rp-chapter.rp-hl rect{stroke:var(--rp-text);stroke-width:2}
.rp-svg .rp-arrow path{fill:none;stroke:var(--rp-text);stroke-width:2}
.rp-svg .rp-a-delegate path{stroke-dasharray:7 4}.rp-svg .rp-a-route path{stroke-dasharray:2 4;stroke-linecap:round}
.rp-svg .rp-a-spawn path{stroke-dasharray:9 3 2 3}
.rp-svg .rp-a-ask path,.rp-svg .rp-a-answer path{stroke:var(--rp-human-ink);stroke-width:1.75;stroke-dasharray:4 2}
.rp-svg .rp-arrow.rp-future{opacity:.35}
.rp-svg .rp-arrow.rp-hl path{stroke-width:3.5}
.rp-svg .rp-arrow text{font-size:11px;font-weight:600}
.rp-svg .rp-labelbg{fill:var(--rp-bg);opacity:.92}
.rp-svg .rp-cursor{stroke:var(--rp-focus);stroke-width:2}
.rp-svg .rp-cursor-label{fill:var(--rp-focus);font-weight:700;font-size:11px}
.rp-svg .rp-marker{fill:var(--rp-text)}.rp-svg .rp-marker-human{fill:var(--rp-human-ink)}
.rp-svg .rp-heat{stroke:none}
.rp-svg .rp-node .rp-card{fill:var(--rp-bg);stroke:var(--rp-control);stroke-width:1.5}
.rp-svg .rp-node.rp-unvisited .rp-card{stroke-dasharray:4 3}
.rp-svg .rp-node.rp-now .rp-card{stroke:var(--rp-text);stroke-width:3}
.rp-svg .rp-node{cursor:pointer}
.rp-svg .rp-node .rp-kindword{fill:var(--rp-dim);font-size:11px}
.rp-svg .rp-edge path{fill:none;stroke:var(--rp-control);stroke-width:1.6}
.rp-svg .rp-edge.rp-e-handoff path,.rp-svg .rp-edge.rp-e-delegates path{stroke:var(--rp-text);stroke-width:2}
.rp-svg .rp-edge.rp-e-delegates path{stroke-dasharray:7 4}
.rp-svg .rp-edge.rp-e-routes path{stroke-dasharray:2 4;stroke-linecap:round;stroke:var(--rp-text)}
.rp-svg .rp-edge.rp-e-loop path{stroke-dasharray:6 3}
.rp-svg .rp-edge.rp-e-uses path,.rp-svg .rp-edge.rp-e-assigned path,.rp-svg .rp-edge.rp-e-depends_on path{stroke-dasharray:3 3}
.rp-svg .rp-edge.rp-e-reviews path{stroke:var(--rp-human-ink);stroke-dasharray:4 2}
.rp-svg .rp-edge text{font-size:11px;fill:var(--rp-dim)}
@media (prefers-reduced-motion:no-preference){
  .rp-b-live .rp-dot{animation:rp-pulse 1.6s ease-in-out infinite}
  .rp-step,.rp-svg .rp-block,.rp-svg .rp-arrow{transition:opacity .15s ease}
}
@keyframes rp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (max-width:960px){
  .rp-shell{grid-template-columns:minmax(0,1fr)}
  .rp-runs{max-height:220px;border-right:0;border-bottom:1px solid var(--rp-border)}
  .rp-stage{grid-template-columns:minmax(0,1fr)}
  .rp-narr{border-left:0;border-top:1px solid var(--rp-border);max-height:340px}
}
`;

function ensureStyle() {
  if (document.getElementById('rp-style')) return;
  const tag = document.createElement('style');
  tag.id = 'rp-style';
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

// ── theme ─────────────────────────────────────────────────────────────

function luminance(color) {
  const c = String(color || '').trim();
  let rgb = null;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1].length === 3 ? hex[1].split('').map((x) => x + x).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  } else {
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      if (parts.length >= 4 && parts[3] === 0) return null; // transparent
      rgb = parts.slice(0, 3);
    }
  }
  if (!rgb || rgb.some((x) => Number.isNaN(x))) return null;
  const lin = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function detectTheme() {
  const saved = storageGet('rp-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  if (!S.solo) {
    const css = getComputedStyle(document.documentElement).getPropertyValue('--db-bg').trim();
    const L = luminance(css) ?? luminance(getComputedStyle(document.body).backgroundColor);
    if (L != null) return L < 0.35 ? 'dark' : 'light';
  }
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}

// ── URL ───────────────────────────────────────────────────────────────

function runFromUrl() {
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('run')) return qs.get('run');
    const m = window.location.hash.match(/^#\/?replay\?(.*)$/);
    if (m) return new URLSearchParams(m[1]).get('run');
  } catch { /* ignore */ }
  return null;
}

function writeRunToUrl(id) {
  if (S.solo) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('run', id);
    if (/^#\/?replay/.test(url.hash)) url.hash = '';
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

// ── formatting ────────────────────────────────────────────────────────

const C = () => S.core;

function offset(t) {
  return `+${t.toFixed(t < 10 ? 2 : 1)} s`;
}

function prettyJson(value, max = 20000) {
  let text;
  try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}

function laneKindClass(lane) {
  return lane ? lane.kind : 'agent';
}

function statusBadge(row) {
  const status = row.live ? 'live' : (row.status || 'completed');
  const text = { live: 'Live', completed: 'Completed', failed: 'Failed', running: 'Running', incomplete: 'Incomplete' }[status] || status;
  return h('span', { class: `rp-badge rp-b-${status}` }, status === 'live' ? h('span', { class: 'rp-dot', 'aria-hidden': 'true' }) : null, text);
}

// ── public API ────────────────────────────────────────────────────────

/**
 * Mount the view. Dashboard: render(container). Standalone:
 * render(container, {standalone: true, events, graph, title}).
 */
export async function render(container, opts = {}) {
  cleanup();
  ensureStyle();
  const core = await getCore();
  const solo = Boolean(opts.standalone);
  S = {
    core,
    solo,
    container,
    abort: new AbortController(),
    timers: [],
    es: null,
    runs: [],
    runId: null,
    run: null,
    events: [],
    seen: new Set(),
    graph: null,
    model: null,
    layout: null,
    cursor: -1,
    follow: true,
    view: storageGet('rp-view') === 'map' ? 'map' : 'timeline',
    overlay: storageGet('rp-overlay') === '1',
    heat: storageGet('rp-heat') === 'latency' ? 'latency' : 'cost',
    zoom: null,
    tab: 'what',
    nodeSel: null,
    hover: null,
    asks: new Map(), // approvalId -> {editing, text, error, sent, reason}
    renderQueued: false,
    lastAnnounce: 0,
    newSince: 0,
    ro: null,
  };
  S.theme = detectTheme();
  buildShell();
  if (solo) {
    S.run = { run_id: 'export', name: opts.title || 'Recorded run', status: 'completed', live: false };
    setEvents(opts.events || [], opts.graph || null);
    S.cursor = S.model.narration.length - 1;
    renderAll();
  } else {
    await refreshRuns();
    const wanted = runFromUrl();
    const pick = (wanted && S.runs.find((r) => r.run_id === wanted)) || S.runs[0];
    if (pick) await loadRun(pick.run_id);
    else renderAll();
    S.timers.push(setInterval(() => { refreshRuns(true); }, 10000));
  }
  if (typeof ResizeObserver !== 'undefined') {
    S.ro = new ResizeObserver(() => {
      if (!S) return;
      const w = S.els.canvas.clientWidth;
      if (w === S.lastWidth) return;
      S.lastWidth = w;
      if (S.zoom == null && S.view === 'timeline') queueRender();
    });
    S.ro.observe(S.els.canvas);
  }
}

export function cleanup() {
  if (!S) return;
  try { S.abort.abort(); } catch { /* ignore */ }
  if (S.es) { try { S.es.close(); } catch { /* ignore */ } }
  for (const t of S.timers) clearInterval(t);
  if (S.ro) { try { S.ro.disconnect(); } catch { /* ignore */ } }
  S = null;
}

// ── data ──────────────────────────────────────────────────────────────

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { signal: S.abort.signal, ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refreshRuns(autoload = false) {
  if (!S || S.solo) return;
  try {
    const rows = await fetchJson('/api/replay/runs');
    S.runs = Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (e.name === 'AbortError') return;
    S.runs = S.runs || [];
  }
  if (!S) return;
  const row = S.runs.find((r) => r.run_id === S.runId);
  if (row && !S.es && S.run && (row.status !== S.run.status || row.live !== S.run.live)) {
    S.run = row;
    renderBar();
  }
  renderRunList();
  if (autoload && !S.runId && S.runs.length) loadRun(S.runs[0].run_id); // first recording appeared
}

function setEvents(events, graph) {
  S.events = [];
  S.seen = new Set();
  S.graph = graph || null; // else picked up from workflow_start.data.graph by addEvents
  addEvents(events, false);
  rebuild();
}

function addEvents(list, render = true) {
  let added = 0;
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const id = C().eventId(ev, S.events.length);
    if (typeof ev.sequence_num === 'number') {
      if (S.seen.has(id)) continue;
      S.seen.add(id);
    }
    S.events.push(ev);
    if (!S.graph && ev.event_type === 'workflow_start' && ev.data && ev.data.graph) S.graph = ev.data.graph;
    added += 1;
  }
  if (added && render) {
    S.newSince += added;
    rebuild();
    queueRender();
  }
  return added;
}

function rebuild() {
  const wasAtEnd = S.model ? S.cursor >= S.model.narration.length - 1 : true;
  S.model = C().buildModel(S.events, S.graph);
  S.layout = null;
  const n = S.model.narration.length;
  if (S.follow && (wasAtEnd || S.run?.live)) S.cursor = n - 1;
  S.cursor = Math.min(Math.max(S.cursor, n ? 0 : -1), n - 1);
}

async function loadRun(id) {
  if (!S) return;
  if (S.es) { try { S.es.close(); } catch { /* ignore */ } S.es = null; }
  S.runId = id;
  S.nodeSel = null;
  S.asks = new Map();
  writeRunToUrl(id);
  renderRunList();
  let data;
  try {
    data = await fetchJson(`/api/replay/runs/${encodeURIComponent(id)}/events`);
  } catch (e) {
    if (e.name === 'AbortError') return;
    S.run = { run_id: id, name: id, status: 'incomplete', live: false };
    setEvents([], null);
    renderAll(`Could not load run ${id} (${e.message}).`);
    return;
  }
  if (!S || S.runId !== id) return;
  S.run = data.run || S.runs.find((r) => r.run_id === id) || { run_id: id, name: id };
  S.follow = true;
  setEvents(data.events || [], data.graph || null);
  S.cursor = S.model.narration.length - 1;
  renderAll();
  if (S.run.live) startStream(id);
}

function maxSeq() {
  let m = null;
  for (const ev of S.events) if (typeof ev.sequence_num === 'number' && (m == null || ev.sequence_num > m)) m = ev.sequence_num;
  return m;
}

function startStream(id) {
  if (typeof EventSource === 'undefined') return;
  const after = maxSeq();
  const url = `/api/replay/runs/${encodeURIComponent(id)}/stream${after != null ? `?after_seq=${after}` : ''}`;
  const es = new EventSource(url);
  S.es = es;
  es.addEventListener('ctx', (e) => {
    if (!S || S.es !== es) return;
    try { addEvents([JSON.parse(e.data)]); } catch { /* skip bad line */ }
  });
  es.addEventListener('end', () => {
    es.close();
    if (!S || S.es !== es) return;
    S.es = null;
    if (S.run) S.run = { ...S.run, live: false, status: S.run.status === 'running' ? 'completed' : S.run.status };
    announce('The run finished.');
    refreshRuns();
    queueRender();
  });
}

// ── shell ─────────────────────────────────────────────────────────────

function buildShell() {
  const c = S.container;
  clear(c);
  const els = {};
  els.root = h('section', { class: 'rp-root', 'data-theme': S.theme, 'aria-label': 'PraisonAI Replay' });
  els.shell = h('div', { class: `rp-shell${S.solo ? ' rp-solo' : ''}` });
  if (!S.solo) {
    els.runs = h('nav', { class: 'rp-runs', 'aria-label': 'Recorded runs' });
    els.shell.appendChild(els.runs);
  }
  els.main = h('div', { class: 'rp-main' });
  els.bar = h('div', { class: 'rp-bar' });
  els.pending = h('div', { class: 'rp-pending', role: 'region', 'aria-label': 'Waiting for you', hidden: true });
  els.stage = h('div', { class: 'rp-stage' });
  els.canvas = h('div', { class: 'rp-canvas' });
  els.narr = h('div', { class: 'rp-narr' });
  els.stage.append(els.canvas, els.narr);
  els.legend = h('div', { class: 'rp-legend', role: 'group', 'aria-label': 'Legend' });
  els.scrub = h('div', { class: 'rp-scrub' });
  els.drawer = h('div', { class: 'rp-drawer', role: 'region', 'aria-label': 'Details' });
  els.live = h('div', { class: 'rp-sr', 'aria-live': 'polite', role: 'status' });
  els.main.append(els.bar, els.pending, els.stage, els.legend, els.scrub, els.drawer);
  els.shell.appendChild(els.main);
  els.root.append(els.shell, els.live);
  els.root.addEventListener('keydown', onKeyDown);
  c.appendChild(els.root);
  S.els = els;
}

function announce(text) {
  if (!S) return;
  S.els.live.textContent = text;
}

function queueRender() {
  if (!S || S.renderQueued) return;
  S.renderQueued = true;
  const run = () => {
    if (!S) return;
    S.renderQueued = false;
    renderAll();
    const now = Date.now();
    if (S.run?.live && S.newSince && now - S.lastAnnounce > 4000) {
      announce(`${S.newSince} new ${S.newSince === 1 ? 'event' : 'events'}. ${S.model.narration.at(-1)?.text || ''}`);
      S.newSince = 0;
      S.lastAnnounce = now;
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 120));
  else setTimeout(run, 120);
}

/** Remember what had focus so a re-render (live updates) doesn't lose it. */
function focusKey() {
  const a = document.activeElement;
  if (!a || !S.els.root.contains(a)) return null;
  const el = a.closest('[data-key]');
  return el ? el.getAttribute('data-key') : null;
}

function restoreFocus(key) {
  if (!key) return;
  const el = S.els.root.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (el) el.focus({ preventScroll: true });
}

function renderAll(errorText) {
  if (!S) return;
  const key = focusKey();
  S.els.root.setAttribute('data-theme', S.theme);
  renderRunList();
  renderBar();
  if (!S.solo && !S.runs.length && !S.runId) {
    renderEmpty();
    return;
  }
  renderPending();
  if (S.view === 'map') renderMap(); else renderTimeline();
  renderLegend();
  renderNarration();
  renderScrubber();
  renderDrawer(errorText);
  restoreFocus(key);
}

function renderEmpty() {
  for (const k of ['pending', 'narr', 'scrub', 'drawer', 'legend']) clear(S.els[k]);
  S.els.pending.hidden = true;
  clear(S.els.canvas);
  S.els.canvas.appendChild(h('div', { class: 'rp-empty' },
    h('h2', { text: 'No recorded runs yet' }),
    h('p', { text: 'Replay shows who did what, when, why and at what cost, once a run has been recorded. Record one and it appears here (live runs update as they go):' }),
    h('pre', { text: 'praisonai replay view agents.yaml' }),
    h('p', { text: 'or from Python:' }),
    h('pre', { text: 'from praisonai.replay import record\n\nwith record(live=True):\n    team.start()' }),
    h('p', { text: 'Runs are read from $PRAISONAI_TRACES_DIR, else $PRAISON_HOME/traces, else ~/.praison/traces.' }),
  ));
}

// ── run picker ────────────────────────────────────────────────────────

function renderRunList() {
  if (!S || S.solo || !S.els.runs) return;
  const nav = S.els.runs;
  const key = focusKey();
  clear(nav);
  nav.appendChild(h('h2', { id: 'rp-runs-h', text: 'Runs' }));
  if (!S.runs.length) {
    nav.appendChild(h('p', { class: 'rp-note', style: 'padding:0 14px', text: 'Nothing recorded yet.' }));
    return;
  }
  const ul = h('ul', { 'aria-labelledby': 'rp-runs-h' });
  for (const r of S.runs) {
    const meta = [r.kind, `${(r.agents || []).length} agents`, `${r.events} events`, C().formatCost(r.cost_usd)].filter(Boolean).join(' · ');
    const started = typeof r.started_at === 'number' ? new Date(r.started_at * 1000).toLocaleString() : '';
    ul.appendChild(h('li', null, h('button', {
      type: 'button',
      class: 'rp-run',
      'data-key': `run:${r.run_id}`,
      'aria-current': r.run_id === S.runId ? 'true' : 'false',
      onclick: () => loadRun(r.run_id),
    },
    h('span', { class: 'rp-run-name', text: r.name || r.run_id }),
    h('span', { class: 'rp-run-meta' }, statusBadge(r), ' ', started),
    h('span', { class: 'rp-run-meta', text: meta }))));
  }
  nav.appendChild(ul);
  restoreFocus(key);
}

// ── header bar ────────────────────────────────────────────────────────

function renderBar() {
  const bar = S.els.bar;
  const key = focusKey();
  clear(bar);
  try { buildBar(bar); } finally { restoreFocus(key); }
}

function buildBar(bar) {
  const run = S.run;
  const m = S.model;
  if (run) {
    bar.appendChild(h('h2', { class: 'rp-title', text: run.name || run.run_id }));
    bar.appendChild(statusBadge(run));
  }
  if (m && m.events.length) {
    const t = m.totals;
    const bits = [C().formatDuration(t.duration_ms), C().formatCost(t.cost_usd), `${t.llm_calls} LLM calls`, `${t.tool_calls} tool calls`].filter(Boolean);
    bar.appendChild(h('span', { class: 'rp-meta', text: bits.join(' · ') }));
  }
  bar.appendChild(h('span', { class: 'rp-spacer' }));
  if (!m || !m.events.length) return;
  const seg = h('div', { class: 'rp-seg', role: 'group', 'aria-label': 'View' });
  for (const [id, label] of [['timeline', 'Timeline'], ['map', 'Map']]) {
    seg.appendChild(h('button', {
      type: 'button', class: 'rp-btn', 'aria-pressed': S.view === id ? 'true' : 'false', 'data-key': `view:${id}`,
      onclick: () => { S.view = id; storageSet('rp-view', id); renderAll(); },
    }, label));
  }
  bar.appendChild(seg);
  bar.appendChild(h('button', {
    type: 'button', class: 'rp-btn', 'aria-pressed': S.overlay ? 'true' : 'false', 'data-key': 'overlay',
    onclick: () => { S.overlay = !S.overlay; storageSet('rp-overlay', S.overlay ? '1' : '0'); renderAll(); },
  }, 'Cost & latency'));
  if (S.overlay) {
    const sel = h('select', { class: 'rp-select', 'aria-label': 'Heat shows', 'data-key': 'heat', onchange: (e) => { S.heat = e.target.value; storageSet('rp-heat', S.heat); renderAll(); } },
      h('option', { value: 'cost', selected: S.heat === 'cost' }, 'Heat: cost'),
      h('option', { value: 'latency', selected: S.heat === 'latency' }, 'Heat: latency'));
    bar.appendChild(sel);
  }
  if (S.view === 'timeline') {
    const z = h('div', { class: 'rp-seg', role: 'group', 'aria-label': 'Zoom' });
    z.append(
      h('button', { type: 'button', class: 'rp-btn', 'aria-label': 'Zoom out', 'data-key': 'zoom-out', onclick: () => zoomBy(1 / 1.6) }, '−'),
      h('button', { type: 'button', class: 'rp-btn', 'aria-label': 'Fit to width', 'data-key': 'zoom-fit', onclick: () => { S.zoom = null; renderAll(); } }, 'Fit'),
      h('button', { type: 'button', class: 'rp-btn', 'aria-label': 'Zoom in', 'data-key': 'zoom-in', onclick: () => zoomBy(1.6) }, '+'),
    );
    bar.appendChild(z);
  }
  if (S.run?.live && S.cursor < m.narration.length - 1) {
    bar.appendChild(h('button', { type: 'button', class: 'rp-btn', 'data-key': 'golive', onclick: () => { S.follow = true; setCursor(m.narration.length - 1); } }, 'Jump to live'));
  }
  bar.appendChild(h('button', {
    type: 'button', class: 'rp-btn', 'data-key': 'theme', 'aria-label': `Switch to ${S.theme === 'dark' ? 'light' : 'dark'} theme`,
    onclick: () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; storageSet('rp-theme', S.theme); renderAll(); },
  }, S.theme === 'dark' ? 'Light' : 'Dark'));
}

function zoomBy(f) {
  const current = S.zoom || S.fitPps || 60;
  S.zoom = Math.min(4000, Math.max(4, current * f));
  renderAll();
}

// ── cursor ────────────────────────────────────────────────────────────

function cursorTime() {
  const n = S.model.narration[S.cursor];
  return n ? n.t : S.model.duration;
}

function setCursor(i, focusTarget = null) {
  if (!S || !S.model) return;
  const n = S.model.narration.length;
  if (!n) return;
  S.cursor = Math.max(0, Math.min(n - 1, i));
  S.follow = S.cursor === n - 1;
  S.nodeSel = null;
  applyCursor(true);
  renderScrubber();
  renderDrawer();
  renderBar();
  if (focusTarget === 'narration') focusStep(S.cursor);
  else if (focusTarget === 'canvas') focusCanvasItem();
}

function focusStep(i) {
  const btn = S.els.narr.querySelector(`[data-i="${i}"]`);
  if (btn) btn.focus({ preventScroll: true });
}

function focusCanvasItem() {
  const item = S.model.narration[S.cursor];
  if (!item) return;
  if (S.view === 'timeline' && item.blockId) {
    const g = S.els.canvas.querySelector(`[data-block="${CSS.escape(item.blockId)}"]`);
    if (g) { g.focus({ preventScroll: true }); return; }
  }
  const svg = S.els.canvas.querySelector('svg');
  if (svg) svg.focus({ preventScroll: true });
}

/** Cheap update of "past / now / future" without rebuilding the canvas. */
function applyCursor(smooth = false) {
  const m = S.model;
  const t = cursorTime();
  const cur = m.narration[S.cursor];
  const eps = 1e-6;
  for (const g of S.els.canvas.querySelectorAll('[data-start]')) {
    const start = Number(g.getAttribute('data-start'));
    g.classList.toggle('rp-future', start > t + eps);
  }
  for (const g of S.els.canvas.querySelectorAll('.rp-block')) {
    const on = cur && cur.blockId === g.getAttribute('data-block');
    g.classList.toggle('rp-sel', Boolean(on));
    g.setAttribute('tabindex', on ? '0' : '-1');
  }
  if (!S.els.canvas.querySelector('.rp-block[tabindex="0"]')) {
    const first = S.els.canvas.querySelector('.rp-block');
    if (first) first.setAttribute('tabindex', '0');
  }
  const line = S.els.canvas.querySelector('.rp-cursor-g');
  if (line && S.tl) {
    const x = S.tl.x(t);
    line.setAttribute('transform', `translate(${x},0)`);
    const label = line.querySelector('text');
    if (label) {
      label.textContent = offset(t);
      const flip = x + 60 > S.tl.width;
      label.setAttribute('x', flip ? '-4' : '4');
      label.setAttribute('text-anchor', flip ? 'end' : 'start');
    }
  }
  if (S.view === 'map') applyMapCursor();
  const list = S.els.narr.querySelectorAll('.rp-step');
  list.forEach((btn) => {
    const i = Number(btn.getAttribute('data-i'));
    btn.toggleAttribute('aria-current', false);
    if (i === S.cursor) btn.setAttribute('aria-current', 'step');
    btn.classList.toggle('rp-future', i > S.cursor);
    btn.setAttribute('tabindex', i === S.cursor ? '0' : '-1');
  });
  const curBtn = S.els.narr.querySelector(`[data-i="${S.cursor}"]`);
  if (curBtn) {
    const box = S.els.narr;
    const top = curBtn.offsetTop; // .rp-narr is the offsetParent
    if (top < box.scrollTop || top + curBtn.offsetHeight > box.scrollTop + box.clientHeight) {
      const target = Math.max(0, top - box.clientHeight / 2);
      if (smooth && !reducedMotion() && box.scrollTo) box.scrollTo({ top: target, behavior: 'smooth' });
      else box.scrollTop = target;
    }
  }
}

function onKeyDown(e) {
  if (!S || !S.model || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
  if (t.closest && t.closest('[role="tablist"]')) return;
  const inNarr = S.els.narr.contains(t);
  const inCanvas = S.els.canvas.contains(t);
  const where = inNarr ? 'narration' : (inCanvas ? 'canvas' : null);
  const last = S.model.narration.length - 1;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    setCursor(S.cursor + (e.key === 'ArrowRight' ? 1 : -1), where);
  } else if (e.key === 'Home') {
    e.preventDefault();
    setCursor(0, where);
  } else if (e.key === 'End') {
    e.preventDefault();
    setCursor(last, where);
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && inNarr) {
    e.preventDefault();
    setCursor(S.cursor + (e.key === 'ArrowDown' ? 1 : -1), 'narration');
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && inCanvas && S.view === 'map') {
    e.preventDefault();
    moveMapFocus(e.key === 'ArrowDown' ? 1 : -1);
  } else if ((e.key === 'Enter' || e.key === ' ') && inCanvas && t.getAttribute && t.getAttribute('role') === 'button') {
    e.preventDefault();
    t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}

// ── hover / focus sync ────────────────────────────────────────────────

function highlight(item) {
  const root = S.els.root;
  for (const el of root.querySelectorAll('.rp-hl')) el.classList.remove('rp-hl');
  if (!item) return;
  const sel = [];
  if (item.blockId) sel.push(`[data-block="${CSS.escape(item.blockId)}"]`);
  if (item.arrowId) sel.push(`[data-arrow="${CSS.escape(item.arrowId)}"]`);
  if (item.chapterId) sel.push(`[data-chapter="${CSS.escape(item.chapterId)}"]`);
  if (S.view === 'map') {
    const ev = S.model.events[S.model.eventIndex.get(item.id)];
    for (const nid of C().nodeIdsForEvent(ev)) sel.push(`[data-node="${CSS.escape(nid)}"]`);
  }
  for (const q of sel) for (const el of root.querySelectorAll(q)) el.classList.add('rp-hl');
  for (const btn of S.els.narr.querySelectorAll('.rp-step')) {
    const n = S.model.narration[Number(btn.getAttribute('data-i'))];
    const match = n && ((item.blockId && n.blockId === item.blockId) || n.id === item.id);
    if (match) btn.classList.add('rp-hl');
  }
}

function hoverHandlers(item) {
  return {
    onmouseenter: () => highlight(item),
    onmouseleave: () => highlight(null),
    onfocus: () => highlight(item),
    onblur: () => highlight(null),
  };
}

// ── timeline ──────────────────────────────────────────────────────────

function laneRows() {
  const m = S.model;
  const top = m.lanes.filter((l) => !l.parent);
  const rows = [];
  for (const lane of top) {
    rows.push(lane);
    for (const sub of m.lanes.filter((l) => l.parent === lane.id)) rows.push(sub);
  }
  return rows;
}

function heatColor(r) {
  const css = getComputedStyle(S.els.root);
  const lo = css.getPropertyValue('--rp-heat-lo').trim() || '#C0772F';
  const hi = css.getPropertyValue('--rp-heat-hi').trim() || '#8F2D07';
  const p = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = p(lo);
  const b = p(hi);
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * r));
  return `rgb(${mix.join(',')})`;
}

function blockText(b) {
  const parts = [b.kind === 'llm' ? `LLM ${b.label}` : (b.kind === 'approval' ? `approval: ${b.label}` : b.label)];
  if (b.count > 1) parts.push(`×${b.count}`);
  return parts.join(' ');
}

function blockAria(b, lane) {
  const who = lane ? (lane.parent ? `${S.model.lanes.find((l) => l.id === lane.parent)?.label} (${lane.label})` : lane.label) : '';
  const what = b.kind === 'llm' ? `${who} thinking with ${b.label}` : b.kind === 'tool' ? `${who} using ${b.label}` : `Approval for ${b.label}, ${b.status}`;
  const bits = [what];
  if (b.count > 1) bits.push(`${b.count} times`);
  bits.push(`at ${offset(b.start)}`);
  const dur = C().formatDuration(b.durationMs);
  if (dur) bits.push(dur);
  const cost = C().formatCost(b.cost);
  if (cost) bits.push(cost);
  if (b.status === 'error') bits.push('failed');
  if (b.open) bits.push('still running');
  return bits.join(', ');
}

/** Full text clipped to a box (nested <svg> viewport), so what is visible is a
 *  prefix of the real label and the accessible name can contain it verbatim. */
function clippedText(x, y, w, h, attrs, text) {
  return s('svg', { x, y, width: Math.max(0, w), height: h, overflow: 'hidden', 'aria-hidden': 'true' },
    s('text', { ...attrs, text }));
}

function glyph(kind, x, y, size, cls = 'rp-glyph') {
  const r = size / 2;
  if (kind === 'agent') return s('circle', { class: cls, cx: x + r, cy: y + r, r: r });
  if (kind === 'manager') return s('rect', { class: cls, x, y, width: size, height: size });
  if (kind === 'human') return s('path', { class: cls, d: `M${x + r},${y} L${x + size},${y + r} L${x + r},${y + size} L${x},${y + r} Z` });
  if (kind === 'tool') return s('rect', { class: cls, x: x - 1, y: y + 1, width: size + 2, height: size - 2, rx: 3 });
  return s('rect', { class: cls, x, y, width: size, height: size, rx: 1 });
}

function renderTimeline() {
  const m = S.model;
  const canvas = S.els.canvas;
  const scroll = canvas.scrollLeft;
  clear(canvas);
  if (!m.events.length) {
    canvas.appendChild(h('div', { class: 'rp-empty' }, h('h2', { text: 'No events yet' }), h('p', { text: S.run?.live ? 'This run is live; events appear as they are recorded.' : 'This recording is empty.' })));
    S.tl = null;
    return;
  }
  const avail = Math.max(480, (canvas.clientWidth || 900) - GUTTER - PAD_R);
  const dur = Math.max(m.duration, 0.05);
  S.fitPps = avail / dur;
  const pps = S.zoom || S.fitPps;
  const plotW = Math.max(dur * pps, 120);
  const x = (t) => GUTTER + t * pps;
  const chapterH = m.chapterRows * CH_ROW;
  const lanesTop = AXIS_H + chapterH + (chapterH ? 8 : 4);
  const rows = laneRows();
  const laneY = new Map();
  let y = lanesTop;
  for (const lane of rows) {
    const hgt = lane.parent ? SUB_H : LANE_H;
    laneY.set(lane.id, { top: y, h: hgt, mid: y + hgt / 2 });
    y += hgt;
  }
  const height = y + 10;
  const width = GUTTER + plotW + PAD_R;
  S.tl = { x, laneY, width };

  const svg = s('svg', {
    class: 'rp-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', tabindex: '-1',
    'aria-label': `Timeline: ${rows.length} lanes, ${m.blocks.length} blocks over ${C().formatDuration(m.duration * 1000)}. Use the step list or the arrow keys to move through it.`,
  });
  svg.appendChild(s('defs', null,
    s('marker', { id: 'rp-head', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { class: 'rp-marker', d: 'M0,0 L10,5 L0,10 z' })),
    s('marker', { id: 'rp-head-h', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { class: 'rp-marker-human', d: 'M0,0 L10,5 L0,10 z' })),
  ));

  // lanes and gutter labels
  const lanesG = s('g', { 'aria-hidden': 'true' });
  rows.forEach((lane, i) => {
    const ly = laneY.get(lane.id);
    lanesG.appendChild(s('rect', { class: i % 2 ? 'rp-lanebg-alt' : 'rp-lanebg', x: 0, y: ly.top, width, height: ly.h }));
    const label = s('g', null);
    if (lane.parent) {
      label.appendChild(s('text', { x: 30, y: ly.mid + 4, class: 'rp-dimtext', text: `↳ ${C().truncate(lane.label, 18)}` }));
    } else {
      label.appendChild(glyph(lane.kind, 10, ly.mid - 7, 14, `rp-body rp-f-${laneKindClass(lane)}`));
      const tot = m.totals.agents[lane.id];
      const showTot = S.overlay && tot && (tot.cost_usd || tot.busy_ms);
      label.appendChild(s('text', { x: 32, y: showTot ? ly.mid - 3 : ly.mid + 4, 'font-weight': '600', text: C().truncate(lane.label, 20) }));
      if (showTot) {
        const bits = [C().formatCost(tot.cost_usd), C().formatDuration(tot.busy_ms) && `${C().formatDuration(tot.busy_ms)} busy`].filter(Boolean).join(' · ');
        label.appendChild(s('text', { x: 32, y: ly.mid + 12, class: 'rp-dimtext', 'font-size': '11', text: bits }));
      }
    }
    lanesG.appendChild(label);
  });
  lanesG.appendChild(s('line', { class: 'rp-grid', x1: GUTTER - 0.5, x2: GUTTER - 0.5, y1: 0, y2: height }));
  svg.appendChild(lanesG);

  // axis ticks
  const axis = s('g', { 'aria-hidden': 'true' });
  const step = niceStep(dur, plotW);
  for (let t = 0; t <= dur + 1e-9; t += step) {
    const tx = x(t);
    axis.appendChild(s('line', { class: 'rp-grid', x1: tx, x2: tx, y1: AXIS_H - 6, y2: height, 'stroke-opacity': 0.45 }));
    axis.appendChild(s('text', { x: tx + 3, y: AXIS_H - 9, class: 'rp-dimtext', 'font-size': '11', text: tickLabel(t, step) }));
  }
  svg.appendChild(axis);

  // chapters
  const chG = s('g', { 'aria-hidden': 'true' });
  for (const c of m.chapters) {
    const cx = x(c.start);
    const cw = Math.max(x(c.end) - cx, 10);
    const cy = AXIS_H + c.row * CH_ROW;
    const prefix = c.kind === 'task' ? 'Task' : ({ parallel: 'Parallel', loop: 'Loop', repeat: 'Repeat', route: 'Route', if: 'If', discussion: 'Discussion' }[c.pattern] || 'Step');
    let text = `${prefix} ${c.label}${c.count > 1 ? ` ×${c.count}` : ''}${c.route ? ` → ${c.route}` : ''}${c.status === 'failed' ? ' (failed)' : ''}`;
    const g = s('g', { class: 'rp-chapter', 'data-chapter': c.id, 'data-start': c.start },
      s('rect', { x: cx, y: cy + 2, width: cw, height: CH_ROW - 4, rx: 4 }),
      cw > 30 ? clippedText(cx + 5, cy, cw - 8, CH_ROW, { x: 0, y: CH_ROW / 2 + 4, 'font-size': '11' }, text) : null,
      s('title', { text }));
    chG.appendChild(g);
  }
  svg.appendChild(chG);

  // blocks
  const maxHeat = Math.max(1e-12, ...m.blocks.filter((b) => b.kind !== 'approval').map((b) => (S.heat === 'cost' ? b.cost : b.durationMs)));
  const blocksG = s('g', { role: 'group', 'aria-label': 'Work blocks' });
  for (const b of m.blocks) {
    const ly = laneY.get(b.lane);
    if (!ly) continue;
    const lane = m.lanes.find((l) => l.id === b.lane);
    const owner = lane && lane.parent ? m.lanes.find((l) => l.id === lane.parent) : lane;
    const bx = x(b.start);
    const bw = Math.max(x(b.end) - bx, MIN_BLOCK);
    const bh = ly.h - 16;
    const by = ly.top + 8 - (S.overlay ? 3 : 0);
    const fillKind = b.kind === 'tool' ? 'tool' : (b.kind === 'approval' ? 'human' : (owner && owner.kind === 'manager' ? 'manager' : 'agent'));
    const cls = ['rp-block', `rp-k-${b.kind}`, `rp-o-${fillKind}`];
    if (b.open) cls.push('rp-open');
    const text = blockText(b) + (b.status === 'error' ? ' failed' : '') + (b.kind === 'approval' && b.status === 'pending' ? ' — waiting for you' : '');
    const heatVal = S.heat === 'cost' ? C().formatCost(b.cost) : C().formatDuration(b.durationMs);
    const full = S.overlay && heatVal && b.kind !== 'approval' ? `${text} · ${heatVal}` : text;
    const showText = bw - 24 >= 20;
    const g = s('g', {
      class: cls.join(' '), 'data-block': b.id, 'data-key': `block:${b.id}`, 'data-start': b.start,
      role: 'button', tabindex: '-1', 'aria-label': showText ? `${full}. ${blockAria(b, lane)}` : blockAria(b, lane),
      onclick: () => selectBlock(b),
      ...hoverHandlers({ blockId: b.id, id: b.eventIds[0] }),
    });
    g.appendChild(s('rect', { class: 'rp-ring', x: bx - 3, y: by - 3, width: bw + 6, height: bh + 6, rx: 6 }));
    g.appendChild(s('rect', { class: `rp-body rp-f-${fillKind}`, x: bx, y: by, width: bw, height: bh, rx: b.kind === 'tool' ? 9 : 3 }));
    const glyphKind = b.kind === 'tool' ? 'tool' : (b.kind === 'approval' ? 'human' : fillKind);
    if (bw >= 18) g.appendChild(glyph(glyphKind, bx + 5, by + bh / 2 - 5, 10));
    if (showText) g.appendChild(clippedText(bx + 20, by, bw - 24, bh, { class: 'rp-onfill', x: 0, y: bh / 2 + 4 }, full));
    else if (b.count > 1) g.appendChild(s('text', { x: bx + bw + 3, y: by + bh / 2 + 4, 'font-weight': '700', 'aria-hidden': 'true', text: `×${b.count}` }));
    if (S.overlay && b.kind !== 'approval') {
      const v = S.heat === 'cost' ? b.cost : b.durationMs;
      const r = Math.min(1, v / maxHeat);
      const hh = 2 + Math.round(6 * r);
      g.appendChild(s('rect', { class: 'rp-heat', x: bx, y: by + bh + 2, width: bw, height: hh, fill: heatColor(r) }));
    }
    g.appendChild(s('title', { text: full }));
    blocksG.appendChild(g);
  }
  svg.appendChild(blocksG);

  // arrows
  const arrowsG = s('g', { 'aria-hidden': 'true' }); // told by the step list
  for (const a of m.arrows) {
    const from = laneY.get(a.from);
    const to = laneY.get(a.to);
    if (!from || !to || a.from === a.to) continue;
    const ax = x(a.t);
    const down = to.mid > from.mid;
    const y1 = from.mid + (down ? 10 : -10);
    const y2 = to.mid + (down ? -12 : 12);
    const bend = 22;
    const d = `M${ax},${y1} C${ax + bend},${y1} ${ax + bend},${y2} ${ax},${y2}`;
    const human = a.kind === 'ask' || a.kind === 'answer';
    const labelY = (y1 + y2) / 2 + 4;
    const lw = a.label.length * 6.4 + 8;
    const lx = ax + bend + lw > width - 4 ? ax - lw - 4 : ax + bend - 2;
    arrowsG.appendChild(s('g', { class: `rp-arrow rp-a-${a.kind}`, 'data-arrow': a.id, 'data-start': a.t, 'aria-hidden': 'true' },
      s('path', { d, 'marker-end': human ? 'url(#rp-head-h)' : 'url(#rp-head)' }),
      s('rect', { class: 'rp-labelbg', x: lx, y: labelY - 11, width: lw, height: 15, rx: 3 }),
      s('text', { x: lx + 4, y: labelY, text: a.label })));
  }
  svg.appendChild(arrowsG);

  // cursor
  const t = cursorTime();
  svg.appendChild(s('g', { class: 'rp-cursor-g', transform: `translate(${x(t)},0)`, 'aria-hidden': 'true' },
    s('line', { class: 'rp-cursor', x1: 0, x2: 0, y1: AXIS_H - 4, y2: height }),
    s('text', { class: 'rp-cursor-label', x: 4, y: AXIS_H + chapterH + 2, text: offset(t) })));
  canvas.appendChild(svg);
  canvas.scrollLeft = scroll;
  applyCursor();
}

function niceStep(dur, plotW) {
  const target = dur / Math.max(2, Math.floor(plotW / 90));
  const pow = 10 ** Math.floor(Math.log10(target || 1));
  for (const m of [1, 2, 5, 10]) if (m * pow >= target) return m * pow;
  return 10 * pow;
}

function tickLabel(t, step) {
  if (step >= 60) return `${Math.round(t / 60)} min`;
  const digits = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return `${t.toFixed(digits)} s`;
}

function selectBlock(b) {
  const idx = S.model.narration.findIndex((n) => n.blockId === b.id);
  if (idx >= 0) setCursor(idx);
  S.tab = 'what';
  renderDrawer();
}

// ── map ───────────────────────────────────────────────────────────────

const KIND_WORD = { agent: 'agent', tool: 'tool', human: 'you', manager: 'manager', task: 'task', step: 'step', start: 'start', end: 'end', fork: 'fork', join: 'join', decision: 'decision' };

function mapGraph() {
  return S.graph && Array.isArray(S.graph.nodes) && S.graph.nodes.length ? S.graph : C().deriveGraph(S.events);
}

function nodeVisits() {
  const counts = new Map();
  const lastAt = new Map();
  const m = S.model;
  m.events.forEach((ev, i) => {
    for (const nid of C().nodeIdsForEvent(ev)) {
      counts.set(nid, (counts.get(nid) || 0) + 1);
      if (!lastAt.has(nid)) lastAt.set(nid, []);
      lastAt.get(nid).push(i);
    }
  });
  // Brief/Delivered are reached when the run starts/ends, though no event names them.
  const graph = mapGraph();
  const ended = m.events.some((e) => e.event_type === 'workflow_end' || e.event_type === 'session_end');
  for (const n of graph.nodes || []) {
    if (n.kind === 'start' && m.events.length && !counts.has(n.id)) counts.set(n.id, 1);
    if (n.kind === 'end' && ended && !counts.has(n.id)) counts.set(n.id, 1);
  }
  return { counts, at: lastAt };
}

function shapePath(shape, x, y, w, h) {
  if (shape === 'chevron') return `M${x},${y} L${x + w - 10},${y} L${x + w},${y + h / 2} L${x + w - 10},${y + h} L${x},${y + h} Z`;
  if (shape === 'hexagon') return `M${x + 10},${y} L${x + w - 10},${y} L${x + w},${y + h / 2} L${x + w - 10},${y + h} L${x + 10},${y + h} L${x},${y + h / 2} Z`;
  if (shape === 'note') return `M${x},${y} L${x + w - 12},${y} L${x + w},${y + 12} L${x + w},${y + h} L${x},${y + h} Z`;
  return null;
}

function nodeGlyph(node, gx, gy) {
  const k = node.kind;
  const cls = `rp-body rp-f-${['agent', 'tool', 'human', 'manager'].includes(k) ? k : 'neutral'}`;
  if (k === 'agent') return s('circle', { class: cls, cx: gx + 11, cy: gy + 11, r: 11 });
  if (k === 'manager') return s('rect', { class: cls, x: gx, y: gy, width: 22, height: 22 });
  if (k === 'human') return s('path', { class: cls, d: `M${gx + 11},${gy - 1} L${gx + 23},${gy + 11} L${gx + 11},${gy + 23} L${gx - 1},${gy + 11} Z` });
  if (k === 'tool') return s('rect', { class: cls, x: gx - 2, y: gy + 2, width: 26, height: 18, rx: 6 });
  if (k === 'fork' || k === 'join') return s('rect', { class: cls, x: gx + 8, y: gy - 2, width: 6, height: 26 });
  if (k === 'decision') return s('path', { class: cls, d: `M${gx + 5},${gy} L${gx + 17},${gy} L${gx + 22},${gy + 11} L${gx + 17},${gy + 22} L${gx + 5},${gy + 22} L${gx},${gy + 11} Z` });
  if (k === 'start') return s('path', { class: cls, d: `M${gx},${gy} L${gx + 14},${gy} L${gx + 22},${gy + 11} L${gx + 14},${gy + 22} L${gx},${gy + 22} Z` });
  if (k === 'end') return s('g', null, s('rect', { class: cls, x: gx + 2, y: gy, width: 3, height: 22 }), s('path', { class: cls, d: `M${gx + 5},${gy} L${gx + 22},${gy + 5} L${gx + 5},${gy + 11} Z` }));
  if (k === 'task') return s('path', { class: cls, d: `M${gx},${gy} L${gx + 15},${gy} L${gx + 21},${gy + 6} L${gx + 21},${gy + 22} L${gx},${gy + 22} Z` });
  return s('rect', { class: cls, x: gx, y: gy, width: 22, height: 22, rx: 2 });
}

function renderMap() {
  const canvas = S.els.canvas;
  clear(canvas);
  S.tl = null;
  const graph = mapGraph();
  if (!S.layout) S.layout = C().layoutMap(graph);
  const lay = S.layout;
  if (!lay.nodes.length) {
    canvas.appendChild(h('div', { class: 'rp-empty' }, h('h2', { text: 'Nothing to map yet' }), h('p', { text: 'The map appears once agents start talking.' })));
    return;
  }
  const visits = nodeVisits();
  const width = lay.width + 20;
  const height = lay.height + 20;
  const svg = s('svg', {
    class: 'rp-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', tabindex: '-1',
    'aria-label': `${graph.derived ? 'Who talked to whom' : 'Map of the run'}: ${lay.nodes.length} nodes and ${lay.edges.length} connections. Use up and down arrows to move between nodes.`,
  });
  svg.appendChild(s('defs', null,
    s('marker', { id: 'rp-mhead', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { class: 'rp-marker', d: 'M0,0 L10,5 L0,10 z' }))));
  const edgesG = s('g', { 'aria-hidden': 'true' });
  for (const e of lay.edges) {
    const p = e.points;
    let d = `M${p[0][0]},${p[0][1]}`;
    if (e.back) {
      d += p.slice(1).map((q) => ` L${q[0]},${q[1]}`).join('');
    } else {
      for (let j = 1; j < p.length; j++) {
        const mx = (p[j - 1][0] + p[j][0]) / 2;
        d += ` C${mx},${p[j - 1][1]} ${mx},${p[j][1]} ${p[j][0]},${p[j][1]}`;
      }
    }
    const text = C().edgeText(e);
    const seg = Math.max(1, Math.floor(p.length / 2));
    const mid = [(p[seg - 1][0] + p[seg][0]) / 2, (p[seg - 1][1] + p[seg][1]) / 2];
    const lw = text.length * 6 + 8;
    edgesG.appendChild(s('g', { class: `rp-edge rp-e-${e.kind}`, 'data-edge': e.id },
      s('path', { d, 'marker-end': 'url(#rp-mhead)' }),
      s('rect', { class: 'rp-labelbg', x: mid[0] - lw / 2, y: mid[1] - 11, width: lw, height: 15, rx: 3 }),
      s('text', { x: mid[0], y: mid[1], 'text-anchor': 'middle', text })));
  }
  svg.appendChild(edgesG);
  const nodesG = s('g', { role: 'group', 'aria-label': 'Nodes' });
  const ordered = [...lay.nodes].sort((a, b) => a.layer - b.layer || a.order - b.order);
  ordered.forEach((n, i) => {
    const count = visits.counts.get(n.id) || 0;
    const word = KIND_WORD[n.kind] || n.kind;
    const kindLine = count ? `${word} · ×${count}` : word;
    const name = `${n.label} ${kindLine}${count ? `, ${count} events here` : ', not reached yet'}`;
    const g = s('g', {
      class: `rp-node${count ? '' : ' rp-unvisited'}${S.nodeSel === n.id ? ' rp-sel' : ''}`,
      'data-node': n.id, 'data-key': `node:${n.id}`, role: 'button', tabindex: i === 0 ? '0' : '-1',
      'aria-label': name,
      onclick: () => selectNode(n.id),
      onfocus: () => highlight(null),
    });
    const path = shapePath(n.shape, n.x, n.y, n.w, n.h);
    g.appendChild(s('rect', { class: 'rp-ring', x: n.x - 4, y: n.y - 4, width: n.w + 8, height: n.h + 8, rx: 10 }));
    g.appendChild(path ? s('path', { class: 'rp-card', d: path }) : s('rect', { class: 'rp-card', x: n.x, y: n.y, width: n.w, height: n.h, rx: n.kind === 'tool' ? 14 : (n.kind === 'end' ? 2 : 6) }));
    if (n.kind === 'end') g.appendChild(s('rect', { class: 'rp-card', x: n.x + 3, y: n.y + 3, width: n.w - 6, height: n.h - 6, rx: 2, fill: 'none' }));
    g.appendChild(nodeGlyph(n, n.x + 12, n.y + n.h / 2 - 11));
    g.appendChild(clippedText(n.x + 44, n.y, n.w - 50, n.h, { x: 0, y: n.h / 2 - 2, 'font-weight': '600' }, n.label));
    g.appendChild(s('text', { class: 'rp-kindword', x: n.x + 44, y: n.y + n.h / 2 + 13, 'aria-hidden': 'true', text: ` ${kindLine}` }));
    g.appendChild(s('title', { text: name }));
    nodesG.appendChild(g);
  });
  svg.appendChild(nodesG);
  canvas.appendChild(svg);
  applyMapCursor();
}

function applyMapCursor() {
  const item = S.model.narration[S.cursor];
  const ev = item ? S.model.events[S.model.eventIndex.get(item.id)] : null;
  const now = new Set(ev ? C().nodeIdsForEvent(ev) : []);
  for (const g of S.els.canvas.querySelectorAll('.rp-node')) {
    g.classList.toggle('rp-now', now.has(g.getAttribute('data-node')));
  }
}

function moveMapFocus(dir) {
  const nodes = [...S.els.canvas.querySelectorAll('.rp-node')];
  if (!nodes.length) return;
  const i = nodes.indexOf(document.activeElement);
  const next = nodes[Math.max(0, Math.min(nodes.length - 1, i < 0 ? 0 : i + dir))];
  nodes.forEach((n) => n.setAttribute('tabindex', n === next ? '0' : '-1'));
  next.focus();
}

function selectNode(id) {
  S.nodeSel = id;
  for (const g of S.els.canvas.querySelectorAll('.rp-node')) g.classList.toggle('rp-sel', g.getAttribute('data-node') === id);
  S.tab = 'what';
  renderDrawer();
}

// ── legend ────────────────────────────────────────────────────────────

function renderLegend() {
  const lg = S.els.legend;
  clear(lg);
  const item = (cls, text) => h('span', null, h('i', { class: `rp-g ${cls}`, 'aria-hidden': 'true' }), text);
  lg.append(item('rp-g-agent', 'agent (circle)'), item('rp-g-tool', 'tool (rounded)'), item('rp-g-human', 'you (diamond)'), item('rp-g-manager', 'manager (square)'));
  if (S.view === 'timeline') {
    lg.append(h('span', { text: 'solid arrow: hand-off · dashed: delegate · dotted: route' }), h('span', { text: 'outlined block: not reached yet' }));
    if (S.overlay) lg.append(h('span', { text: `bar under a block: ${S.heat === 'cost' ? 'cost' : 'latency'} (taller and darker = more)` }));
  } else {
    lg.append(h('span', { text: 'dashed outline: not reached · bold outline: now' }));
  }
}

// ── narration ─────────────────────────────────────────────────────────

function stepGlyphClass(item) {
  if (item.type.startsWith('approval') || (item.type === 'message_added' && !item.agent)) return 'rp-g-human';
  if (item.type.startsWith('tool')) return 'rp-g-tool';
  if (item.agent === 'Manager') return 'rp-g-manager';
  if (item.agent) return 'rp-g-agent';
  return '';
}

function renderNarration() {
  const box = S.els.narr;
  const scroll = box.scrollTop;
  clear(box);
  box.appendChild(h('h2', { id: 'rp-narr-h', text: 'What happened' }));
  const ol = h('ol', { 'aria-labelledby': 'rp-narr-h' });
  S.model.narration.forEach((n, i) => {
    ol.appendChild(h('li', null, h('button', {
      type: 'button', class: `rp-step${i > S.cursor ? ' rp-future' : ''}`, 'data-i': i, 'data-key': `step:${n.id}`,
      tabindex: i === S.cursor ? '0' : '-1', 'aria-current': i === S.cursor ? 'step' : null,
      onclick: () => { S.tab = S.tab || 'what'; setCursor(i, 'narration'); },
      ...hoverHandlers(n),
    },
    h('span', { class: 'rp-step-t', text: offset(n.t) }),
    h('i', { class: `rp-g ${stepGlyphClass(n)}`, 'aria-hidden': 'true' }),
    h('span', { class: 'rp-step-text', text: n.text }))));
  });
  box.appendChild(ol);
  box.scrollTop = scroll;
  applyCursor();
}

// ── scrubber ──────────────────────────────────────────────────────────

function renderScrubber() {
  const box = S.els.scrub;
  const n = S.model.narration.length;
  const item = S.model.narration[S.cursor];
  const existing = box.querySelector('input[type=range]');
  const valueText = item ? `Step ${S.cursor + 1} of ${n}: ${item.text}` : 'No steps';
  if (existing && Number(existing.max) === Math.max(0, n - 1)) {
    existing.value = String(Math.max(0, S.cursor));
    existing.setAttribute('aria-valuetext', valueText);
    box.querySelector('output').textContent = item ? `${S.cursor + 1} / ${n} · ${offset(item.t)}` : '0 / 0';
    return;
  }
  clear(box);
  if (!n) return;
  box.append(
    h('button', { type: 'button', class: 'rp-btn', 'data-key': 'prev', onclick: () => setCursor(S.cursor - 1) }, h('span', { 'aria-hidden': 'true' }, '← '), 'Previous'),
    h('label', { for: 'rp-scrub-range', class: 'rp-sr', text: 'Step' }),
    h('input', {
      id: 'rp-scrub-range', type: 'range', min: 0, max: Math.max(0, n - 1), step: 1, value: Math.max(0, S.cursor),
      'aria-valuetext': valueText, 'data-key': 'scrub',
      oninput: (e) => setCursor(Number(e.target.value)),
    }),
    h('button', { type: 'button', class: 'rp-btn', 'data-key': 'next', onclick: () => setCursor(S.cursor + 1) }, 'Next', h('span', { 'aria-hidden': 'true' }, ' →')),
    h('output', { for: 'rp-scrub-range', text: item ? `${S.cursor + 1} / ${n} · ${offset(item.t)}` : '' }),
    h('span', { class: 'rp-hint', text: '← → step · Home / End' }),
  );
}

// ── drawer ────────────────────────────────────────────────────────────

const TABS = [['what', 'What happened'], ['why', 'Why'], ['raw', 'Raw JSON']];

function renderDrawer(errorText) {
  const box = S.els.drawer;
  const key = focusKey();
  clear(box);
  if (errorText) box.appendChild(h('p', { class: 'rp-err', role: 'alert', text: errorText }));
  const item = S.model.narration[S.cursor];
  if (!item && !S.nodeSel) return;
  const tablist = h('div', { class: 'rp-tabs', role: 'tablist', 'aria-label': 'Details', onkeydown: onTabKey });
  for (const [id, label] of TABS) {
    tablist.appendChild(h('button', {
      type: 'button', role: 'tab', class: 'rp-tab', id: `rp-tab-${id}`, 'aria-controls': 'rp-tabpanel', 'data-key': `tab:${id}`,
      'aria-selected': S.tab === id ? 'true' : 'false', tabindex: S.tab === id ? '0' : '-1',
      onclick: () => { S.tab = id; renderDrawer(); focusTab(id); },
    }, label));
  }
  box.appendChild(tablist);
  const panel = h('div', { id: 'rp-tabpanel', role: 'tabpanel', 'aria-labelledby': `rp-tab-${S.tab}`, tabindex: '0' });
  const ctx = S.nodeSel ? nodeContext(S.nodeSel) : itemContext(item);
  if (S.tab === 'what') panel.append(...ctx.what());
  else if (S.tab === 'why') panel.append(...ctx.why());
  else panel.appendChild(h('pre', { tabindex: '0', 'aria-label': 'Raw event JSON', text: prettyJson(ctx.raw.length === 1 ? ctx.raw[0] : ctx.raw) }));
  box.appendChild(panel);
  restoreFocus(key);
}

function focusTab(id) {
  const tab = S.els.drawer.querySelector(`#rp-tab-${id}`);
  if (tab) tab.focus();
}

function onTabKey(e) {
  const ids = TABS.map((t) => t[0]);
  let i = ids.indexOf(S.tab);
  if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
  else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = ids.length - 1;
  else return;
  e.preventDefault();
  e.stopPropagation();
  S.tab = ids[i];
  renderDrawer();
  focusTab(S.tab);
}

function eventsOf(ids) {
  const m = S.model;
  return ids.map((id) => m.events[m.eventIndex.get(id)]).filter(Boolean);
}

function facts(rows) {
  const dl = h('dl', { class: 'rp-facts' });
  for (const [k, v] of rows) {
    if (v == null || v === '') continue;
    dl.append(h('dt', { text: k }), h('dd', { text: String(v) }));
  }
  return dl;
}

function outputOf(events) {
  for (const ev of [...events].reverse()) {
    const d = ev.data || {};
    const out = d.result ?? d.response_content ?? d.output_preview;
    if (out != null && out !== '') return typeof out === 'string' ? out : prettyJson(out);
  }
  return null;
}

function itemContext(item) {
  const m = S.model;
  const block = item.blockId ? m.blocks.find((b) => b.id === item.blockId) : null;
  const chapter = item.chapterId ? m.chapters.find((c) => c.id === item.chapterId) : null;
  const ev = m.events[m.eventIndex.get(item.id)];
  const relatedIds = block ? block.eventIds : (chapter ? chapter.eventIds : [item.id]);
  const raw = eventsOf(block && block.count > 1 ? block.eventIds : (block ? block.eventIds : relatedIds));
  return {
    raw: raw.length ? raw : [ev],
    what: () => whatHappened(item, ev, block, chapter, raw),
    why: () => whyPanel(item, ev, block, chapter),
  };
}

function whatHappened(item, ev, block, chapter, raw) {
  const out = [h('h3', { text: item.text })];
  const d = (ev && ev.data) || {};
  out.push(facts([
    ['When', `${offset(item.t)} from the start`],
    ['Who', item.agent || (item.type.startsWith('approval') ? 'You' : 'The run')],
    ['Event', `${item.type} #${ev ? ev.sequence_num : '?'}`],
    ['Duration', block ? C().formatDuration(block.durationMs) : (chapter ? C().formatDuration((chapter.end - chapter.start) * 1000) : C().formatDuration(d.duration_ms))],
    ['Cost', block ? C().formatCost(block.cost) : C().formatCost(ev && ev.cost_usd)],
    ['Tokens', block && block.tokens ? block.tokens : null],
    ['Status', block ? block.status : (chapter ? chapter.status : d.status)],
    ['Node', ev && ev.node_id],
    ['Branch', ev && ev.branch_id],
    ['Part of', chapter ? `${chapter.kind} ${chapter.label}` : null],
  ]));
  if (block && block.count > 1) {
    out.push(h('p', { class: 'rp-note', text: `Repeated ${block.count} times in a row; shown as one block.` }));
    const table = h('table', { class: 'rp-passes' }, h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Pass' }), h('th', { scope: 'col', text: 'Start' }), h('th', { scope: 'col', text: 'Duration' }), h('th', { scope: 'col', text: 'Cost' }))));
    const tb = h('tbody');
    block.members.forEach((mb, i) => tb.appendChild(h('tr', null, h('td', { text: String(i + 1) }), h('td', { text: offset(mb.start) }), h('td', { text: C().formatDuration(mb.durationMs) }), h('td', { text: C().formatCost(mb.cost) || '—' }))));
    table.appendChild(tb);
    out.push(table);
  }
  if (chapter && chapter.count > 1) out.push(h('p', { class: 'rp-note', text: `${chapter.label} ran ${chapter.count} times in a row (loop).` }));
  if (block && block.kind === 'approval' && block.status === 'pending') {
    out.push(h('p', { class: 'rp-note', text: S.solo ? 'This request was still waiting when the run was exported.' : 'Waiting for your decision: use the "Waiting for you" panel above the timeline.' }));
  }
  const output = outputOf(raw);
  if (output) out.push(h('h4', { text: 'Output' }), h('pre', { tabindex: '0', text: C().truncate(output, 4000) }));
  return out;
}

function evidenceItem(label, value, ev) {
  const li = h('li', null, h('strong', { text: label }), ' ', h('span', { class: 'rp-src', text: ev ? `(recorded in event #${ev.sequence_num}, ${ev.event_type})` : '' }));
  if (value != null && value !== '') li.appendChild(typeof value === 'string' ? h('pre', { tabindex: '0', text: value }) : h('pre', { tabindex: '0', text: prettyJson(value) }));
  return li;
}

function findDecision(approvalId) {
  return S.model.events.find((e) => e.event_type === 'approval_decided' && e.data && e.data.approval_id === approvalId) || null;
}

function findRequest(approvalId) {
  return S.model.events.find((e) => e.event_type === 'approval_requested' && e.data && e.data.approval_id === approvalId) || null;
}

function whyPanel(item, ev, block, chapter) {
  const list = h('ul', { class: 'rp-evidence' });
  const add = (label, value, src) => list.appendChild(evidenceItem(label, value, src));
  const m = S.model;
  const evs = block ? eventsOf(block.eventIds) : [ev];
  const d = (ev && ev.data) || {};
  const type = item.type;
  if (type.startsWith('tool_call')) {
    for (const e of evs.filter((x) => x.event_type === 'tool_call_start')) add(`Input passed to ${e.data.tool_name}`, e.data.tool_args, e);
  } else if (type.startsWith('llm')) {
    const req = evs.find((x) => x.event_type === 'llm_request');
    if (req) {
      add('Context sent', `${req.messages_count || 0} messages, ${req.tokens_used || 0} of ${req.tokens_budget || '?'} tokens`, req);
      const msgs = req.data && req.data.messages;
      if (Array.isArray(msgs) && msgs.length) add('Last message sent', msgs[msgs.length - 1], req);
      if (req.data && req.data.model) add('Model', req.data.model, req);
    }
    const resp = evs.find((x) => x.event_type === 'llm_response');
    if (resp && resp.data && resp.data.finish_reason) add('Why it stopped', resp.data.finish_reason, resp);
  } else if (type === 'agent_handoff') {
    if (d.reason) add('Hand-off reason', d.reason, ev);
    const cp = d.context_passed;
    if (cp && Object.keys(cp).length) {
      const manager = d.kind === 'delegate' || d.from_agent === 'Manager';
      if (manager && cp.task_snapshot) add("Manager's task snapshot", cp.task_snapshot, ev);
      add(manager ? 'Context the manager passed' : 'Context passed', cp, ev);
    }
  } else if (type === 'task_start' || type === 'task_end') {
    const start = eventsOf(chapter ? chapter.eventIds : [item.id]).find((x) => x.event_type === 'task_start') || ev;
    if (start.data && start.data.description_preview) add('Task description', start.data.description_preview, start);
    const agent = start.data && (start.data.agent || start.agent_name);
    const idx = m.eventIndex.get(C().eventId(start));
    const delegation = [...m.events.slice(0, idx ?? m.events.length)].reverse().find((x) => x.event_type === 'agent_handoff' && x.data && x.data.to_agent === agent && (x.data.kind === 'delegate' || x.data.from_agent === 'Manager'));
    if (delegation) add("Manager's task snapshot", delegation.data.context_passed?.task_snapshot || delegation.data.context_passed || delegation.data.reason, delegation);
    if (type === 'task_end' && d.retries) add('Retries', String(d.retries), ev);
  } else if (type === 'step_start' || type === 'step_end') {
    const end = eventsOf(chapter ? chapter.eventIds : [item.id]).filter((x) => x.event_type === 'step_end').pop();
    if (end && end.data && end.data.route) add('Route chosen', end.data.route, end);
    const start = eventsOf(chapter ? chapter.eventIds : [item.id]).find((x) => x.event_type === 'step_start');
    if (start && start.data && start.data.pattern) add('Pattern', start.data.pattern, start);
  } else if (type.startsWith('approval')) {
    const id = d.approval_id;
    const req = findRequest(id);
    const dec = findDecision(id);
    if (req) add(`Arguments ${req.data.kind === 'task_output_review' ? 'under review' : 'requested'} (redacted)`, req.data.args, req);
    if (req && req.data.risk) add('Risk', req.data.risk, req);
    if (dec) {
      const dd = dec.data;
      add('Decision', `${dd.approved ? 'Approved' : 'Denied'}${dd.modified ? ' with edited arguments' : ''}${dd.reason ? ` — ${dd.reason}` : ''}`, dec);
      const approver = String(dd.approver || '');
      if (approver && !['user', 'human', 'you', 'ui', 'replay', 'console', 'web', 'dashboard'].includes(approver.toLowerCase())) add('Auto-approval source', approver, dec);
      else if (approver) add('Decided by', approver, dec);
    } else {
      add('Decision', 'None recorded yet', null);
    }
  } else if (type === 'message_added') {
    add('Message', d.content, ev);
  }
  if (!list.childNodes.length) {
    return [h('p', { class: 'rp-note', text: 'Nothing in the recording explains this step. Only recorded evidence is shown here.' })];
  }
  return [h('p', { class: 'rp-note', text: 'Evidence recorded with the run (no guesses):' }), list];
}

function nodeContext(nodeId) {
  const m = S.model;
  const graph = mapGraph();
  const node = (graph.nodes || []).find((n) => n.id === nodeId) || { id: nodeId };
  const items = m.narration.map((n, i) => [n, i]).filter(([n]) => {
    const ev = m.events[m.eventIndex.get(n.id)];
    return C().nodeIdsForEvent(ev).includes(nodeId);
  });
  return {
    raw: [node],
    what: () => {
      const out = [h('h3', { text: `${KIND_WORD[node.kind] || node.kind || 'node'}: ${node.label || nodeId}` }), facts([['Id', nodeId], ['Kind', node.kind], ['Events here', items.length]])];
      if (items.length) {
        const ol = h('ol', { class: 'rp-evidence' });
        for (const [n, i] of items.slice(0, 50)) ol.appendChild(h('li', null, h('button', { type: 'button', class: 'rp-btn', onclick: () => setCursor(i, 'narration') }, `${offset(n.t)} ${n.text}`)));
        out.push(ol);
      } else out.push(h('p', { class: 'rp-note', text: 'This node was not reached in this run.' }));
      return out;
    },
    why: () => {
      const edges = (graph.edges || []).filter((e) => e.source === nodeId || e.target === nodeId);
      if (!edges.length) return [h('p', { class: 'rp-note', text: 'No recorded connections.' })];
      const ul = h('ul', { class: 'rp-evidence' });
      for (const e of edges) ul.appendChild(h('li', { text: `${e.source} ${C().edgeText(e)} ${e.target}` }));
      return [h('p', { class: 'rp-note', text: graph.derived ? 'Derived from the events (no graph was recorded):' : 'From the graph recorded at the start of the run:' }), ul];
    },
  };
}

// ── "You" lane: pending approvals ─────────────────────────────────────

function renderPending() {
  const box = S.els.pending;
  const pending = S.model.pending;
  // Rebuild only when something visible changed, so a live update never
  // resets the caret of someone typing arguments or a reason.
  const sig = `${S.solo}|${Boolean(S.run?.live)}|${pending.map((b) => {
    const st = S.asks.get(b.approvalId) || {};
    return `${b.approvalId}:${Boolean(st.editing)}:${st.sent || ''}:${Boolean(st.loaded)}`;
  }).join(',')}`;
  if (sig === S.pendingSig && box.childNodes.length === pending.length) return;
  S.pendingSig = sig;
  const key = focusKey();
  clear(box);
  box.hidden = !pending.length;
  if (!pending.length) return;
  for (const b of pending) {
    const req = findRequest(b.approvalId);
    const d = (req && req.data) || {};
    const st = S.asks.get(b.approvalId) || { editing: false, text: '', error: '', sent: '', reason: '', loaded: false };
    S.asks.set(b.approvalId, st);
    const hid = `rp-ask-${cssId(b.approvalId)}`;
    const card = h('article', { class: 'rp-ask', 'aria-labelledby': hid });
    card.appendChild(h('h3', { id: hid },
      h('i', { class: 'rp-g rp-g-human', 'aria-hidden': 'true' }),
      `${req ? req.agent_name || 'An agent' : 'An agent'} asks to ${d.kind === 'task_output_review' ? 'deliver the output of' : 'run'} ${b.label}`,
      d.risk ? h('span', { class: 'rp-badge', text: `${d.risk} risk` }) : null));
    card.appendChild(h('pre', { tabindex: '0', 'aria-label': 'Recorded arguments (redacted)', text: prettyJson(d.args || {}) }));
    if (S.solo) {
      card.appendChild(h('p', { class: 'rp-note', text: 'This export cannot answer. Open the run with praisonai replay view to approve or deny.' }));
      box.appendChild(card);
      continue;
    }
    if (st.sent) {
      card.appendChild(h('p', { class: 'rp-note', role: 'status', text: st.sent }));
      box.appendChild(card);
      continue;
    }
    const reasonId = `${hid}-reason`;
    card.append(h('label', { for: reasonId, text: 'Reason (optional)' }),
      h('input', { id: reasonId, type: 'text', value: st.reason, 'data-key': `${hid}-reason`, oninput: (e) => { st.reason = e.target.value; } }));
    if (st.editing) {
      const taId = `${hid}-args`;
      const errId = `${hid}-err`;
      const hintId = `${hid}-hint`;
      card.append(
        h('label', { for: taId, text: 'Arguments to run with (JSON object)' }),
        h('textarea', {
          id: taId, rows: 6, 'data-key': `${hid}-args`, 'aria-describedby': `${hintId} ${errId}`, 'aria-invalid': st.error ? 'true' : 'false',
          oninput: (e) => { st.text = e.target.value; st.error = validateArgs(st.text).error; const err = document.getElementById(errId); if (err) err.textContent = st.error; e.target.setAttribute('aria-invalid', st.error ? 'true' : 'false'); },
        }, st.text),
        h('p', { id: hintId, class: 'rp-note', text: st.loaded ? 'Started from the arguments this server holds for the request.' : 'Started from the recorded arguments, which are redacted: check every value before approving.' }),
        h('p', { id: errId, class: 'rp-err', 'aria-live': 'polite', text: st.error }),
      );
    }
    const actions = h('div', { class: 'rp-ask-actions' });
    if (st.editing) {
      actions.append(
        h('button', { type: 'button', class: 'rp-btn rp-btn-primary', 'data-key': `${hid}-approve-edit`, onclick: () => decide(b, 'approve', true) }, 'Approve with these arguments'),
        h('button', { type: 'button', class: 'rp-btn', 'data-key': `${hid}-cancel`, onclick: () => { st.editing = false; st.error = ''; renderPending(); } }, 'Cancel editing'),
      );
    } else {
      actions.append(
        h('button', { type: 'button', class: 'rp-btn rp-btn-primary', 'data-key': `${hid}-approve`, onclick: () => decide(b, 'approve', false) }, 'Approve'),
        h('button', { type: 'button', class: 'rp-btn', 'data-key': `${hid}-edit`, onclick: () => startEdit(b, d) }, 'Edit arguments…'),
      );
    }
    actions.append(h('button', { type: 'button', class: 'rp-btn', 'data-key': `${hid}-deny`, onclick: () => decide(b, 'deny', false) }, 'Deny'));
    if (!S.run?.live) actions.append(h('span', { class: 'rp-note', text: 'This run is not live; the request may have expired.' }));
    card.appendChild(actions);
    box.appendChild(card);
  }
  restoreFocus(key);
}

function cssId(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

export function validateArgs(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${e.message}` };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Arguments must be a JSON object, like {"path": "notes.md"}.' };
  return { value, error: '' };
}

async function startEdit(b, recorded) {
  const st = S.asks.get(b.approvalId);
  st.editing = true;
  st.text = prettyJson(recorded.args || {});
  st.loaded = false;
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(b.approvalId)}`, { signal: S.abort.signal });
    if (res.ok) {
      const entry = await res.json();
      if (entry && entry.arguments && typeof entry.arguments === 'object') {
        st.text = prettyJson(entry.arguments);
        st.loaded = true;
      }
    }
  } catch { /* keep recorded */ }
  if (!S) return;
  renderPending();
  const ta = S.els.pending.querySelector(`#rp-ask-${cssId(b.approvalId)}-args`);
  if (ta) ta.focus();
}

async function decide(b, action, withArgs) {
  const st = S.asks.get(b.approvalId);
  const body = { reason: st.reason || '', approver: 'user' };
  if (withArgs) {
    const { value, error } = validateArgs(st.text);
    st.error = error;
    if (error) {
      const base = `rp-ask-${cssId(b.approvalId)}`;
      const ta = document.getElementById(`${base}-args`);
      const err = document.getElementById(`${base}-err`);
      if (err) err.textContent = error;
      if (ta) { ta.setAttribute('aria-invalid', 'true'); ta.focus(); }
      return;
    }
    body.modified_args = value;
  }
  let msg;
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(b.approvalId)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: S.abort.signal,
    });
    if (res.ok) msg = `${action === 'approve' ? 'Approved' : 'Denied'}. Waiting for the run to continue…`;
    else if (res.status === 404) msg = 'This server does not hold that request (it may have expired, or the run uses a different approval backend).';
    else if (res.status === 401 || res.status === 403) msg = 'You are not allowed to decide approvals on this server.';
    else msg = `The server refused the decision (HTTP ${res.status}).`;
  } catch (e) {
    if (e.name === 'AbortError') return;
    msg = `Could not reach the server: ${e.message}`;
  }
  if (!S) return;
  st.sent = msg;
  announce(msg);
  renderPending();
}

// ── standalone boot ───────────────────────────────────────────────────

function bootStandalone() {
  if (globalThis.__REPLAY_BOOTED__) return;
  globalThis.__REPLAY_BOOTED__ = true;
  const data = globalThis.__REPLAY_DATA__ || {};
  let mount = document.getElementById('replay-root');
  if (!mount) {
    mount = document.createElement('main');
    mount.id = 'replay-root';
    document.body.appendChild(mount);
  }
  mount.style.padding = '12px';
  render(mount, { standalone: true, events: data.events || [], graph: data.graph || null, title: data.title || document.title });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && globalThis.__REPLAY_DATA__ && !(window.aiui && window.aiui.selectPage)) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootStandalone);
  else bootStandalone();
}
