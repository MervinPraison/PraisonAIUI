/**
 * Dashboard Plugin — reads /api/pages, builds sidebar + page containers.
 *
 * Protocol-driven: all data comes from API endpoints.
 * Extensible: register custom views via window.aiui.registerView(pageId, renderFn)
 * Feature views auto-bind to [data-page="xxx"] containers.
 */

// Record load time for overview stats
window.__aiuiLoadTime = window.__aiuiLoadTime || Date.now();

// ── Extensible View Registry ─────────────────────────────────────────
// Maps page IDs to view modules. Each module exports render(container).
// Built-in views are loaded via dynamic import from ./views/
const VIEW_REGISTRY = {};
let _activeCleanup = null; // cleanup function for the active view

// Built-in page-to-module mapping (protocol-first: page IDs come from /api/pages)
// Paths are relative to /plugins/ where dashboard.js is served from
const BUILTIN_VIEWS = {
  chat:           '/plugins/views/chat.js',
  overview:       '/plugins/views/overview.js',
  agents:         '/plugins/views/agents.js',
  sessions:       '/plugins/views/sessions.js',
  memory:         '/plugins/views/memory.js',
  knowledge:      '/plugins/views/knowledge.js',
  logs:           '/plugins/views/logs.js',
  schedules:      '/plugins/views/schedules.js',
  cron:           '/plugins/views/schedules.js',
  config:         '/plugins/views/config.js',
  config_runtime: '/plugins/views/config.js',
  approvals:      '/plugins/views/approvals.js',
  usage:          '/plugins/views/usage.js',
  channels:       '/plugins/views/channels.js',
  skills:         '/plugins/views/skills.js',
  tools:          '/plugins/views/skills.js',
  nodes:          '/plugins/views/nodes.js',
  instances:      '/plugins/views/nodes.js',
  explorer:       '/plugins/views/explorer.js',
  debug:          '/plugins/views/debug.js',
  guardrails:     '/plugins/views/guardrails.js',
  eval:           '/plugins/views/eval.js',
  telemetry:      '/plugins/views/telemetry.js',
  traces:         '/plugins/views/traces.js',
  security:       '/plugins/views/security.js',
  'theme-picker': '/plugins/views/theme-picker.js',
};

// Public API for extending the dashboard (protocol-first, extendable)
window.aiui = window.aiui || {};
window.aiui.registerView = function(pageId, renderFn, cleanupFn) {
  VIEW_REGISTRY[pageId] = { render: renderFn, cleanup: cleanupFn || null };
};
window.aiui.views = VIEW_REGISTRY;

const DASHBOARD_STYLE = `
  /* ── Dashboard layout ───────────────────────────────────── */
  :root {
    --db-sidebar-w: 260px;
    --db-bg: #0a0a0f;
    --db-sidebar-bg: #111118;
    --db-border: rgba(255,255,255,0.06);
    --db-text: #e4e4e7;
    --db-text-dim: #71717a;
    --db-accent: #6366f1;
    --db-accent-glow: rgba(99,102,241,0.15);
    --db-card-bg: rgba(255,255,255,0.03);
    --db-hover: rgba(255,255,255,0.05);
    --db-radius: 10px;
    --db-transition: 0.2s cubic-bezier(0.4,0,0.2,1);
  }

  body { margin: 0; background: var(--db-bg); color: var(--db-text); font-family: system-ui, -apple-system, sans-serif; }

  /* Root becomes the flex container */
  #root { display: flex; min-height: 100vh; }

  /* Sidebar */
  .db-sidebar {
    width: var(--db-sidebar-w); min-width: var(--db-sidebar-w);
    background: var(--db-sidebar-bg); border-right: 1px solid var(--db-border);
    display: flex; flex-direction: column; overflow-y: auto;
    position: sticky; top: 0; height: 100vh;
  }
  .db-sidebar-header {
    padding: 20px; font-size: 15px; font-weight: 600;
    letter-spacing: -0.01em; border-bottom: 1px solid var(--db-border);
    display: flex; align-items: center; gap: 10px;
  }
  .db-sidebar-header .logo { font-size: 20px; }
  .db-group-label {
    padding: 18px 20px 6px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--db-text-dim);
  }
  .db-nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 20px; cursor: pointer; font-size: 13.5px;
    color: var(--db-text-dim); transition: all var(--db-transition);
    border-left: 3px solid transparent;
    text-decoration: none;
  }
  .db-nav-item:hover { background: var(--db-hover); color: var(--db-text); }
  .db-nav-item.active {
    color: var(--db-accent); background: var(--db-accent-glow);
    border-left-color: var(--db-accent); font-weight: 500;
  }
  .db-nav-icon { font-size: 16px; width: 22px; text-align: center; }

  /* Main content area */
  .db-main { flex: 1; padding: 32px 40px; overflow-y: auto; min-width: 0; }
  .db-main.db-clean { padding: 0; display: flex; flex-direction: column; overflow: hidden; height: 100vh; }
  .db-main.db-clean > #db-page-content { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .db-page-header { margin-bottom: 28px; }
  .db-page-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .db-page-desc { color: var(--db-text-dim); font-size: 14px; margin: 0; }

  /* Generic data viewer */
  .db-viewer { background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: var(--db-radius); padding: 20px; }
  .db-viewer pre { margin: 0; font-size: 13px; line-height: 1.6; color: var(--db-text-dim); white-space: pre-wrap; word-break: break-word; }

  /* Component layout helpers */
  .db-columns { display: grid; gap: 16px; }
  .db-card {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 20px;
    transition: border-color var(--db-transition);
  }
  .db-card:hover { border-color: rgba(255,255,255,0.12); }
  .db-card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--db-text-dim); margin: 0 0 8px; }
  .db-card-value { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0; }
  .db-card-footer { font-size: 12px; color: var(--db-text-dim); margin-top: 8px; }

  /* Test panel */
  .db-test-panel { margin-top: 32px; }
  .db-test-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .db-test-card {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 14px 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .db-test-name { font-size: 13px; font-weight: 500; }
  .db-test-status { font-size: 12px; padding: 3px 10px; border-radius: 20px; }
  .db-test-pass { background: rgba(34,197,94,0.15); color: #22c55e; }
  .db-test-fail { background: rgba(239,68,68,0.15); color: #ef4444; }
  .db-test-pending { background: rgba(234,179,8,0.15); color: #eab308; }

  /* Loading spinner */
  .db-loading { text-align: center; padding: 60px; color: var(--db-text-dim); }
  @keyframes db-spin { to { transform: rotate(360deg); } }
  .db-spinner { display: inline-block; width: 24px; height: 24px; border: 2px solid var(--db-border); border-top-color: var(--db-accent); border-radius: 50%; animation: db-spin 0.8s linear infinite; }

  /* Hide React docs layout when dashboard is active */
  .db-active .sidebar:not(.db-sidebar), .db-active .topnav, .db-active .toc-sidebar,
  .db-active > .main-content, .db-active > nav:not(.db-sidebar) { display: none !important; }

  /* ── Metric ───────────────────────────────────────────────── */
  .db-metric {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 20px;
    transition: border-color var(--db-transition);
  }
  .db-metric:hover { border-color: rgba(255,255,255,0.12); }
  .db-metric .db-metric-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--db-text-dim); margin: 0 0 8px; }
  .db-metric .db-metric-value { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
  .db-metric .db-metric-delta { font-size: 13px; font-weight: 500; }
  .db-metric .db-metric-delta.positive { color: #22c55e; }
  .db-metric .db-metric-delta.negative { color: #ef4444; }
  .db-metric .db-metric-delta.neutral { color: var(--db-text-dim); }

  /* ── Progress Bar ─────────────────────────────────────────── */
  .db-progress { margin-bottom: 16px; }
  .db-progress .db-progress-label { font-size: 13px; color: var(--db-text); margin-bottom: 6px; display: flex; justify-content: space-between; }
  .db-progress .db-progress-track { width: 100%; height: 8px; background: var(--db-border); border-radius: 4px; overflow: hidden; }
  .db-progress .db-progress-bar { height: 100%; background: var(--db-accent); border-radius: 4px; transition: width var(--db-transition); }

  /* ── Alert ─────────────────────────────────────────────────── */
  .db-alert { padding: 14px 18px; border-radius: var(--db-radius); margin-bottom: 16px; display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.5; }
  .db-alert-info { background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.25); color: #60a5fa; }
  .db-alert-success { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.25); color: #22c55e; }
  .db-alert-warning { background: rgba(234,179,8,0.12); border: 1px solid rgba(234,179,8,0.25); color: #eab308; }
  .db-alert-error { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); color: #ef4444; }

  /* ── Badge ──────────────────────────────────────────────────── */
  .db-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; background: rgba(99,102,241,0.15); color: var(--db-accent); }
  .db-badge-secondary { background: rgba(113,113,122,0.2); color: var(--db-text-dim); }
  .db-badge-destructive { background: rgba(239,68,68,0.15); color: #ef4444; }
  .db-badge-outline { background: transparent; border: 1px solid var(--db-border); color: var(--db-text); }

  /* ── Separator ──────────────────────────────────────────────── */
  .db-separator { border: none; border-top: 1px solid var(--db-border); margin: 16px 0; }

  /* ── Tabs ────────────────────────────────────────────────────── */
  .db-tabs { margin-bottom: 16px; }
  .db-tab-list { display: flex; gap: 0; border-bottom: 1px solid var(--db-border); margin-bottom: 16px; }
  .db-tab-btn {
    padding: 10px 18px; font-size: 13px; font-weight: 500; cursor: pointer;
    color: var(--db-text-dim); background: transparent; border: none;
    border-bottom: 2px solid transparent; transition: all var(--db-transition);
  }
  .db-tab-btn:hover { color: var(--db-text); }
  .db-tab-btn.active { color: var(--db-accent); border-bottom-color: var(--db-accent); }
  .db-tab-panel { display: none; }
  .db-tab-panel.active { display: block; }

  /* ── Accordion ──────────────────────────────────────────────── */
  .db-accordion { margin-bottom: 16px; }
  .db-accordion-item { border: 1px solid var(--db-border); border-radius: var(--db-radius); margin-bottom: 8px; overflow: hidden; }
  .db-accordion-trigger {
    width: 100%; padding: 14px 18px; font-size: 14px; font-weight: 500;
    background: var(--db-card-bg); color: var(--db-text); border: none;
    cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center;
    transition: background var(--db-transition);
  }
  .db-accordion-trigger:hover { background: var(--db-hover); }
  .db-accordion-trigger::after { content: '▸'; transition: transform var(--db-transition); }
  .db-accordion-trigger.open::after { transform: rotate(90deg); }
  .db-accordion-content { padding: 0 18px; max-height: 0; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease; }
  .db-accordion-content.open { padding: 14px 18px; max-height: 500px; }

  /* ── Image Display ──────────────────────────────────────────── */
  .db-image { margin-bottom: 16px; }
  .db-image img { max-width: 100%; border-radius: var(--db-radius); display: block; }
  .db-image figcaption { font-size: 12px; color: var(--db-text-dim); margin-top: 8px; text-align: center; }

  /* ── Code Block ──────────────────────────────────────────────── */
  .db-code-block {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 16px; margin-bottom: 16px; overflow-x: auto;
  }
  .db-code-block code { font-size: 13px; line-height: 1.6; color: var(--db-text); font-family: 'SF Mono', Monaco, Consolas, monospace; white-space: pre; }

  /* ── JSON View ──────────────────────────────────────────────── */
  .db-json-view {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 16px; margin-bottom: 16px; overflow-x: auto;
  }
  .db-json-view pre { margin: 0; font-size: 12px; line-height: 1.6; color: var(--db-text-dim); white-space: pre-wrap; word-break: break-word; font-family: 'SF Mono', Monaco, Consolas, monospace; }

  /* ── Form inputs ────────────────────────────────────────────── */
  .db-form-group { margin-bottom: 16px; }
  .db-form-label { display: block; font-size: 13px; font-weight: 500; color: var(--db-text); margin-bottom: 6px; }
  .db-form-input {
    width: 100%; padding: 8px 12px; font-size: 13px; color: var(--db-text);
    background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: 6px;
    outline: none; transition: border-color var(--db-transition); box-sizing: border-box;
  }
  .db-form-input:focus { border-color: var(--db-accent); }
  .db-form-select {
    width: 100%; padding: 8px 12px; font-size: 13px; color: var(--db-text);
    background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: 6px;
    outline: none; transition: border-color var(--db-transition); box-sizing: border-box;
    appearance: none; cursor: pointer;
  }
  .db-form-select:focus { border-color: var(--db-accent); }
  .db-form-textarea {
    width: 100%; padding: 8px 12px; font-size: 13px; color: var(--db-text);
    background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: 6px;
    outline: none; transition: border-color var(--db-transition); resize: vertical;
    font-family: inherit; box-sizing: border-box;
  }
  .db-form-textarea:focus { border-color: var(--db-accent); }
  .db-form-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .db-form-checkbox input { width: 16px; height: 16px; accent-color: var(--db-accent); cursor: pointer; }
  .db-form-switch { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .db-form-switch .db-switch-track {
    width: 40px; height: 22px; background: var(--db-border); border-radius: 11px;
    position: relative; transition: background var(--db-transition); cursor: pointer;
  }
  .db-form-switch .db-switch-track.on { background: var(--db-accent); }
  .db-form-switch .db-switch-thumb {
    width: 18px; height: 18px; background: #fff; border-radius: 50%;
    position: absolute; top: 2px; left: 2px; transition: transform var(--db-transition);
  }
  .db-form-switch .db-switch-track.on .db-switch-thumb { transform: translateX(18px); }
  .db-form-radio fieldset { border: none; padding: 0; margin: 0; }
  .db-form-radio label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--db-text); margin-bottom: 6px; cursor: pointer; }
  .db-form-radio input { accent-color: var(--db-accent); cursor: pointer; }

  /* ── Container ──────────────────────────────────────────────── */
  .db-container {
    background: var(--db-card-bg); border: 1px solid var(--db-border);
    border-radius: var(--db-radius); padding: 20px; margin-bottom: 16px;
  }
  .db-container > h3 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }

  /* ── Expander ───────────────────────────────────────────────── */
  .db-expander { border: 1px solid var(--db-border); border-radius: var(--db-radius); margin-bottom: 16px; overflow: hidden; }
  .db-expander-header {
    padding: 14px 18px; cursor: pointer; font-size: 14px; font-weight: 500;
    background: var(--db-card-bg); display: flex; justify-content: space-between; align-items: center;
    transition: background var(--db-transition);
  }
  .db-expander-header:hover { background: var(--db-hover); }
  .db-expander-header::after { content: '▸'; transition: transform var(--db-transition); }
  .db-expander-header.open::after { transform: rotate(90deg); }
  .db-expander-content { display: none; padding: 16px 18px; }
  .db-expander-content.open { display: block; }

  /* ── Divider ────────────────────────────────────────────────── */
  .db-divider { display: flex; align-items: center; gap: 12px; margin: 16px 0; }
  .db-divider::before, .db-divider::after { content: ''; flex: 1; height: 1px; background: var(--db-border); }
  .db-divider:empty::after { display: none; }
  .db-divider:empty { height: 1px; background: var(--db-border); }
  .db-divider-text { font-size: 12px; color: var(--db-text-dim); white-space: nowrap; }

  /* ── Link ───────────────────────────────────────────────────── */
  .db-link { color: var(--db-accent); text-decoration: none; font-size: 14px; transition: opacity var(--db-transition); }
  .db-link:hover { opacity: 0.8; text-decoration: underline; }

  /* ── Button Group ───────────────────────────────────────────── */
  .db-button-group { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .db-btn {
    padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px;
    cursor: pointer; border: 1px solid var(--db-border); transition: all var(--db-transition);
    background: var(--db-card-bg); color: var(--db-text);
  }
  .db-btn:hover { background: var(--db-hover); }
  .db-btn-primary { background: var(--db-accent); border-color: var(--db-accent); color: #fff; }
  .db-btn-primary:hover { opacity: 0.9; }
  .db-btn-destructive { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); color: #ef4444; }
  .db-btn-destructive:hover { background: rgba(239,68,68,0.25); }

  /* ── Stat Group ─────────────────────────────────────────────── */
  .db-stat-group { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }

  /* ── Header ─────────────────────────────────────────────────── */
  .db-header { margin: 0 0 12px; font-weight: 700; letter-spacing: -0.02em; color: var(--db-text); }

  /* ── Markdown ────────────────────────────────────────────────── */
  .db-markdown { font-size: 14px; line-height: 1.7; color: var(--db-text); margin-bottom: 16px; }
  .db-markdown p { margin: 0 0 12px; }
  .db-markdown a { color: var(--db-accent); }

  /* ── Empty State ────────────────────────────────────────────── */
  .db-empty { text-align: center; padding: 40px 20px; color: var(--db-text-dim); font-size: 14px; }

  /* ── Spinner Container ──────────────────────────────────────── */
  .db-spinner-container { display: flex; align-items: center; gap: 12px; padding: 20px; color: var(--db-text-dim); font-size: 13px; }

  /* ── Avatar ─────────────────────────────────────────────────── */
  .db-avatar {
    width: 40px; height: 40px; border-radius: 50%; overflow: hidden;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--db-accent); color: #fff; font-size: 16px; font-weight: 600;
    flex-shrink: 0;
  }
  .db-avatar img { width: 100%; height: 100%; object-fit: cover; }

  /* ── Callout ────────────────────────────────────────────────── */
  .db-callout {
    padding: 16px 20px; border-radius: var(--db-radius); margin-bottom: 16px;
    border-left: 4px solid var(--db-accent); background: var(--db-card-bg);
  }
  .db-callout-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .db-callout-content { font-size: 13px; line-height: 1.6; color: var(--db-text-dim); }
  .db-callout-info { border-left-color: #60a5fa; }
  .db-callout-success { border-left-color: #22c55e; }
  .db-callout-warning { border-left-color: #eab308; }
  .db-callout-error { border-left-color: #ef4444; }

  /* ── Multiselect ─────────────────────────────────────── */
  .db-multiselect { position: relative; }
  .db-multiselect-tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px; background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: 6px; min-height: 38px; }
  .db-multiselect-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(99,102,241,0.15); color: var(--db-accent); border-radius: 4px; font-size: 12px; }

  /* ── Date/Time Input ─────────────────────────────────── */
  .db-date-input input, .db-time-input input { width: 100%; padding: 8px 12px; font-size: 13px; color: var(--db-text); background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: 6px; outline: none; box-sizing: border-box; }
  .db-date-input input:focus, .db-time-input input:focus { border-color: var(--db-accent); }

  /* ── Color Picker ────────────────────────────────────── */
  .db-color-picker { display: flex; align-items: center; gap: 10px; }
  .db-color-picker input[type="color"] { width: 40px; height: 40px; border: 1px solid var(--db-border); border-radius: 6px; padding: 2px; cursor: pointer; background: var(--db-card-bg); }
  .db-color-picker .db-color-value { font-size: 13px; font-family: monospace; color: var(--db-text-dim); }

  /* ── Audio/Video Player ──────────────────────────────── */
  .db-audio-player audio { width: 100%; margin-bottom: 16px; }
  .db-video-player video { width: 100%; border-radius: var(--db-radius); margin-bottom: 16px; }

  /* ── File Download ───────────────────────────────────── */
  .db-file-download { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px; cursor: pointer; border: 1px solid var(--db-border); background: var(--db-card-bg); color: var(--db-text); text-decoration: none; transition: all var(--db-transition); }
  .db-file-download:hover { background: var(--db-hover); }

  /* ── Toast ───────────────────────────────────────────── */
  .db-toast { position: fixed; bottom: 20px; right: 20px; padding: 14px 20px; border-radius: var(--db-radius); font-size: 13px; z-index: 1000; animation: db-toast-in 0.3s ease; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
  @keyframes db-toast-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  .db-toast-info { background: #1e3a5f; color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
  .db-toast-success { background: #14532d; color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
  .db-toast-warning { background: #422006; color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
  .db-toast-error { background: #450a0a; color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

  /* ── Dialog/Modal ────────────────────────────────────── */
  .db-dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 200; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
  .db-dialog-content { background: var(--db-sidebar-bg); border: 1px solid var(--db-border); border-radius: 14px; padding: 24px; width: 500px; max-width: 90vw; max-height: 85vh; overflow-y: auto; }
  .db-dialog-title { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .db-dialog-desc { font-size: 13px; color: var(--db-text-dim); margin: 0 0 16px; }

  /* ── Caption ─────────────────────────────────────────── */
  .db-caption { font-size: 12px; color: var(--db-text-dim); margin-bottom: 8px; }

  /* ── HTML Embed ──────────────────────────────────────── */
  .db-html-embed { margin-bottom: 16px; }

  /* ── Skeleton ────────────────────────────────────────── */
  .db-skeleton { background: linear-gradient(90deg, var(--db-border) 25%, rgba(255,255,255,0.08) 50%, var(--db-border) 75%); background-size: 200% 100%; animation: db-shimmer 1.5s infinite; border-radius: 4px; }
  .db-skeleton-text { height: 16px; width: 100%; }
  .db-skeleton-card { height: 120px; width: 100%; border-radius: var(--db-radius); }
  .db-skeleton-avatar { height: 40px; width: 40px; border-radius: 50%; }
  @keyframes db-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* ── Tooltip ─────────────────────────────────────────── */
  .db-tooltip-wrap { position: relative; display: inline-block; }
  .db-tooltip-content { display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); padding: 6px 10px; background: var(--db-sidebar-bg); border: 1px solid var(--db-border); border-radius: 6px; font-size: 12px; color: var(--db-text); white-space: nowrap; z-index: 100; pointer-events: none; }
  .db-tooltip-wrap:hover .db-tooltip-content { display: block; }

  /* ── Gallery ─────────────────────────────────────────── */
  .db-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .db-gallery-item { position: relative; overflow: hidden; border-radius: var(--db-radius); border: 1px solid var(--db-border); }
  .db-gallery-item img { width: 100%; display: block; aspect-ratio: 1; object-fit: cover; }
  .db-gallery-item figcaption { font-size: 11px; color: var(--db-text-dim); padding: 6px 8px; text-align: center; }

  /* ── Breadcrumb ──────────────────────────────────────── */
  .db-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--db-text-dim); margin-bottom: 16px; }
  .db-breadcrumb a { color: var(--db-accent); text-decoration: none; }
  .db-breadcrumb a:hover { text-decoration: underline; }
  .db-breadcrumb-sep { color: var(--db-text-dim); }

  /* ── Pagination ──────────────────────────────────────── */
  .db-pagination { display: flex; align-items: center; gap: 4px; margin-bottom: 16px; }
  .db-pagination button { padding: 6px 12px; font-size: 13px; border: 1px solid var(--db-border); border-radius: 6px; background: var(--db-card-bg); color: var(--db-text); cursor: pointer; transition: all var(--db-transition); }
  .db-pagination button:hover { background: var(--db-hover); }
  .db-pagination button.active { background: var(--db-accent); border-color: var(--db-accent); color: #fff; }
  .db-pagination button:disabled { opacity: 0.4; cursor: default; }

  /* ── Key-Value List ──────────────────────────────────── */
  .db-kv-list { background: var(--db-card-bg); border: 1px solid var(--db-border); border-radius: var(--db-radius); margin-bottom: 16px; overflow: hidden; }
  .db-kv-list-title { padding: 12px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--db-border); }
  .db-kv-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--db-border); font-size: 13px; }
  .db-kv-item:last-child { border-bottom: none; }
  .db-kv-label { color: var(--db-text-dim); }
  .db-kv-value { font-weight: 500; color: var(--db-text); }

  /* ── Popover ─────────────────────────────────────────── */
  .db-popover { position: relative; display: inline-block; }
  .db-popover-content { display: none; position: absolute; top: calc(100% + 8px); left: 0; min-width: 200px; padding: 16px; background: var(--db-sidebar-bg); border: 1px solid var(--db-border); border-radius: var(--db-radius); z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
  .db-popover.open .db-popover-content { display: block; }
`;

let activePageId = null;
let pagesData = [];

// ── Theme preset → --db-* CSS variable mapping ───────────────────────
// When site.theme.preset is set (via YAML or aiui.set_theme()), we map
// the preset name to appropriate --db-* values so the dashboard adopts
// the chosen palette.
const PRESET_COLORS = {
  zinc:    { accent: '#71717a', accentRgb: '113,113,122' },
  slate:   { accent: '#64748b', accentRgb: '100,116,139' },
  stone:   { accent: '#78716c', accentRgb: '120,113,108' },
  gray:    { accent: '#6b7280', accentRgb: '107,114,128' },
  neutral: { accent: '#737373', accentRgb: '115,115,115' },
  red:     { accent: '#ef4444', accentRgb: '239,68,68' },
  orange:  { accent: '#f97316', accentRgb: '249,115,22' },
  amber:   { accent: '#f59e0b', accentRgb: '245,158,11' },
  yellow:  { accent: '#eab308', accentRgb: '234,179,8' },
  lime:    { accent: '#84cc16', accentRgb: '132,204,22' },
  green:   { accent: '#22c55e', accentRgb: '34,197,94' },
  emerald: { accent: '#10b981', accentRgb: '16,185,129' },
  teal:    { accent: '#14b8a6', accentRgb: '20,184,166' },
  cyan:    { accent: '#06b6d4', accentRgb: '6,182,212' },
  sky:     { accent: '#0ea5e9', accentRgb: '14,165,233' },
  blue:    { accent: '#3b82f6', accentRgb: '59,130,246' },
  indigo:  { accent: '#6366f1', accentRgb: '99,102,241' },
  violet:  { accent: '#8b5cf6', accentRgb: '139,92,246' },
  purple:  { accent: '#a855f7', accentRgb: '168,85,247' },
  fuchsia: { accent: '#d946ef', accentRgb: '217,70,239' },
  pink:    { accent: '#ec4899', accentRgb: '236,72,153' },
  rose:    { accent: '#f43f5e', accentRgb: '244,63,94' },
};

function applyThemeFromConfig(cfg) {
  const theme = cfg?.site?.theme;
  if (!theme) return;

  const root = document.documentElement;
  const preset = theme.preset || 'zinc';
  let colors = PRESET_COLORS[preset];

  // If preset not in hardcoded list, fetch from /api/theme (supports custom themes)
  if (!colors) {
    fetch('/api/theme')
      .then(r => r.json())
      .then(data => {
        // Apply all CSS variables from the theme API
        if (data.variables) {
          for (const [key, val] of Object.entries(data.variables)) {
            root.style.setProperty(key, val);
          }
        }
      })
      .catch(() => {});
  } else {
    root.style.setProperty('--db-accent', colors.accent);
    root.style.setProperty('--db-accent-glow', `rgba(${colors.accentRgb},0.15)`);
    root.style.setProperty('--db-accent-rgb', colors.accentRgb);
  }

  // Dark/light mode
  if (theme.darkMode === false) {
    root.style.setProperty('--db-bg', '#fafafa');
    root.style.setProperty('--db-sidebar-bg', '#f4f4f5');
    root.style.setProperty('--db-text', '#18181b');
    root.style.setProperty('--db-text-dim', '#71717a');
    root.style.setProperty('--db-border', 'rgba(0,0,0,0.08)');
    root.style.setProperty('--db-card-bg', 'rgba(0,0,0,0.02)');
    root.style.setProperty('--db-hover', 'rgba(0,0,0,0.04)');
    document.body.style.background = 'var(--db-bg)';
  }

  // Radius
  const radiusMap = { none: '0', sm: '6px', md: '10px', lg: '14px', xl: '20px' };
  if (theme.radius && radiusMap[theme.radius]) {
    root.style.setProperty('--db-radius', radiusMap[theme.radius]);
  }
}

function init() {
  // Inject styles
  const style = document.createElement('style');
  style.textContent = DASHBOARD_STYLE;
  document.head.appendChild(style);

  // Apply theme from config (async — overrides defaults once loaded)
  fetch('/ui-config.json')
    .then(r => r.json())
    .then(cfg => applyThemeFromConfig(cfg))
    .catch(() => {});

  // Build the dashboard
  buildDashboard();
}

async function buildDashboard() {
  const root = document.getElementById('root');
  if (!root) return;

  // Mark as dashboard active (hides React docs layout)
  root.classList.add('db-active');

  // Show loading
  root.innerHTML = '<div class="db-loading"><div class="db-spinner"></div><p style="margin-top:16px">Loading dashboard…</p></div>';

  // Fetch config and pages in parallel
  let dashboardConfig = {};
  try {
    const [pagesRes, configRes] = await Promise.all([
      fetch('/api/pages'),
      fetch('/ui-config.json'),
    ]);
    const pagesJson = await pagesRes.json();
    pagesData = pagesJson.pages || [];
    const uiConfig = await configRes.json();
    dashboardConfig = uiConfig.dashboard || {};
  } catch (e) {
    root.innerHTML = '<div class="db-loading"><p>Failed to load pages.</p></div>';
    return;
  }

  // Build layout — sidebar is controlled by config protocol
  const showSidebar = dashboardConfig.sidebar !== false;
  const showPageHeader = dashboardConfig.pageHeader !== false;

  const main = document.createElement('div');
  main.className = 'db-main';
  if (!showSidebar && !showPageHeader) {
    main.classList.add('db-clean');
  }
  main.id = 'db-main-content';
  // Store config on main element for page renderers to read
  main.dataset.showPageHeader = showPageHeader ? 'true' : 'false';

  root.innerHTML = '';

  if (showSidebar) {
    const sidebar = buildSidebar(pagesData);
    root.appendChild(sidebar);
  }

  root.appendChild(main);

  // Resolve initial page from URL path or default to first page
  const pathId = location.pathname.replace(/^\//, '') || '';
  const initialPage = pathId && pagesData.find(p => p.id === pathId)
    ? pathId
    : (pagesData.length > 0 ? pagesData[0].id : null);
  if (initialPage) selectPage(initialPage);

  // Listen for browser back/forward
  window.addEventListener('popstate', () => {
    const id = location.pathname.replace(/^\//, '') || '';
    if (id && pagesData.find(p => p.id === id)) {
      selectPage(id);
    }
  });
}

function buildSidebar(pages) {
  const sidebar = document.createElement('nav');
  sidebar.className = 'db-sidebar';

  // Header — branding from /ui-config.json (configurable via app.py or YAML)
  const header = document.createElement('div');
  header.className = 'db-sidebar-header';
  header.innerHTML = 'PraisonAI <span class="logo">🦞</span>';
  sidebar.appendChild(header);
  // Update branding from config asynchronously
  fetch('/ui-config.json').then(r => r.json()).then(cfg => {
    const title = cfg.site?.title || 'PraisonAI';
    const logo = cfg.site?.logo || '🦞';
    header.innerHTML = `${title} <span class="logo">${logo}</span>`;
  }).catch(() => {});

  // Group pages
  const groups = {};
  pages.forEach(p => {
    const g = p.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(p);
  });

  // Render groups
  for (const [groupName, groupPages] of Object.entries(groups)) {
    const label = document.createElement('div');
    label.className = 'db-group-label';
    label.textContent = groupName;
    sidebar.appendChild(label);

    groupPages.forEach(page => {
      const item = document.createElement('div');
      item.className = 'db-nav-item';
      item.dataset.navId = page.id;
      item.innerHTML = `<span class="db-nav-icon">${page.icon || '📄'}</span> ${page.title}`;
      item.addEventListener('click', () => selectPage(page.id));
      sidebar.appendChild(item);
    });
  }

  // Footer pages — render any page with position='footer' at the sidebar bottom
  fetch('/api/pages').then(r => r.json()).then(d => {
    const footerPages = (d.pages || []).filter(p => p.position === 'footer');
    if (!footerPages.length) return;

    const spacer = document.createElement('div');
    spacer.style.cssText = 'flex:1';
    sidebar.appendChild(spacer);

    for (const page of footerPages) {
      const btn = document.createElement('div');
      btn.className = 'db-nav-item';
      btn.innerHTML = `<span class="db-nav-icon">${page.icon || '�'}</span> ${page.title}`;
      btn.addEventListener('click', () => {
        // Use built-in handler if available, otherwise navigate to page
        if (page.id === 'inspector') {
          showTestPanel();
        } else {
          selectPage(page.id);
        }
      });
      btn.style.borderTop = '1px solid var(--db-border)';
      btn.style.marginTop = '8px';
      sidebar.appendChild(btn);
    }
  }).catch(() => {});

  return sidebar;
}

async function selectPage(pageId) {
  // Cleanup previous view if it has a cleanup function
  if (_activeCleanup) { try { _activeCleanup(); } catch(e) {} _activeCleanup = null; }

  activePageId = pageId;

  // Sync URL path (skip if already matching to avoid extra history entries)
  if (location.pathname !== `/${pageId}`) {
    history.pushState({ pageId }, '', `/${pageId}`);
  }

  // Update nav active state
  document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`[data-nav-id="${pageId}"]`);
  if (active) active.classList.add('active');

  const page = pagesData.find(p => p.id === pageId);
  const main = document.getElementById('db-main-content');
  if (!main || !page) return;

  // Set page header (controlled by dashboard config protocol)
  const showPageHeader = main.dataset.showPageHeader !== 'false';
  const headerHtml = showPageHeader ? `
    <div class="db-page-header">
      <h1 class="db-page-title">${page.icon || ''} ${page.title}</h1>
      ${page.description ? `<p class="db-page-desc">${page.description}</p>` : ''}
    </div>
  ` : '';
  main.innerHTML = `
    ${headerHtml}
    <div data-page="${pageId}" id="db-page-content"></div>
  `;

  const container = document.querySelector(`[data-page="${pageId}"]`);
  if (!container) return;

  // ── View Resolution (protocol-first, extensible) ──────────────
  // 1. Check custom registered views first (highest priority)
  // 2. Try dynamic import from built-in view map
  // 3. Fall back to generic JSON viewer
  let rendered = false;

  // Priority 1: Custom registered view
  if (VIEW_REGISTRY[pageId]) {
    try {
      await VIEW_REGISTRY[pageId].render(container);
      _activeCleanup = VIEW_REGISTRY[pageId].cleanup || null;
      rendered = true;
    } catch (e) { console.warn(`View '${pageId}' render error:`, e); }
  }

  // Priority 2: Built-in view module (dynamic import)
  if (!rendered && BUILTIN_VIEWS[pageId]) {
    try {
      const viewUrl = BUILTIN_VIEWS[pageId] + '?v=' + Date.now();
      const mod = await import(viewUrl);
      if (mod.render) {
        await mod.render(container);
        _activeCleanup = mod.cleanup || null;
        rendered = true;
        // Cache for future use
        VIEW_REGISTRY[pageId] = { render: mod.render, cleanup: mod.cleanup || null };
      }
    } catch (e) { console.warn(`Built-in view '${pageId}' import error:`, e); }
  }

  // Priority 3: Generic JSON viewer fallback
  if (!rendered) {
    loadGenericViewer(page, container);
  }

  // Dispatch event so other plugins can react
  window.dispatchEvent(new CustomEvent('aiui:page-change', { detail: { pageId, page } }));
}

async function loadGenericViewer(page, container) {
  const endpoint = page.api_endpoint || `/api/pages/${page.id}/data`;
  try {
    const res = await fetch(endpoint);
    const data = await res.json();
    renderComponents(data, container);
  } catch (e) {
    container.innerHTML = `<div class="db-viewer"><pre>No data available for ${page.title}.</pre></div>`;
  }
}

/**
 * Render component data — supports both raw JSON and structured components.
 * Structured format: { _components: [ { type: "card", ... }, { type: "columns", ... } ] }
 */
function renderComponents(data, container) {
  if (data && data._components) {
    // Structured component rendering
    container.innerHTML = '';
    data._components.forEach(comp => {
      container.appendChild(renderComponent(comp));
    });
  } else {
    // Raw JSON viewer
    container.innerHTML = `<div class="db-viewer"><pre>${JSON.stringify(data, null, 2)}</pre></div>`;
  }
}

function renderComponent(comp) {
  switch (comp.type) {
    case 'card': return renderCard(comp);
    case 'columns': return renderColumns(comp);
    case 'chart': return renderChart(comp);
    case 'table': return renderTable(comp);
    case 'text': return renderText(comp);
    case 'metric': return renderMetric(comp);
    case 'progress_bar': return renderProgressBar(comp);
    case 'alert': return renderAlert(comp);
    case 'badge': return renderBadge(comp);
    case 'separator': return renderSeparator(comp);
    case 'tabs': return renderTabs(comp);
    case 'accordion': return renderAccordion(comp);
    case 'image_display': return renderImageDisplay(comp);
    case 'code_block': return renderCodeBlock(comp);
    case 'json_view': return renderJsonView(comp);
    case 'text_input': return renderTextInput(comp);
    case 'number_input': return renderNumberInput(comp);
    case 'select_input': return renderSelectInput(comp);
    case 'slider_input': return renderSliderInput(comp);
    case 'checkbox_input': return renderCheckboxInput(comp);
    case 'switch_input': return renderSwitchInput(comp);
    case 'radio_input': return renderRadioInput(comp);
    case 'textarea_input': return renderTextareaInput(comp);
    case 'container': return renderContainer(comp);
    case 'expander': return renderExpander(comp);
    case 'divider': return renderDivider(comp);
    case 'link': return renderLink(comp);
    case 'button_group': return renderButtonGroup(comp);
    case 'stat_group': return renderStatGroup(comp);
    case 'header': return renderHeader(comp);
    case 'markdown_text': return renderMarkdownText(comp);
    case 'empty': return renderEmpty(comp);
    case 'spinner': return renderSpinnerComponent(comp);
    case 'avatar': return renderAvatar(comp);
    case 'callout': return renderCallout(comp);
    case 'multiselect_input': return renderMultiselectInput(comp);
    case 'date_input': return renderDateInput(comp);
    case 'color_picker_input': return renderColorPickerInput(comp);
    case 'audio_player': return renderAudioPlayer(comp);
    case 'video_player': return renderVideoPlayer(comp);
    case 'file_download': return renderFileDownload(comp);
    case 'toast': return renderToast(comp);
    case 'dialog': return renderDialog(comp);
    case 'caption': return renderCaption(comp);
    case 'html_embed': return renderHtmlEmbed(comp);
    case 'skeleton': return renderSkeleton(comp);
    case 'tooltip_wrap': return renderTooltipWrap(comp);
    case 'time_input': return renderTimeInput(comp);
    case 'gallery': return renderGallery(comp);
    case 'breadcrumb': return renderBreadcrumb(comp);
    case 'pagination': return renderPagination(comp);
    case 'key_value_list': return renderKeyValueList(comp);
    case 'popover': return renderPopover(comp);
    default: {
      const div = document.createElement('div');
      div.className = 'db-viewer';
      div.innerHTML = `<pre>${JSON.stringify(comp, null, 2)}</pre>`;
      return div;
    }
  }
}

function renderCard(comp) {
  const card = document.createElement('div');
  card.className = 'db-card';
  let html = '';
  if (comp.title) html += `<div class="db-card-title">${comp.title}</div>`;
  if (comp.value !== undefined) html += `<div class="db-card-value">${comp.value}</div>`;
  if (comp.footer) html += `<div class="db-card-footer">${comp.footer}</div>`;
  card.innerHTML = html;
  return card;
}

function renderColumns(comp) {
  const grid = document.createElement('div');
  grid.className = 'db-columns';
  const cols = comp.children || comp.columns || [];
  grid.style.gridTemplateColumns = `repeat(${cols.length}, 1fr)`;
  cols.forEach(child => grid.appendChild(renderComponent(child)));
  return grid;
}

function renderChart(comp) {
  // Simplified chart — renders as a card with data info
  const card = document.createElement('div');
  card.className = 'db-card';
  card.innerHTML = `
    <div class="db-card-title">${comp.title || 'Chart'}</div>
    <div style="color:var(--db-text-dim);font-size:13px;">
      📊 ${(comp.data || []).length} data points
    </div>
  `;
  return card;
}

function renderTable(comp) {
  const wrapper = document.createElement('div');
  wrapper.className = 'db-viewer';
  const headers = comp.headers || [];
  const rows = comp.rows || [];
  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  if (headers.length) {
    html += '<tr>' + headers.map(h => `<th style="text-align:left;padding:8px 12px;border-bottom:1px solid var(--db-border);color:var(--db-text-dim);font-weight:600;font-size:11px;text-transform:uppercase;">${h}</th>`).join('') + '</tr>';
  }
  rows.forEach(row => {
    html += '<tr>' + row.map(cell => `<td style="padding:8px 12px;border-bottom:1px solid var(--db-border);">${cell}</td>`).join('') + '</tr>';
  });
  html += '</table>';
  wrapper.innerHTML = html;
  return wrapper;
}

function renderText(comp) {
  const div = document.createElement('div');
  div.style.cssText = 'font-size:14px;line-height:1.7;color:var(--db-text-dim);margin-bottom:16px;';
  div.textContent = comp.content || '';
  return div;
}

// ── New component render functions ─────────────────────────

function renderMetric(comp) {
  const el = document.createElement('div');
  el.className = 'db-metric';
  let deltaClass = 'neutral';
  let deltaVal = comp.delta || '';
  if (typeof deltaVal === 'string') {
    if (deltaVal.startsWith('+') || deltaVal.startsWith('↑')) deltaClass = 'positive';
    else if (deltaVal.startsWith('-') || deltaVal.startsWith('↓')) deltaClass = 'negative';
  } else if (typeof deltaVal === 'number') {
    deltaClass = deltaVal > 0 ? 'positive' : deltaVal < 0 ? 'negative' : 'neutral';
  }
  let html = '';
  if (comp.label) html += `<div class="db-metric-label">${comp.label}</div>`;
  if (comp.value !== undefined) html += `<div class="db-metric-value">${comp.value}</div>`;
  if (deltaVal !== '' && deltaVal !== undefined) html += `<div class="db-metric-delta ${deltaClass}">${deltaVal}</div>`;
  el.innerHTML = html;
  return el;
}

function renderProgressBar(comp) {
  const el = document.createElement('div');
  el.className = 'db-progress';
  const val = comp.value || 0;
  const max = comp.max_value || comp.max || 100;
  const pct = Math.min(100, Math.max(0, (val / max) * 100));
  el.innerHTML = `
    <div class="db-progress-label">
      <span>${comp.label || ''}</span>
      <span>${Math.round(pct)}%</span>
    </div>
    <div class="db-progress-track">
      <div class="db-progress-bar" style="width:${pct}%"></div>
    </div>
  `;
  return el;
}

function renderAlert(comp) {
  const variant = comp.variant || 'info';
  const el = document.createElement('div');
  el.className = `db-alert db-alert-${variant}`;
  const icons = { info: 'ℹ️', success: '✓', warning: '⚠️', error: '✗' };
  const titleHtml = comp.title ? `<strong style="display:block;margin-bottom:2px">${comp.title}</strong>` : '';
  el.innerHTML = `<span>${icons[variant] || 'ℹ️'}</span><span>${titleHtml}${comp.message || comp.content || ''}</span>`;
  return el;
}

function renderBadge(comp) {
  const el = document.createElement('span');
  const variant = comp.variant || 'default';
  let cls = 'db-badge';
  if (variant === 'secondary') cls += ' db-badge-secondary';
  else if (variant === 'destructive') cls += ' db-badge-destructive';
  else if (variant === 'outline') cls += ' db-badge-outline';
  el.className = cls;
  el.textContent = comp.text || comp.label || '';
  return el;
}

function renderSeparator(comp) {
  const el = document.createElement('hr');
  el.className = 'db-separator';
  return el;
}

function renderTabs(comp) {
  const el = document.createElement('div');
  el.className = 'db-tabs';
  const items = comp.items || [];
  if (!items.length) return el;

  const tabList = document.createElement('div');
  tabList.className = 'db-tab-list';

  const panels = [];
  items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'db-tab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = item.label || `Tab ${i + 1}`;
    btn.dataset.tabIdx = i;
    tabList.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'db-tab-panel' + (i === 0 ? ' active' : '');
    const children = item.children || [];
    children.forEach(child => panel.appendChild(renderComponent(child)));
    panels.push(panel);
  });

  tabList.addEventListener('click', (e) => {
    const btn = e.target.closest('.db-tab-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.tabIdx);
    tabList.querySelectorAll('.db-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    panels.forEach((p, i) => p.classList.toggle('active', i === idx));
  });

  el.appendChild(tabList);
  panels.forEach(p => el.appendChild(p));
  return el;
}

function renderAccordion(comp) {
  const el = document.createElement('div');
  el.className = 'db-accordion';
  const items = comp.items || [];
  items.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.className = 'db-accordion-item';

    const trigger = document.createElement('button');
    trigger.className = 'db-accordion-trigger';
    trigger.textContent = item.title || '';

    const content = document.createElement('div');
    content.className = 'db-accordion-content';
    if (typeof item.content === 'string') {
      content.textContent = item.content;
    } else if (Array.isArray(item.children)) {
      item.children.forEach(child => content.appendChild(renderComponent(child)));
    }

    trigger.addEventListener('click', () => {
      trigger.classList.toggle('open');
      content.classList.toggle('open');
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(content);
    el.appendChild(wrapper);
  });
  return el;
}

function renderImageDisplay(comp) {
  const figure = document.createElement('figure');
  figure.className = 'db-image';
  figure.style.margin = '0 0 16px';
  const img = document.createElement('img');
  img.src = comp.src || '';
  img.alt = comp.alt || '';
  if (comp.width) img.style.width = comp.width;
  figure.appendChild(img);
  if (comp.caption) {
    const cap = document.createElement('figcaption');
    cap.textContent = comp.caption;
    figure.appendChild(cap);
  }
  return figure;
}

function renderCodeBlock(comp) {
  const el = document.createElement('div');
  el.className = 'db-code-block';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (comp.language) code.className = `language-${comp.language}`;
  code.textContent = comp.code || '';
  pre.appendChild(code);
  el.appendChild(pre);
  return el;
}

function renderJsonView(comp) {
  const el = document.createElement('div');
  el.className = 'db-json-view';
  const pre = document.createElement('pre');
  try {
    pre.textContent = JSON.stringify(comp.data !== undefined ? comp.data : comp, null, 2);
  } catch (e) {
    pre.textContent = String(comp.data || '');
  }
  el.appendChild(pre);
  return el;
}

function renderTextInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group';
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <input type="text" class="db-form-input" value="${comp.value || ''}" placeholder="${comp.placeholder || ''}">
  `;
  return el;
}

function renderNumberInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group';
  const attrs = [];
  if (comp.min_val !== undefined) attrs.push(`min="${comp.min_val}"`);
  if (comp.max_val !== undefined) attrs.push(`max="${comp.max_val}"`);
  if (comp.step !== undefined) attrs.push(`step="${comp.step}"`);
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <input type="number" class="db-form-input" value="${comp.value || ''}" ${attrs.join(' ')}>
  `;
  return el;
}

function renderSelectInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group';
  const options = (comp.options || []).map(opt => {
    const val = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    const selected = val === comp.value ? ' selected' : '';
    return `<option value="${val}"${selected}>${label}</option>`;
  }).join('');
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <select class="db-form-select">${options}</select>
  `;
  return el;
}

function renderSliderInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group';
  const val = comp.value || 0;
  const min = comp.min_val !== undefined ? comp.min_val : 0;
  const max = comp.max_val !== undefined ? comp.max_val : 100;
  const step = comp.step !== undefined ? comp.step : 1;
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <div style="display:flex;align-items:center;gap:12px">
      <input type="range" class="db-form-input" style="flex:1" value="${val}" min="${min}" max="${max}" step="${step}">
      <span style="font-size:13px;color:var(--db-text);min-width:40px;text-align:right">${val}</span>
    </div>
  `;
  const range = el.querySelector('input[type="range"]');
  const display = el.querySelector('span');
  range.addEventListener('input', () => { display.textContent = range.value; });
  return el;
}

function renderCheckboxInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group db-form-checkbox';
  el.innerHTML = `
    <input type="checkbox" ${comp.checked ? 'checked' : ''}>
    <label class="db-form-label" style="margin:0">${comp.label || ''}</label>
  `;
  return el;
}

function renderSwitchInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group db-form-switch';
  const on = comp.checked ? ' on' : '';
  el.innerHTML = `
    <div class="db-switch-track${on}"><div class="db-switch-thumb"></div></div>
    <span style="font-size:13px;color:var(--db-text)">${comp.label || ''}</span>
  `;
  const track = el.querySelector('.db-switch-track');
  track.addEventListener('click', () => { track.classList.toggle('on'); });
  return el;
}

function renderRadioInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group db-form-radio';
  const name = 'radio_' + Math.random().toString(36).slice(2, 8);
  const options = (comp.options || []).map(opt => {
    const val = typeof opt === 'object' ? opt.value : opt;
    const label = typeof opt === 'object' ? opt.label : opt;
    const checked = val === comp.value ? ' checked' : '';
    return `<label><input type="radio" name="${name}" value="${val}"${checked}>${label}</label>`;
  }).join('');
  el.innerHTML = `
    ${comp.label ? `<div class="db-form-label">${comp.label}</div>` : ''}
    <fieldset>${options}</fieldset>
  `;
  return el;
}

function renderTextareaInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group';
  const rows = comp.rows || 4;
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <textarea class="db-form-textarea" rows="${rows}" placeholder="${comp.placeholder || ''}">${comp.value || ''}</textarea>
  `;
  return el;
}

function renderContainer(comp) {
  const el = document.createElement('div');
  el.className = 'db-container';
  if (comp.title) {
    const h3 = document.createElement('h3');
    h3.textContent = comp.title;
    el.appendChild(h3);
  }
  const children = comp.children || [];
  children.forEach(child => el.appendChild(renderComponent(child)));
  return el;
}

function renderExpander(comp) {
  const el = document.createElement('div');
  el.className = 'db-expander';
  const header = document.createElement('div');
  header.className = 'db-expander-header' + (comp.expanded ? ' open' : '');
  header.textContent = comp.title || '';

  const content = document.createElement('div');
  content.className = 'db-expander-content' + (comp.expanded ? ' open' : '');
  const children = comp.children || [];
  children.forEach(child => content.appendChild(renderComponent(child)));

  header.addEventListener('click', () => {
    header.classList.toggle('open');
    content.classList.toggle('open');
  });

  el.appendChild(header);
  el.appendChild(content);
  return el;
}

function renderDivider(comp) {
  if (comp.text) {
    const el = document.createElement('div');
    el.className = 'db-divider';
    el.innerHTML = `<span class="db-divider-text">${comp.text}</span>`;
    return el;
  }
  const el = document.createElement('div');
  el.className = 'db-divider';
  return el;
}

function renderLink(comp) {
  const el = document.createElement('a');
  el.className = 'db-link';
  el.href = comp.href || '#';
  el.textContent = comp.text || comp.href || '';
  if (comp.external) el.target = '_blank';
  return el;
}

function renderButtonGroup(comp) {
  const el = document.createElement('div');
  el.className = 'db-button-group';
  const buttons = comp.buttons || [];
  buttons.forEach(b => {
    const btn = document.createElement('button');
    let cls = 'db-btn';
    if (b.variant === 'primary') cls += ' db-btn-primary';
    else if (b.variant === 'destructive') cls += ' db-btn-destructive';
    btn.className = cls;
    btn.textContent = b.label || '';
    el.appendChild(btn);
  });
  return el;
}

function renderStatGroup(comp) {
  const el = document.createElement('div');
  el.className = 'db-stat-group';
  const stats = comp.stats || [];
  stats.forEach(s => {
    el.appendChild(renderMetric({ label: s.label, value: s.value, delta: s.delta }));
  });
  return el;
}

function renderHeader(comp) {
  const level = Math.min(6, Math.max(1, comp.level || 2));
  const el = document.createElement(`h${level}`);
  el.className = 'db-header';
  el.textContent = comp.text || '';
  return el;
}

function renderMarkdownText(comp) {
  const el = document.createElement('div');
  el.className = 'db-markdown';
  el.innerHTML = comp.content || '';
  return el;
}

function renderEmpty(comp) {
  const el = document.createElement('div');
  el.className = 'db-empty';
  el.textContent = comp.text || 'No data available';
  return el;
}

function renderSpinnerComponent(comp) {
  const el = document.createElement('div');
  el.className = 'db-spinner-container';
  el.innerHTML = `<div class="db-spinner"></div><span>${comp.text || 'Loading…'}</span>`;
  return el;
}

function renderAvatar(comp) {
  const el = document.createElement('div');
  el.className = 'db-avatar';
  if (comp.src) {
    el.innerHTML = `<img src="${comp.src}" alt="${comp.name || ''}">`;
  } else {
    const name = comp.name || comp.fallback || '?';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    el.textContent = initials;
  }
  return el;
}

function renderCallout(comp) {
  const variant = comp.variant || 'info';
  const el = document.createElement('div');
  el.className = `db-callout db-callout-${variant}`;
  let html = '';
  if (comp.title) html += `<div class="db-callout-title">${comp.title}</div>`;
  html += `<div class="db-callout-content">${comp.content || ''}</div>`;
  el.innerHTML = html;
  return el;
}

function renderMultiselectInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group db-multiselect';
  const options = comp.options || [];
  const selected = new Set(comp.value || []);
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <div class="db-multiselect-tags" id="ms-tags"></div>
  `;
  const tagsEl = el.querySelector('#ms-tags');
  tagsEl.removeAttribute('id');
  options.forEach(opt => {
    const tag = document.createElement('label');
    tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--db-text);margin-bottom:4px';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(opt);
    cb.style.accentColor = 'var(--db-accent)';
    tag.appendChild(cb);
    tag.appendChild(document.createTextNode(opt));
    tagsEl.appendChild(tag);
  });
  return el;
}

function renderDateInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group db-date-input';
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <input type="date" value="${comp.value || ''}">
  `;
  return el;
}

function renderColorPickerInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group';
  const val = comp.value || '#000000';
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <div class="db-color-picker">
      <input type="color" value="${val}">
      <span class="db-color-value">${val}</span>
    </div>
  `;
  const colorInput = el.querySelector('input[type="color"]');
  const display = el.querySelector('.db-color-value');
  colorInput.addEventListener('input', () => { display.textContent = colorInput.value; });
  return el;
}

function renderAudioPlayer(comp) {
  const el = document.createElement('div');
  el.className = 'db-audio-player';
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = comp.src || '';
  if (comp.autoplay) audio.autoplay = true;
  el.appendChild(audio);
  return el;
}

function renderVideoPlayer(comp) {
  const el = document.createElement('div');
  el.className = 'db-video-player';
  const video = document.createElement('video');
  video.controls = true;
  video.src = comp.src || '';
  if (comp.autoplay) video.autoplay = true;
  if (comp.poster) video.poster = comp.poster;
  el.appendChild(video);
  return el;
}

function renderFileDownload(comp) {
  const el = document.createElement('a');
  el.className = 'db-file-download';
  el.href = comp.href || '#';
  if (comp.filename) el.download = comp.filename;
  else el.download = '';
  el.innerHTML = `⬇ ${comp.label || 'Download'}`;
  return el;
}

function renderToast(comp) {
  const variant = comp.variant || 'info';
  const el = document.createElement('div');
  el.className = `db-toast db-toast-${variant}`;
  el.textContent = comp.message || '';
  document.body.appendChild(el);
  const duration = comp.duration || 3000;
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
  // Return empty placeholder for the component list
  const placeholder = document.createElement('div');
  return placeholder;
}

function renderDialog(comp) {
  const el = document.createElement('div');
  el.className = 'db-card';
  el.style.cursor = 'pointer';
  el.innerHTML = `<div class="db-card-title">${comp.title || 'Dialog'}</div><div style="font-size:12px;color:var(--db-text-dim)">Click to open</div>`;
  el.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'db-dialog-overlay';
    const content = document.createElement('div');
    content.className = 'db-dialog-content';
    let html = `<div class="db-dialog-title">${comp.title || ''}</div>`;
    if (comp.description) html += `<div class="db-dialog-desc">${comp.description}</div>`;
    content.innerHTML = html;
    const childContainer = document.createElement('div');
    (comp.children || []).forEach(child => childContainer.appendChild(renderComponent(child)));
    content.appendChild(childContainer);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'db-btn';
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '16px';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay.remove(); });
    content.appendChild(closeBtn);
    overlay.appendChild(content);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  });
  return el;
}

function renderCaption(comp) {
  const el = document.createElement('p');
  el.className = 'db-caption';
  el.textContent = comp.text || '';
  return el;
}

function renderHtmlEmbed(comp) {
  const el = document.createElement('div');
  el.className = 'db-html-embed';
  el.innerHTML = comp.content || '';
  return el;
}

function renderSkeleton(comp) {
  const el = document.createElement('div');
  const variant = comp.variant || 'text';
  el.className = `db-skeleton db-skeleton-${variant}`;
  if (comp.width) el.style.width = comp.width;
  if (comp.height) el.style.height = comp.height;
  return el;
}

function renderTooltipWrap(comp) {
  const el = document.createElement('div');
  el.className = 'db-tooltip-wrap';
  if (comp.child) el.appendChild(renderComponent(comp.child));
  const tip = document.createElement('div');
  tip.className = 'db-tooltip-content';
  tip.textContent = comp.content || '';
  el.appendChild(tip);
  return el;
}

function renderTimeInput(comp) {
  const el = document.createElement('div');
  el.className = 'db-form-group db-time-input';
  el.innerHTML = `
    ${comp.label ? `<label class="db-form-label">${comp.label}</label>` : ''}
    <input type="time" value="${comp.value || ''}">
  `;
  return el;
}

function renderGallery(comp) {
  const el = document.createElement('div');
  el.className = 'db-gallery';
  (comp.items || []).forEach(item => {
    const figure = document.createElement('figure');
    figure.className = 'db-gallery-item';
    figure.style.margin = '0';
    const img = document.createElement('img');
    img.src = item.src || '';
    img.alt = item.alt || '';
    figure.appendChild(img);
    if (item.caption) {
      const cap = document.createElement('figcaption');
      cap.textContent = item.caption;
      figure.appendChild(cap);
    }
    el.appendChild(figure);
  });
  return el;
}

function renderBreadcrumb(comp) {
  const el = document.createElement('nav');
  el.className = 'db-breadcrumb';
  const items = comp.items || [];
  items.forEach((item, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'db-breadcrumb-sep';
      sep.textContent = '/';
      el.appendChild(sep);
    }
    if (item.href) {
      const a = document.createElement('a');
      a.href = item.href;
      a.textContent = item.label || '';
      el.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.textContent = item.label || '';
      el.appendChild(span);
    }
  });
  return el;
}

function renderPagination(comp) {
  const el = document.createElement('div');
  el.className = 'db-pagination';
  const total = comp.total || 0;
  const perPage = comp.per_page || 10;
  const totalPages = Math.ceil(total / perPage);
  let currentPage = comp.page || 1;
  function render() {
    el.innerHTML = '';
    const prev = document.createElement('button');
    prev.textContent = '←';
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); } });
    el.appendChild(prev);
    for (let i = 1; i <= Math.min(totalPages, 7); i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      if (i === currentPage) btn.classList.add('active');
      btn.addEventListener('click', () => { currentPage = i; render(); });
      el.appendChild(btn);
    }
    if (totalPages > 7) {
      const dots = document.createElement('span');
      dots.textContent = '…';
      dots.style.cssText = 'padding:0 4px;color:var(--db-text-dim)';
      el.appendChild(dots);
    }
    const next = document.createElement('button');
    next.textContent = '→';
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; render(); } });
    el.appendChild(next);
  }
  render();
  return el;
}

function renderKeyValueList(comp) {
  const el = document.createElement('div');
  el.className = 'db-kv-list';
  if (comp.title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'db-kv-list-title';
    titleEl.textContent = comp.title;
    el.appendChild(titleEl);
  }
  (comp.items || []).forEach(item => {
    const row = document.createElement('div');
    row.className = 'db-kv-item';
    row.innerHTML = `<span class="db-kv-label">${item.label || ''}</span><span class="db-kv-value">${item.value !== undefined ? item.value : ''}</span>`;
    el.appendChild(row);
  });
  return el;
}

function renderPopover(comp) {
  const el = document.createElement('div');
  el.className = 'db-popover';
  if (comp.trigger) {
    const triggerEl = renderComponent(comp.trigger);
    triggerEl.style.cursor = 'pointer';
    triggerEl.addEventListener('click', (e) => { e.stopPropagation(); el.classList.toggle('open'); });
    el.appendChild(triggerEl);
  }
  const content = document.createElement('div');
  content.className = 'db-popover-content';
  (comp.children || []).forEach(child => content.appendChild(renderComponent(child)));
  el.appendChild(content);
  document.addEventListener('click', (e) => { if (!el.contains(e.target)) el.classList.remove('open'); });
  return el;
}

// ── Test All Features panel ────────────────────────────────

async function showTestPanel() {
  activePageId = '__test__';

  // Sync URL path for Inspector
  if (location.pathname !== '/inspector') {
    history.pushState({ pageId: '__test__' }, '', '/inspector');
  }
  document.querySelectorAll('.db-nav-item').forEach(el => el.classList.remove('active'));
  const main = document.getElementById('db-main-content');
  if (!main) return;

  main.innerHTML = `
    <div class="db-page-header">
      <h1 class="db-page-title">🔍 Inspector</h1>
      <p class="db-page-desc">Interactive data flow debugger — click a feature to inspect its API endpoints and see raw request/response data.</p>
    </div>
    <div id="fi-container">
      <div class="db-loading"><div class="db-spinner"></div></div>
    </div>
    <!-- Debug Modal -->
    <div id="fi-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;align-items:center;justify-content:center;backdrop-filter:blur(4px)"></div>
  `;

  try {
    const res = await fetch('/api/features');
    const data = await res.json();
    const features = data.features || [];
    const container = document.getElementById('fi-container');

    if (features.length === 0) {
      container.innerHTML = '<div class="db-viewer"><pre>No features registered.</pre></div>';
      return;
    }

    // Summary bar
    const healthy = features.filter(f => f.health?.status === 'ok').length;
    container.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Features</div><div class="db-card-value">${features.length}</div></div>
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Healthy</div><div class="db-card-value" style="color:#22c55e">${healthy}</div></div>
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Failing</div><div class="db-card-value" style="color:${features.length - healthy > 0 ? '#ef4444' : '#22c55e'}">${features.length - healthy}</div></div>
        <div class="db-card" style="padding:12px 18px;flex:1;min-width:120px"><div class="db-card-title">Total Routes</div><div class="db-card-value">${features.reduce((s, f) => s + (f.routes?.length || 0), 0)}</div></div>
      </div>
      <div id="fi-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px"></div>
      <div id="fi-detail" style="display:none;margin-top:20px"></div>
    `;

    const grid = document.getElementById('fi-grid');
    for (const feature of features) {
      const routes = feature.routes || [];
      const ok = feature.health?.status === 'ok';
      const card = document.createElement('div');
      card.className = 'db-card';
      card.style.cssText = 'padding:16px 20px;cursor:pointer;transition:border-color 0.2s,box-shadow 0.2s';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div style="font-weight:600;font-size:14px">${feature.name}</div>
          <span style="font-size:11px;padding:3px 10px;border-radius:12px;${ok ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${ok ? '● healthy' : '○ error'}</span>
        </div>
        <div style="font-size:12px;color:var(--db-text-dim);margin-bottom:10px">${feature.description || ''}</div>
        <div style="display:flex;gap:16px;font-size:11px;color:var(--db-text-dim)">
          <span>📡 ${routes.length} route${routes.length !== 1 ? 's' : ''}</span>
          ${feature.health?.total_agents !== undefined ? `<span>🤖 ${feature.health.total_agents} agents</span>` : ''}
          ${feature.health?.total_jobs !== undefined ? `<span>📋 ${feature.health.total_jobs} jobs</span>` : ''}
          ${feature.health?.total_requests !== undefined ? `<span>📊 ${feature.health.total_requests} reqs</span>` : ''}
        </div>
      `;
      card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--db-accent)');
      card.addEventListener('mouseleave', () => card.style.borderColor = '');
      card.addEventListener('click', () => showFeatureDetail(feature));
      grid.appendChild(card);
    }
  } catch (e) {
    document.getElementById('fi-container').innerHTML =
      '<div class="db-viewer"><pre>Failed to load features: ' + e.message + '</pre></div>';
  }
}

async function showFeatureDetail(feature) {
  const detail = document.getElementById('fi-detail');
  const grid = document.getElementById('fi-grid');
  grid.style.display = 'none';
  detail.style.display = 'block';

  const routes = feature.routes || [];
  const ok = feature.health?.status === 'ok';

  detail.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button id="fi-back" style="background:transparent;border:1px solid var(--db-border);color:var(--db-text);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px">← Back</button>
      <h2 style="margin:0;font-size:20px;font-weight:600">${feature.name}</h2>
      <span style="font-size:11px;padding:3px 10px;border-radius:12px;${ok ? 'background:rgba(34,197,94,0.15);color:#22c55e' : 'background:rgba(239,68,68,0.15);color:#ef4444'}">${ok ? '● healthy' : '○ error'}</span>
    </div>
    <p style="font-size:13px;color:var(--db-text-dim);margin:0 0 12px">${feature.description || ''}</p>

    <!-- Health Data -->
    <div class="db-card" style="padding:14px 18px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="db-card-title" style="margin:0">Health Status</div>
        <button class="fi-info-btn" data-json='${JSON.stringify(feature.health || {}).replace(/'/g, "&#39;")}' style="background:transparent;border:1px solid var(--db-border);color:var(--db-accent);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px" title="View raw health JSON">ℹ️ Raw</button>
      </div>
      <pre style="font-size:12px;color:var(--db-text-dim);margin:0;white-space:pre-wrap;max-height:100px;overflow-y:auto">${JSON.stringify(feature.health, null, 2)}</pre>
    </div>

    <!-- Data Flow Diagram -->
    <div class="db-card" style="padding:16px 20px;margin-bottom:20px">
      <div class="db-card-title">Data Flow</div>
      <div style="display:flex;align-items:center;gap:0;margin-top:12px;flex-wrap:wrap">
        <div style="text-align:center;padding:10px 16px;background:rgba(99,102,241,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#818cf8">🖥️ Frontend<br><span style="font-size:10px;opacity:0.7">dashboard.js</span></div>
        <div style="font-size:18px;color:var(--db-text-dim);padding:0 8px">→</div>
        <div style="text-align:center;padding:10px 16px;background:rgba(34,197,94,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#22c55e">📡 API<br><span style="font-size:10px;opacity:0.7">/api/features</span></div>
        <div style="font-size:18px;color:var(--db-text-dim);padding:0 8px">→</div>
        <div style="text-align:center;padding:10px 16px;background:rgba(251,146,60,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#fb923c">⚙️ Backend<br><span style="font-size:10px;opacity:0.7">${feature.name}.py</span></div>
        <div style="font-size:18px;color:var(--db-text-dim);padding:0 8px">→</div>
        <div style="text-align:center;padding:10px 16px;background:rgba(168,85,247,0.15);border-radius:8px;font-size:12px;font-weight:500;color:#a855f7">📦 Response<br><span style="font-size:10px;opacity:0.7">JSON</span></div>
      </div>
    </div>

    <!-- Endpoints -->
    <h3 style="font-size:15px;margin:0 0 12px;font-weight:600">Endpoints (${routes.length})</h3>
    <div style="font-size:11px;color:var(--db-text-dim);margin-bottom:12px">Click ▶ to test an endpoint live. Click ℹ️ to see raw request/response JSON.</div>
    <div id="fi-endpoints"></div>
  `;

  // Back button
  detail.querySelector('#fi-back').addEventListener('click', () => {
    detail.style.display = 'none';
    grid.style.display = 'grid';
  });

  // Info button for health
  detail.querySelectorAll('.fi-info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDebugModal('Health Status', {}, JSON.parse(btn.dataset.json.replace(/&#39;/g, "'")));
    });
  });

  // Render endpoints
  const endpointsEl = detail.querySelector('#fi-endpoints');
  if (routes.length === 0) {
    endpointsEl.innerHTML = '<div style="font-size:13px;color:var(--db-text-dim)">No routes registered for this feature.</div>';
    return;
  }

  routes.forEach((route, i) => {
    const hasParam = route.includes('{');
    const row = document.createElement('div');
    row.className = 'db-card';
    row.style.cssText = 'padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <code style="font-size:13px;font-weight:500;color:var(--db-text)">${route}</code>
        ${hasParam ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(251,146,60,0.15);color:#fb923c">param</span>' : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span id="fi-status-${i}" style="font-size:11px;color:var(--db-text-dim)"></span>
        <span id="fi-time-${i}" style="font-size:10px;color:var(--db-text-dim)"></span>
        ${!hasParam ? `<button class="fi-test-btn" data-route="${route}" data-idx="${i}" style="background:transparent;border:1px solid var(--db-border);color:#22c55e;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px" title="Test this endpoint">▶</button>` : ''}
        <button class="fi-debug-btn" data-route="${route}" data-idx="${i}" style="background:transparent;border:1px solid var(--db-border);color:var(--db-accent);padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px" title="Debug: view raw data">ℹ️</button>
      </div>
    `;
    endpointsEl.appendChild(row);
  });

  // Wire test buttons
  endpointsEl.querySelectorAll('.fi-test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const route = btn.dataset.route;
      const idx = btn.dataset.idx;
      const statusEl = detail.querySelector(`#fi-status-${idx}`);
      const timeEl = detail.querySelector(`#fi-time-${idx}`);
      statusEl.textContent = '⏳';
      statusEl.style.color = 'var(--db-text-dim)';
      const start = performance.now();
      try {
        const res = await fetch(route);
        const ms = Math.round(performance.now() - start);
        timeEl.textContent = `${ms}ms`;
        if (res.ok) {
          statusEl.textContent = `✓ ${res.status}`;
          statusEl.style.color = '#22c55e';
        } else if (res.status === 401 || res.status === 405) {
          statusEl.textContent = `✓ ${res.status}`;
          statusEl.style.color = '#fb923c';
        } else {
          statusEl.textContent = `✗ ${res.status}`;
          statusEl.style.color = '#ef4444';
        }
        // Store response for debug
        try { btn._lastResponse = await res.clone().json(); } catch(e) { btn._lastResponse = await res.clone().text(); }
        btn._lastStatus = res.status;
        btn._lastMs = ms;
      } catch(err) {
        statusEl.textContent = '✗ error';
        statusEl.style.color = '#ef4444';
        btn._lastResponse = { error: err.message };
        btn._lastStatus = 0;
      }
    });
  });

  // Wire debug buttons
  endpointsEl.querySelectorAll('.fi-debug-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const route = btn.dataset.route;
      const idx = btn.dataset.idx;
      const hasParam = route.includes('{');

      if (hasParam) {
        showDebugModal(`${route}`, { method: 'GET', note: 'Route has path parameters — provide an ID to test' }, { info: 'This route requires path parameters. Test it manually or via curl.' });
        return;
      }

      // Fetch live data
      const statusEl = detail.querySelector(`#fi-status-${idx}`);
      const timeEl = detail.querySelector(`#fi-time-${idx}`);
      statusEl.textContent = '⏳';
      const start = performance.now();
      try {
        const res = await fetch(route);
        const ms = Math.round(performance.now() - start);
        timeEl.textContent = `${ms}ms`;
        let body;
        try { body = await res.json(); } catch(e) { body = await res.text(); }
        statusEl.textContent = res.ok ? `✓ ${res.status}` : `${res.status}`;
        statusEl.style.color = res.ok ? '#22c55e' : (res.status === 401 || res.status === 405 ? '#fb923c' : '#ef4444');
        showDebugModal(route, { method: 'GET', url: route, headers: { accept: 'application/json' } }, body, res.status, ms);
      } catch(err) {
        statusEl.textContent = '✗ error';
        statusEl.style.color = '#ef4444';
        showDebugModal(route, { method: 'GET', url: route }, { error: err.message }, 0, 0);
      }
    });
  });
}

function showDebugModal(title, request, response, status, ms) {
  const modal = document.getElementById('fi-modal');
  modal.style.display = 'flex';

  const statusColor = status >= 200 && status < 300 ? '#22c55e' : (status === 401 || status === 405 ? '#fb923c' : '#ef4444');
  const responseStr = typeof response === 'string' ? response : JSON.stringify(response, null, 2);
  const requestStr = typeof request === 'string' ? request : JSON.stringify(request, null, 2);

  modal.innerHTML = `
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:14px;padding:24px;width:680px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:600">ℹ️ Debug Inspector</h3>
          <code style="font-size:12px;color:var(--db-text-dim)">${title}</code>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${status ? `<span style="font-size:12px;padding:3px 10px;border-radius:6px;background:${statusColor}22;color:${statusColor};font-weight:600">${status}</span>` : ''}
          ${ms ? `<span style="font-size:11px;color:var(--db-text-dim)">${ms}ms</span>` : ''}
          <button id="fi-modal-close" style="background:transparent;border:none;color:var(--db-text-dim);font-size:18px;cursor:pointer;padding:4px 8px">✕</button>
        </div>
      </div>

      <div style="flex:1;overflow-y:auto">
        <!-- Flow Diagram -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;flex-wrap:wrap;font-size:11px">
          <span style="padding:4px 10px;background:rgba(99,102,241,0.15);color:#818cf8;border-radius:6px">🖥️ Browser</span>
          <span style="color:var(--db-text-dim)">→ fetch("${title}")</span>
          <span style="color:var(--db-text-dim)">→</span>
          <span style="padding:4px 10px;background:rgba(34,197,94,0.15);color:#22c55e;border-radius:6px">📡 Starlette</span>
          <span style="color:var(--db-text-dim)">→</span>
          <span style="padding:4px 10px;background:rgba(251,146,60,0.15);color:#fb923c;border-radius:6px">⚙️ Handler</span>
          <span style="color:var(--db-text-dim)">→</span>
          <span style="padding:4px 10px;background:${statusColor}22;color:${statusColor};border-radius:6px">${status ? status : '?'}</span>
        </div>

        <!-- Request -->
        <div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--db-text-dim);margin-bottom:6px">Request</div>
          <pre style="background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;padding:12px;font-size:12px;color:var(--db-text);margin:0;white-space:pre-wrap;overflow-x:auto;max-height:120px">${requestStr}</pre>
        </div>

        <!-- Response -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--db-text-dim)">Response</div>
            <button id="fi-copy" style="font-size:10px;padding:2px 8px;background:transparent;border:1px solid var(--db-border);color:var(--db-text-dim);border-radius:4px;cursor:pointer">📋 Copy</button>
          </div>
          <pre id="fi-response-pre" style="background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;padding:12px;font-size:12px;color:var(--db-text);margin:0;white-space:pre-wrap;overflow-x:auto;max-height:350px;overflow-y:auto">${responseStr}</pre>
        </div>
      </div>
    </div>
  `;

  modal.querySelector('#fi-modal-close').addEventListener('click', () => modal.style.display = 'none');
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  modal.querySelector('#fi-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(responseStr).then(() => {
      const btn = modal.querySelector('#fi-copy');
      btn.textContent = '✓ Copied';
      setTimeout(() => btn.textContent = '📋 Copy', 1500);
    });
  });
}

function onContentChange(root) {
  // If dashboard is active and page container exists, re-check for plugins
  if (activePageId && activePageId !== '__test__') {
    const container = root.querySelector(`[data-page="${activePageId}"]`);
    if (container && container.children.length === 0) {
      const page = pagesData.find(p => p.id === activePageId);
      if (page) loadGenericViewer(page, container);
    }
  }
}

export { init, onContentChange };
