/*
 * Client-side extension demo for PraisonAIUI.
 *
 * Demonstrates:
 *   1. window.aiui.registerComponent(type, renderFn)  — adds a new component type
 *   2. window.aiui.registerView(pageId, render, cleanup) — adds a custom page view
 *
 * To load this file, paste its contents into the browser DevTools Console
 * after the page loads. (A Python-side API to inject custom JS is a planned
 * enhancement — see 28-full-extensibility/README.md.)
 */

(function () {
  if (!window.aiui) {
    console.warn('[plugin.js] window.aiui not ready yet. Run after the page loads.');
    return;
  }

  // ── 1. Register a custom `timeline` component renderer ──────────
  window.aiui.registerComponent('timeline', function (comp) {
    const el = document.createElement('div');
    el.className = 'db-timeline';
    el.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:16px';
    (comp.events || []).forEach(function (ev) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;gap:16px;align-items:center;padding:12px;' +
        'background:var(--db-card-bg, #1f2937);border-radius:8px;' +
        'border-left:4px solid var(--db-accent, #818cf8)';
      row.innerHTML =
        '<div style="font-size:24px">' + (ev.icon || '•') + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:600;color:var(--db-text, #fff)">' +
            (ev.label || '') + '</div>' +
          '<div style="font-size:12px;color:var(--db-text-muted, #94a3b8);' +
            'margin-top:4px">' + (ev.time || '') + '</div>' +
        '</div>';
      el.appendChild(row);
    });
    return el;
  });
  console.log('[plugin.js] Registered custom component: timeline');

  // ── 2. Register a client-only custom view ──────────────────────
  window.aiui.registerView('custom-view', async function (container) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'padding:24px;background:var(--db-card-bg, #1f2937);' +
      'border-radius:12px;color:var(--db-text, #fff)';
    box.innerHTML =
      '<h2 style="margin:0 0 16px 0">⚡ Client-Only View</h2>' +
      '<p>This entire page is rendered by JavaScript in the browser — ' +
      'it does <b>not</b> call <code>/api/pages/custom-view/data</code>.</p>' +
      '<p>Registered via <code>window.aiui.registerView(\'custom-view\', ...)</code>.</p>' +
      '<p>Current time: <span id="aiui-clock"></span></p>';
    container.appendChild(box);
    const clock = box.querySelector('#aiui-clock');
    const tick = function () { clock.textContent = new Date().toLocaleTimeString(); };
    tick();
    window.__aiui_clock_timer = setInterval(tick, 1000);
  }, function () {
    // Cleanup when user navigates away
    clearInterval(window.__aiui_clock_timer);
    console.log('[plugin.js] Cleaned up custom-view clock');
  });
  console.log('[plugin.js] Registered custom view: custom-view');

  console.log('[plugin.js] ✅ All extensions loaded. Visit "Custom Component" and "Client-Only View" pages.');
})();
