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
      const iconDiv = document.createElement('div');
      iconDiv.style.cssText = 'font-size:24px';
      iconDiv.textContent = ev.icon || '•';
      
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'flex:1';
      
      const labelDiv = document.createElement('div');
      labelDiv.style.cssText = 'font-weight:600;color:var(--db-text, #fff)';
      labelDiv.textContent = ev.label || '';
      
      const timeDiv = document.createElement('div');
      timeDiv.style.cssText = 'font-size:12px;color:var(--db-text-muted, #94a3b8);margin-top:4px';
      timeDiv.textContent = ev.time || '';
      
      contentDiv.appendChild(labelDiv);
      contentDiv.appendChild(timeDiv);
      row.appendChild(iconDiv);
      row.appendChild(contentDiv);
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
    const h2 = document.createElement('h2');
    h2.style.cssText = 'margin:0 0 16px 0';
    h2.textContent = '⚡ Client-Only View';
    
    const p1 = document.createElement('p');
    p1.textContent = 'This entire page is rendered by JavaScript in the browser — it does ';
    const strongCode = document.createElement('strong');
    strongCode.textContent = 'not';
    p1.appendChild(strongCode);
    p1.appendChild(document.createTextNode(' call '));
    const code1 = document.createElement('code');
    code1.textContent = '/api/pages/custom-view/data';
    p1.appendChild(code1);
    p1.appendChild(document.createTextNode('.'));
    
    const p2 = document.createElement('p');
    p2.textContent = 'Registered via ';
    const code2 = document.createElement('code');
    code2.textContent = 'window.aiui.registerView(\'custom-view\', ...)';
    p2.appendChild(code2);
    p2.appendChild(document.createTextNode('.'));
    
    const p3 = document.createElement('p');
    p3.textContent = 'Current time: ';
    const clockSpan = document.createElement('span');
    clockSpan.id = 'aiui-clock';
    p3.appendChild(clockSpan);
    
    box.appendChild(h2);
    box.appendChild(p1);
    box.appendChild(p2);
    box.appendChild(p3);
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
