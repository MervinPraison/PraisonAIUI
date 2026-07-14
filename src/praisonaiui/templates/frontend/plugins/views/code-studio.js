/**
 * Code Studio View — VS Code-lite in-dashboard IDE.
 * Write code, run in sandbox, view output, and send snippets to chat.
 * API: GET /api/code/languages, POST /api/code/execute
 */
import { helpBanner } from '/plugins/views/_helpers.js';

const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs';
const HISTORY_MAX = 10;
const SNIPPET_KEY = 'aiui_snippets';
const OUTPUT_MAX = 200000;

const DEFAULT_CODE = {
  python: "print('hello from Code Studio')\n",
  javascript: "console.log('hello from Code Studio');\n",
  bash: "echo 'hello from Code Studio'\n",
};

const MONACO_LANG = { python: 'python', javascript: 'javascript', bash: 'shell' };
const FILE_EXT = { python: 'py', javascript: 'js', bash: 'sh' };

let editor = null;
let monacoNs = null;
let running = false;
let timerId = null;
const history = [];

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function currentCode() {
  if (editor && typeof editor.getValue === 'function') return editor.getValue();
  const ta = document.getElementById('cs-fallback');
  return ta ? ta.value : '';
}

function setCode(code) {
  if (editor && typeof editor.setValue === 'function') editor.setValue(code);
  else { const ta = document.getElementById('cs-fallback'); if (ta) ta.value = code; }
}

function setEditorLanguage(lang) {
  if (monacoNs && editor) {
    const model = editor.getModel();
    if (model) monacoNs.editor.setModelLanguage(model, MONACO_LANG[lang] || 'plaintext');
  }
}

async function loadMonaco(host, lang) {
  if (window.monaco) monacoNs = window.monaco;
  if (!monacoNs) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MONACO_CDN + '/loader.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    if (!window.require) throw new Error('Monaco loader unavailable');
    window.require.config({ paths: { vs: MONACO_CDN } });
    monacoNs = await new Promise((resolve, reject) => {
      try { window.require(['vs/editor/editor.main'], () => resolve(window.monaco)); }
      catch (e) { reject(e); }
    });
  }
  editor = monacoNs.editor.create(host, {
    value: DEFAULT_CODE[lang] || '',
    language: MONACO_LANG[lang] || 'plaintext',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono','SF Mono',Monaco,Consolas,monospace",
    lineNumbers: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
  });
}

function mountFallback(host, lang) {
  host.innerHTML = `<textarea id="cs-fallback" spellcheck="false"
    style="width:100%;height:100%;box-sizing:border-box;resize:none;border:0;outline:none;padding:12px;background:#1e1e1e;color:#d4d4d4;font-family:'JetBrains Mono','SF Mono',Monaco,Consolas,monospace;font-size:13px;line-height:1.5">${escapeHtml(DEFAULT_CODE[lang] || '')}</textarea>`;
}

function pickTab(container, tab) {
  container.querySelectorAll('.cs-tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.style.color = on ? 'var(--db-text,#e4e4e7)' : 'var(--db-text-dim,#a1a1aa)';
    b.style.borderBottom = on ? '2px solid var(--db-accent,#6366f1)' : '2px solid transparent';
  });
  container.querySelectorAll('.cs-tab-panel').forEach((p) => {
    p.style.display = p.dataset.panel === tab ? 'block' : 'none';
  });
}

function truncate(text) {
  const s = String(text == null ? '' : text);
  if (s.length <= OUTPUT_MAX) return { text: s, truncated: false };
  return { text: s.slice(0, OUTPUT_MAX), truncated: true };
}

function renderOutput(container, result) {
  const out = result.output != null ? result.output : (result.stdout || '');
  const err = result.error != null ? result.error : (result.stderr || '');
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const failed = ['error', 'failed', 'degraded'].includes(result.status);

  const banner = container.querySelector('#cs-banner');
  if (failed) {
    banner.style.display = 'flex';
    const code = result.exit_code != null ? ` (exit ${result.exit_code})` : '';
    banner.querySelector('#cs-banner-text').textContent = `Execution ${result.status}${code}`;
  } else {
    banner.style.display = 'none';
  }

  const o = truncate(out);
  const e = truncate(err);
  container.querySelector('#cs-out-body').innerHTML =
    `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;color:#22c55e">${escapeHtml(o.text) || '<span style="color:#71717a">(no output)</span>'}</pre>` +
    (o.truncated ? '<div style="color:#71717a;font-size:11px;margin-top:6px">Output truncated</div>' : '');
  container.querySelector('#cs-err-body').innerHTML =
    `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;color:#ef4444">${escapeHtml(e.text) || '<span style="color:#71717a">(no errors)</span>'}</pre>` +
    (e.truncated ? '<div style="color:#71717a;font-size:11px;margin-top:6px">Output truncated</div>' : '');
  container.querySelector('#cs-art-body').innerHTML = artifacts.length
    ? `<pre style="margin:0;white-space:pre-wrap">${escapeHtml(JSON.stringify(artifacts, null, 2))}</pre>`
    : '<span style="color:#71717a">(no artifacts)</span>';

  pickTab(container, failed && err ? 'errors' : 'output');
}

function renderHistory(container) {
  const list = container.querySelector('#cs-history');
  if (!history.length) {
    list.innerHTML = '<div style="color:#71717a;font-size:12px;padding:8px">No runs yet</div>';
    return;
  }
  list.innerHTML = history.map((h, i) => {
    const ok = !['error', 'failed', 'degraded'].includes(h.result.status);
    const icon = ok ? '<span style="color:#22c55e">●</span>' : '<span style="color:#ef4444">●</span>';
    const dur = h.duration != null ? `${(h.duration / 1000).toFixed(1)}s` : '';
    return `<div class="cs-history-row" data-idx="${i}" style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;cursor:pointer;font-size:12px" onmouseover="this.style.background='rgba(255,255,255,.05)'" onmouseout="this.style.background='transparent'">
      ${icon}<span style="flex:1">${escapeHtml(h.language)}</span><span style="color:#71717a">${dur}</span></div>`;
  }).join('');
  list.querySelectorAll('.cs-history-row').forEach((row) => {
    row.addEventListener('click', () => {
      const h = history[Number(row.dataset.idx)];
      if (!h) return;
      const sel = container.querySelector('#cs-language');
      if (sel) { sel.value = h.language; setEditorLanguage(h.language); }
      setCode(h.code);
      renderOutput(container, h.result);
    });
  });
}

function pushHistory(container, entry) {
  history.unshift(entry);
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  renderHistory(container);
}

async function runCode(container) {
  if (running) return;
  const code = currentCode();
  if (!code.trim()) {
    alert('Enter code to run');
    return;
  }
  const lang = container.querySelector('#cs-language').value;
  const runBtn = container.querySelector('#cs-run');
  running = true;
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';
  const start = Date.now();
  timerId = setInterval(() => {
    runBtn.textContent = `Executing… ${((Date.now() - start) / 1000).toFixed(1)}s`;
  }, 100);

  let result;
  try {
    const res = await fetch('/api/code/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, code, timeout: 30 }),
    });
    result = await res.json();
  } catch (e) {
    result = { status: 'failed', error: String(e), language: lang };
  } finally {
    running = false;
    clearInterval(timerId);
    timerId = null;
    runBtn.disabled = false;
    runBtn.textContent = '▶ Run';
  }

  const duration = result.duration_ms != null ? result.duration_ms : (Date.now() - start);
  renderOutput(container, result);
  pushHistory(container, { language: lang, code, result, duration });
}

function saveSnippet(container) {
  const code = currentCode();
  const lang = container.querySelector('#cs-language').value;
  try {
    const raw = localStorage.getItem(SNIPPET_KEY);
    const snippets = raw ? JSON.parse(raw) : [];
    snippets.push({ language: lang, code, ts: Date.now() });
    localStorage.setItem(SNIPPET_KEY, JSON.stringify(snippets));
    const btn = container.querySelector('#cs-save');
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  } catch (e) {
    alert('Could not save snippet (storage full)');
  }
}

function sendToAgent(container) {
  const code = currentCode();
  const lang = container.querySelector('#cs-language').value;
  const text = '```' + lang + '\n' + code + '\n```\nPlease review this code.';
  if (window.aiui && typeof window.aiui.selectPage === 'function') {
    Promise.resolve(window.aiui.selectPage('chat')).then(() => {
      window.dispatchEvent(new CustomEvent('aiui:prefill-composer', { detail: { text } }));
    });
  } else {
    window.dispatchEvent(new CustomEvent('aiui:prefill-composer', { detail: { text } }));
  }
}

export async function render(container) {
  container.setAttribute('data-page', 'code-studio');

  let languages = [];
  try {
    const r = await fetch('/api/code/languages');
    const d = await r.json();
    languages = d.languages || [];
  } catch (e) {}
  if (!languages.length) {
    languages = [{ id: 'python', name: 'Python' }, { id: 'javascript', name: 'JavaScript' }, { id: 'bash', name: 'Bash' }];
  }
  const firstLang = languages[0].id;

  const langOptions = languages
    .map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name || l.id)}</option>`)
    .join('');

  container.innerHTML = helpBanner({
    title: 'Code Studio',
    what: 'Write code, run it in a sandbox, inspect output, and hand snippets to your agent.',
    howToUse: 'Pick a language, edit the code, then click Run. Use "Send to Agent" to continue in chat.',
    tip: 'Code runs server-side in a sandbox — never in your browser.',
    collapsed: true,
  }) + `
    <div class="cs-root" style="display:flex;gap:12px;height:calc(100vh - 220px);min-height:480px">
      <div style="flex:1;display:flex;flex-direction:column;border:1px solid var(--db-border);border-radius:10px;overflow:hidden;background:#1e1e1e">
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#18181b;border-bottom:1px solid var(--db-border);flex-wrap:wrap">
          <select id="cs-language" style="padding:6px 10px;background:var(--db-card-bg);color:var(--db-text);border:1px solid var(--db-border);border-radius:6px;font-size:13px">${langOptions}</select>
          <input id="cs-filename" type="text" value="script.${FILE_EXT[firstLang] || 'txt'}" style="padding:6px 10px;background:var(--db-card-bg);color:var(--db-text);border:1px solid var(--db-border);border-radius:6px;font-size:13px;width:140px" />
          <button id="cs-run" style="padding:6px 16px;background:#22c55e;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">▶ Run</button>
          <button id="cs-save" style="padding:6px 14px;background:transparent;color:var(--db-text);border:1px solid var(--db-border);border-radius:6px;cursor:pointer;font-size:13px">Save</button>
        </div>
        <div id="cs-editor" style="flex:3;min-height:180px"></div>
        <div style="flex:2;display:flex;flex-direction:column;border-top:1px solid var(--db-border);background:#0d1117;min-height:120px">
          <div id="cs-banner" style="display:none;align-items:center;gap:10px;padding:8px 12px;background:rgba(239,68,68,.12);border-bottom:1px solid rgba(239,68,68,.3);font-size:12px">
            <span id="cs-banner-text" style="color:#ef4444;flex:1"></span>
            <button id="cs-fix" style="padding:4px 12px;background:transparent;color:#ef4444;border:1px solid rgba(239,68,68,.4);border-radius:6px;cursor:pointer;font-size:12px">Ask agent to fix</button>
          </div>
          <div style="display:flex;gap:4px;padding:0 8px;border-bottom:1px solid var(--db-border)">
            <button class="cs-tab" data-tab="output" style="padding:8px 12px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--db-text-dim,#a1a1aa);cursor:pointer;font-size:12px">Output</button>
            <button class="cs-tab" data-tab="errors" style="padding:8px 12px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--db-text-dim,#a1a1aa);cursor:pointer;font-size:12px">Errors</button>
            <button class="cs-tab" data-tab="artifacts" style="padding:8px 12px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--db-text-dim,#a1a1aa);cursor:pointer;font-size:12px">Artifacts</button>
          </div>
          <div style="flex:1;overflow:auto;padding:12px;font-family:'JetBrains Mono','SF Mono',Monaco,Consolas,monospace;font-size:12px">
            <div class="cs-tab-panel" data-panel="output" id="cs-out-body"><span style="color:#71717a">Run code to see output</span></div>
            <div class="cs-tab-panel" data-panel="errors" id="cs-err-body" style="display:none"></div>
            <div class="cs-tab-panel" data-panel="artifacts" id="cs-art-body" style="display:none"></div>
          </div>
        </div>
      </div>
      <div style="width:240px;display:flex;flex-direction:column;gap:12px">
        <div style="border:1px solid var(--db-border);border-radius:10px;padding:12px;background:var(--db-card-bg)">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px">History</div>
          <div id="cs-history"></div>
        </div>
        <div style="border:1px solid var(--db-border);border-radius:10px;padding:12px;background:var(--db-card-bg);font-size:12px;color:var(--db-text-dim)">
          <div style="font-weight:600;color:var(--db-text);margin-bottom:6px">Environment</div>
          <div>Timeout: 30s</div>
          <div>Sandbox: server-side</div>
        </div>
        <button id="cs-send-agent" style="padding:10px;background:var(--db-accent,#6366f1);color:#fff;border:0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600">→ Send to Agent</button>
      </div>
    </div>
  `;

  const editorHost = container.querySelector('#cs-editor');
  try {
    await loadMonaco(editorHost, firstLang);
  } catch (e) {
    console.warn('[code-studio] Monaco load failed, using fallback textarea:', e);
    mountFallback(editorHost, firstLang);
  }

  renderHistory(container);
  pickTab(container, 'output');

  const langSel = container.querySelector('#cs-language');
  langSel.addEventListener('change', () => {
    const lang = langSel.value;
    setEditorLanguage(lang);
    const fn = container.querySelector('#cs-filename');
    if (fn) fn.value = `script.${FILE_EXT[lang] || 'txt'}`;
  });

  container.querySelector('#cs-run').addEventListener('click', () => runCode(container));
  container.querySelector('#cs-save').addEventListener('click', () => saveSnippet(container));
  container.querySelector('#cs-send-agent').addEventListener('click', () => sendToAgent(container));
  container.querySelector('#cs-fix').addEventListener('click', () => sendToAgent(container));

  container.querySelectorAll('.cs-tab').forEach((b) => {
    b.addEventListener('click', () => pickTab(container, b.dataset.tab));
  });
}

export function cleanup() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  if (editor && typeof editor.dispose === 'function') { try { editor.dispose(); } catch (e) {} }
  editor = null;
  running = false;
}
