/**
 * Three-Column Feature Explorer — Custom View
 *
 * Left:   Grouped feature list with clickable endpoint buttons
 * Center: Live request/response activity log (shows what the gateway is doing)
 * Right:  Formatted JSON output from the selected endpoint
 *
 * Renders into [data-page="explorer"]
 */

// ── All 31 features with their endpoints ──────────────────────
const FEATURES = [
  { group: "Chat & Communication", items: [
    { name: "chat",           endpoints: [
      { label: "Health",        method: "GET",  url: "/api/chat/health" },
    ]},
    { name: "attachments",    endpoints: [
      { label: "List Files",    method: "GET",  url: "/api/attachments" },
    ]},
    { name: "channels",       endpoints: [
      { label: "List Channels", method: "GET",  url: "/api/channels" },
      { label: "Supported",     method: "GET",  url: "/api/channels/supported" },
    ]},
    { name: "protocol",       endpoints: [
      { label: "Version",       method: "GET",  url: "/api/protocol/version" },
    ]},
    { name: "subagents",      endpoints: [
      { label: "List",          method: "GET",  url: "/api/subagents" },
    ]},
    { name: "tts",            endpoints: [
      { label: "Voices",        method: "GET",  url: "/api/tts/voices" },
      { label: "Synthesize",    method: "POST", url: "/api/tts/synthesize", body: { text: "Hello from PraisonAI", voice: "default" } },
    ]},
  ]},
  { group: "Agent Management", items: [
    { name: "agents_crud",    endpoints: [
      { label: "List Agents",   method: "GET",  url: "/api/agents" },
    ]},
    { name: "approvals",      endpoints: [
      { label: "Pending",       method: "GET",  url: "/api/approvals/pending" },
      { label: "History",       method: "GET",  url: "/api/approvals/history" },
      { label: "Policies",      method: "GET",  url: "/api/approvals/policies" },
    ]},
    { name: "skills",         endpoints: [
      { label: "List Skills",   method: "GET",  url: "/api/skills" },
    ]},
    { name: "marketplace",    endpoints: [
      { label: "Plugins",       method: "GET",  url: "/api/marketplace/plugins" },
      { label: "Search",        method: "POST", url: "/api/marketplace/search", body: { query: "search" } },
      { label: "Install",       method: "POST", url: "/api/marketplace/install", body: { plugin_id: "web_search" } },
    ]},
  ]},
  { group: "Sessions & Memory", items: [
    { name: "sessions_ext",   endpoints: [
      { label: "List Sessions", method: "GET",  url: "/api/sessions" },
    ]},
    { name: "memory",         endpoints: [
      { label: "List",          method: "GET",  url: "/api/memory" },
      { label: "Status",        method: "GET",  url: "/api/memory/status" },
      { label: "Store",         method: "POST", url: "/api/memory", body: { key: "demo", value: "Hello Explorer!" } },
      { label: "Search",        method: "POST", url: "/api/memory/search", body: { query: "demo", limit: 5 } },
      { label: "Context",       method: "POST", url: "/api/memory/context", body: { query: "demo", limit: 5 } },
    ]},
  ]},
  { group: "Configuration", items: [
    { name: "config_runtime",   endpoints: [
      { label: "Get Config",    method: "GET",  url: "/api/config" },
      { label: "Schema",        method: "GET",  url: "/api/config/schema" },
    ]},
    { name: "config_hot_reload",endpoints: [
      { label: "Status",        method: "GET",  url: "/api/config/watch" },
    ]},
    { name: "theme",          endpoints: [
      { label: "Get Theme",     method: "GET",  url: "/api/theme" },
    ]},
    { name: "model_fallback", endpoints: [
      { label: "Models",        method: "GET",  url: "/api/models/available" },
    ]},
    { name: "auth",           endpoints: [
      { label: "Auth Status",   method: "GET",  url: "/api/auth" },
    ]},
    { name: "i18n",           endpoints: [
      { label: "Locales",       method: "GET",  url: "/api/i18n/locales" },
      { label: "Strings (EN)",  method: "GET",  url: "/api/i18n/strings/en" },
      { label: "Strings (ES)",  method: "GET",  url: "/api/i18n/strings/es" },
      { label: "Translate",     method: "POST", url: "/api/i18n/translate", body: { key: "app.welcome", locale: "fr" } },
    ]},
  ]},
  { group: "Compute & Execution", items: [
    { name: "jobs",           endpoints: [
      { label: "List Jobs",     method: "GET",  url: "/api/jobs" },
    ]},
    { name: "schedules",      endpoints: [
      { label: "List",          method: "GET",  url: "/api/schedules" },
    ]},
    { name: "workflows",      endpoints: [
      { label: "List",          method: "GET",  url: "/api/workflows" },
    ]},
    { name: "browser_automation", endpoints: [
      { label: "Status",        method: "GET",  url: "/api/browser/status" },
    ]},
    { name: "code_execution", endpoints: [
      { label: "Languages",     method: "GET",  url: "/api/code/languages" },
      { label: "Execute",       method: "POST", url: "/api/code/execute", body: { code: "print('Hello from PraisonAI!')", language: "python" } },
    ]},
  ]},
  { group: "Observability", items: [
    { name: "logs",           endpoints: [
      { label: "Recent Logs",   method: "GET",  url: "/api/logs" },
      { label: "Stats",         method: "GET",  url: "/api/logs/stats" },
      { label: "Levels",        method: "GET",  url: "/api/logs/levels" },
    ]},
    { name: "usage",          endpoints: [
      { label: "Summary",       method: "GET",  url: "/api/usage/summary" },
    ]},
    { name: "nodes",          endpoints: [
      { label: "List Nodes",    method: "GET",  url: "/api/nodes" },
      { label: "Instances",     method: "GET",  url: "/api/nodes/instances" },
    ]},
    { name: "hooks",          endpoints: [
      { label: "List Hooks",    method: "GET",  url: "/api/hooks" },
    ]},
    { name: "guardrails",     endpoints: [
      { label: "Status",        method: "GET",  url: "/api/guardrails/status" },
      { label: "List",          method: "GET",  url: "/api/guardrails" },
      { label: "Violations",    method: "GET",  url: "/api/guardrails/violations" },
    ]},
    { name: "eval",           endpoints: [
      { label: "Status",        method: "GET",  url: "/api/eval/status" },
      { label: "Evaluations",   method: "GET",  url: "/api/eval" },
      { label: "Scores",        method: "GET",  url: "/api/eval/scores" },
      { label: "Judges",        method: "GET",  url: "/api/eval/judges" },
    ]},
    { name: "telemetry",      endpoints: [
      { label: "Status",        method: "GET",  url: "/api/telemetry/status" },
      { label: "Overview",      method: "GET",  url: "/api/telemetry" },
      { label: "Metrics",       method: "GET",  url: "/api/telemetry/metrics" },
      { label: "Performance",   method: "GET",  url: "/api/telemetry/performance" },
      { label: "Profiling",     method: "GET",  url: "/api/telemetry/profiling" },
    ]},
    { name: "tracing",        endpoints: [
      { label: "Status",        method: "GET",  url: "/api/traces/status" },
      { label: "Traces",        method: "GET",  url: "/api/traces" },
      { label: "Spans",         method: "GET",  url: "/api/traces/spans" },
    ]},
    { name: "security",       endpoints: [
      { label: "Status",        method: "GET",  url: "/api/security/status" },
      { label: "Overview",      method: "GET",  url: "/api/security" },
      { label: "Audit Log",     method: "GET",  url: "/api/security/audit" },
      { label: "Config",        method: "GET",  url: "/api/security/config" },
    ]},
  ]},
  { group: "Platform", items: [
    { name: "openai_api",     endpoints: [
      { label: "Models",        method: "GET",  url: "/v1/models" },
    ]},
    { name: "pwa",            endpoints: [
      { label: "Manifest",      method: "GET",  url: "/manifest.json" },
      { label: "PWA Config",    method: "GET",  url: "/api/pwa/config" },
    ]},
    { name: "device_pairing", endpoints: [
      { label: "Create Code",   method: "POST", url: "/api/pairing/create", body: { session_id: "demo-session-" + Date.now() } },
      { label: "Devices",       method: "GET",  url: "/api/pairing/devices?session_id=demo-session" },
    ]},
    { name: "media_analysis", endpoints: [
      { label: "Capabilities",  method: "GET",  url: "/api/media/capabilities" },
    ]},
  ]},
  { group: "System", items: [
    { name: "features",       endpoints: [
      { label: "All Features",  method: "GET",  url: "/api/features" },
      { label: "Pages",         method: "GET",  url: "/api/pages" },
      { label: "Health",        method: "GET",  url: "/api/health" },
    ]},
    { name: "gateway",        endpoints: [
      { label: "Status",        method: "GET",  url: "/api/gateway/status" },
    ]},
    { name: "config",         endpoints: [
      { label: "Get Config",    method: "GET",  url: "/api/config" },
      { label: "Schema",        method: "GET",  url: "/api/config/schema" },
    ]},
  ]},
];

// ── Styles ────────────────────────────────────────────────────
const STYLE = `
  .ex { display:grid; grid-template-columns:300px 1fr 1fr; gap:0; height:calc(100vh - 60px); overflow:hidden; font-family:system-ui,-apple-system,sans-serif; }
  .ex-left { background:#0c0c14; border-right:1px solid rgba(255,255,255,0.06); overflow-y:auto; padding:0; }
  .ex-center { background:#0a0a12; border-right:1px solid rgba(255,255,255,0.06); overflow-y:auto; display:flex; flex-direction:column; }
  .ex-right { background:#0a0a12; overflow-y:auto; padding:20px; }

  /* Left panel */
  .ex-panel-title { padding:16px 20px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#6366f1; border-bottom:1px solid rgba(255,255,255,0.06); position:sticky; top:0; background:#0c0c14; z-index:2; }
  .ex-group { border-bottom:1px solid rgba(255,255,255,0.04); }
  .ex-group-label { padding:10px 20px 6px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.1em; color:#71717a; }
  .ex-feat { padding:6px 20px; }
  .ex-feat-name { font-size:12px; font-weight:500; color:#a1a1aa; margin-bottom:4px; }
  .ex-btns { display:flex; flex-wrap:wrap; gap:4px; }
  .ex-btn {
    font-size:11px; padding:3px 10px; border-radius:6px; border:1px solid rgba(99,102,241,0.2);
    background:rgba(99,102,241,0.08); color:#818cf8; cursor:pointer; transition:all 0.15s;
    display:inline-flex; align-items:center; gap:4px;
  }
  .ex-btn:hover { background:rgba(99,102,241,0.2); border-color:rgba(99,102,241,0.4); color:#a5b4fc; transform:translateY(-1px); }
  .ex-btn.active { background:rgba(99,102,241,0.3); border-color:#6366f1; color:#fff; box-shadow:0 0 12px rgba(99,102,241,0.3); }
  .ex-method { font-size:9px; font-weight:700; padding:1px 4px; border-radius:3px; }
  .ex-method-get { background:rgba(34,197,94,0.15); color:#22c55e; }
  .ex-method-post { background:rgba(234,179,8,0.15); color:#eab308; }

  /* Center panel — activity log */
  .ex-center-title { padding:16px 20px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#22c55e; border-bottom:1px solid rgba(255,255,255,0.06); position:sticky; top:0; background:#0a0a12; z-index:2; display:flex; align-items:center; gap:8px; }
  .ex-center-title .dot { width:8px; height:8px; border-radius:50%; background:#22c55e; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .ex-log { flex:1; padding:12px 16px; font-family:'SF Mono',Monaco,Consolas,monospace; font-size:11.5px; line-height:1.7; }
  .ex-log-entry { padding:8px 12px; border-radius:8px; margin-bottom:8px; animation:slideIn 0.3s ease; }
  @keyframes slideIn { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:none} }
  .ex-log-ts { color:#52525b; font-size:10px; }
  .ex-log-req { background:rgba(99,102,241,0.06); border-left:3px solid #6366f1; }
  .ex-log-gateway { background:rgba(234,179,8,0.06); border-left:3px solid #eab308; color:#fbbf24; }
  .ex-log-res { border-left:3px solid #22c55e; background:rgba(34,197,94,0.06); }
  .ex-log-err { border-left:3px solid #ef4444; background:rgba(239,68,68,0.06); color:#fca5a5; }
  .ex-log-label { font-weight:600; margin-right:6px; }
  .ex-log-url { color:#818cf8; }
  .ex-log-status { padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600; }
  .ex-log-status-ok { background:rgba(34,197,94,0.15); color:#22c55e; }
  .ex-log-status-err { background:rgba(239,68,68,0.15); color:#ef4444; }

  /* Right panel — output */
  .ex-right-title { padding:16px 20px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#f59e0b; border-bottom:1px solid rgba(255,255,255,0.06); position:sticky; top:0; background:#0a0a12; z-index:2; margin:-20px -20px 16px; }
  .ex-output {
    font-family:'SF Mono',Monaco,Consolas,monospace; font-size:12px; line-height:1.6;
    white-space:pre-wrap; word-break:break-all; color:#d4d4d8;
    background:rgba(255,255,255,0.02); border-radius:10px; padding:16px; border:1px solid rgba(255,255,255,0.04);
    min-height:200px;
  }
  .ex-output .key { color:#818cf8; }
  .ex-output .str { color:#22c55e; }
  .ex-output .num { color:#f59e0b; }
  .ex-output .bool { color:#ec4899; }
  .ex-output .null { color:#71717a; }

  /* Stats bar */
  .ex-stats { display:flex; gap:16px; padding:12px 20px; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(99,102,241,0.04); }
  .ex-stat { font-size:11px; color:#a1a1aa; }
  .ex-stat b { color:#e4e4e7; }

  /* Empty states */
  .ex-empty { display:flex; align-items:center; justify-content:center; height:100%; color:#52525b; font-size:13px; text-align:center; padding:40px; }
  .ex-empty-icon { font-size:40px; margin-bottom:12px; }

  /* Run All button */
  .ex-run-all {
    margin:8px 20px 12px; padding:8px 16px; border-radius:8px; border:1px solid rgba(99,102,241,0.3);
    background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.15));
    color:#a5b4fc; cursor:pointer; font-size:12px; font-weight:600; text-align:center;
    transition:all 0.2s;
  }
  .ex-run-all:hover { background:linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.25)); transform:translateY(-1px); box-shadow:0 4px 15px rgba(99,102,241,0.2); }
`;

// ── Syntax-highlighted JSON ──────────────────────────────────
function highlight(json) {
  if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="key">"$1"</span>')
    .replace(/:\s*"([^"]*)"/g, ': <span class="str">"$1"</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="num">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="bool">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="null">$1</span>');
}

// ── Render ────────────────────────────────────────────────────
export async function render(container) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  // Count endpoints
  let totalEndpoints = 0;
  FEATURES.forEach(g => g.items.forEach(f => { totalEndpoints += f.endpoints.length; }));

  container.innerHTML = `
    <div class="ex-stats">
      <div class="ex-stat">Features: <b>${FEATURES.reduce((n,g) => n + g.items.length, 0)}</b></div>
      <div class="ex-stat">Endpoints: <b>${totalEndpoints}</b></div>
      <div class="ex-stat">Calls: <b id="ex-call-count">0</b></div>
      <div class="ex-stat">Errors: <b id="ex-err-count" style="color:#ef4444">0</b></div>
      <div class="ex-stat" style="margin-left:auto;color:#52525b" id="ex-last-time"></div>
    </div>
    <div class="ex">
      <div class="ex-left">
        <div class="ex-panel-title">⚡ Endpoints</div>
        <div class="ex-run-all" id="ex-run-all">▶ Run All Endpoints</div>
        ${FEATURES.map(g => `
          <div class="ex-group">
            <div class="ex-group-label">${g.group}</div>
            ${g.items.map(f => `
              <div class="ex-feat">
                <div class="ex-feat-name">${f.name}</div>
                <div class="ex-btns">
                  ${f.endpoints.map((ep, i) => `
                    <button class="ex-btn" data-feature="${f.name}" data-idx="${i}"
                            data-method="${ep.method}" data-url="${ep.url}"
                            ${ep.body ? `data-body='${JSON.stringify(ep.body)}'` : ''}>
                      <span class="ex-method ex-method-${ep.method.toLowerCase()}">${ep.method}</span>
                      ${ep.label}
                    </button>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
      <div class="ex-center">
        <div class="ex-center-title"><span class="dot"></span> Live Activity</div>
        <div class="ex-log" id="ex-log">
          <div class="ex-empty"><div><div class="ex-empty-icon">📡</div>Click an endpoint to see live gateway activity</div></div>
        </div>
      </div>
      <div class="ex-right">
        <div class="ex-right-title">📤 Response Output</div>
        <div class="ex-output" id="ex-output"><div class="ex-empty"><div><div class="ex-empty-icon">🔍</div>Response JSON will appear here</div></div></div>
      </div>
    </div>
  `;

  // ── State ──
  let callCount = 0, errCount = 0, logEntries = 0;
  const logEl = document.getElementById('ex-log');
  const outputEl = document.getElementById('ex-output');
  const callCountEl = document.getElementById('ex-call-count');
  const errCountEl = document.getElementById('ex-err-count');
  const lastTimeEl = document.getElementById('ex-last-time');
  let activeBtn = null;

  function ts() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  }

  function addLog(type, html) {
    if (logEntries === 0) logEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = `ex-log-entry ex-log-${type}`;
    div.innerHTML = `<span class="ex-log-ts">${ts()}</span> ${html}`;
    logEl.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
    logEntries++;
  }

  // ── Call endpoint ──
  async function callEndpoint(method, url, body, btn) {
    // Mark active
    if (activeBtn) activeBtn.classList.remove('active');
    if (btn) { btn.classList.add('active'); activeBtn = btn; }

    callCount++;
    callCountEl.textContent = callCount;

    // Log: request
    addLog('req',
      `<span class="ex-log-label">→ REQUEST</span> ` +
      `<span class="ex-method ex-method-${method.toLowerCase()}">${method}</span> ` +
      `<span class="ex-log-url">${url}</span>` +
      (body ? `<br><span style="color:#71717a;margin-left:12px">Body: ${JSON.stringify(body)}</span>` : '')
    );

    // Log: gateway processing
    addLog('gateway',
      `<span class="ex-log-label">⚙ GATEWAY</span> ` +
      `Routing to feature handler → processing...`
    );

    const t0 = performance.now();
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body && method !== 'GET') opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const elapsed = (performance.now() - t0).toFixed(1);
      lastTimeEl.textContent = `${elapsed}ms`;

      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('javascript') || ct.includes('html') || ct.includes('css')) {
        const text = await res.text();
        data = { _content_type: ct, _length: text.length, _preview: text.substring(0, 300) + (text.length > 300 ? '...' : '') };
      } else {
        try { data = await res.json(); } catch { data = { _raw: await res.text() }; }
      }

      const statusClass = res.ok ? 'ok' : 'err';
      if (!res.ok) { errCount++; errCountEl.textContent = errCount; }

      // Log: response
      addLog('res',
        `<span class="ex-log-label">← RESPONSE</span> ` +
        `<span class="ex-log-status ex-log-status-${statusClass}">${res.status} ${res.statusText}</span> ` +
        `<span style="color:#52525b">${elapsed}ms</span>` +
        `<br><span style="color:#71717a;margin-left:12px">${Object.keys(data).length} keys returned</span>`
      );

      // Output panel
      outputEl.innerHTML = highlight(data);
    } catch (err) {
      errCount++;
      errCountEl.textContent = errCount;
      addLog('err',
        `<span class="ex-log-label">✗ ERROR</span> ${err.message}`
      );
      outputEl.innerHTML = `<span style="color:#ef4444">${err.message}</span>`;
    }
  }

  // ── Event delegation ──
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.ex-btn');
    if (btn) {
      const method = btn.dataset.method;
      const url = btn.dataset.url;
      const body = btn.dataset.body ? JSON.parse(btn.dataset.body) : null;
      callEndpoint(method, url, body, btn);
    }
  });

  // ── Run All ──
  document.getElementById('ex-run-all').addEventListener('click', async () => {
    const btns = container.querySelectorAll('.ex-btn');
    addLog('gateway', `<span class="ex-log-label">▶ RUN ALL</span> Executing ${btns.length} endpoints sequentially...`);
    for (const btn of btns) {
      const method = btn.dataset.method;
      const url = btn.dataset.url;
      const body = btn.dataset.body ? JSON.parse(btn.dataset.body) : null;
      await callEndpoint(method, url, body, btn);
      await new Promise(r => setTimeout(r, 150)); // slight delay for visual effect
    }
    addLog('res', `<span class="ex-log-label">✓ COMPLETE</span> All ${btns.length} endpoints executed. ${errCount} errors.`);
  });
}
