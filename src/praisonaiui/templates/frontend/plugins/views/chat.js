/**
 * Chat View — Real-time agent chat with streaming, markdown, and tool display.
 *
 * Features: WebSocket streaming, HTTP fallback, session management,
 *           agent selection, tool call display, markdown rendering,
 *           focus mode, message queue indicator, abort support.
 *
 * Protocol-driven: connects to /api/chat/ws or /api/chat/send.
 * Config-driven: auto-discovers agents and sessions from existing APIs.
 */

// ── State ────────────────────────────────────────────────────────
let ws = null;
let currentSessionId = null;
let currentAgentName = null;
let isStreaming = false;
let streamingSessionId = null;  // tracks which session is actively streaming
let currentRunId = null;
let agents = [];
let messageQueue = [];
let focusMode = false;
let containerRef = null;
let currentDeltaEl = null;
let currentDeltaText = '';
let pendingAttachments = [];  // { id, filename, content_type, preview_url }

// ── Helpers ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // ── 1. Extract code blocks into placeholders ─────────────────
  // This prevents the global \n→<br> conversion from corrupting
  // newlines inside <pre><code> (which highlight.js needs intact).
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
    const langLabel = lang || 'code';
    const codeId = 'code-' + Math.random().toString(36).substr(2, 8);
    const block = '<div class="chat-code-wrapper">' +
      '<div class="chat-code-header">' +
        '<span class="chat-code-lang">' + escapeHtml(langLabel) + '</span>' +
        '<button class="chat-code-copy" data-code-id="' + codeId + '" onclick="(function(btn){var c=document.getElementById(\'' + codeId + '\');if(c){navigator.clipboard.writeText(c.textContent).then(function(){btn.textContent=\'Copied!\';setTimeout(function(){btn.textContent=\'Copy\'},1500)})}})( this)">Copy</button>' +
      '</div>' +
      '<pre class="chat-code-block"><code id="' + codeId + '" class="language-' + escapeHtml(lang || 'plaintext') + '">' + code + '</code></pre>' +
    '</div>';
    const placeholder = '\x00CB' + codeBlocks.length + '\x00';
    codeBlocks.push(block);
    return placeholder;
  });

  // ── 2. Process all other markdown (operates on non-code text) ─
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
  // Headers (must be before bold/italic — process line by line)
  html = html.replace(/^#### (.+)$/gm, '<h4 style="font-size:14px;font-weight:600;margin:12px 0 4px">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:14px 0 6px">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:17px;font-weight:600;margin:16px 0 6px">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:700;margin:18px 0 8px">$1</h1>');
  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--db-border,#333);margin:12px 0">');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Unordered list items (- item)
  html = html.replace(/^- (.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
  // Ordered list items (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal">$1</li>');
  // Wrap consecutive <li> elements in <ul>/<ol>
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="padding-left:8px;margin:4px 0">$1</ul>');
  // Line breaks (only affects non-code text now)
  html = html.replace(/\n/g, '<br>');
  // Clean up <br> right after block elements
  html = html.replace(/(<\/h[1-4]>)<br>/g, '$1');
  html = html.replace(/(<\/li>)<br>/g, '$1');
  html = html.replace(/(<\/ul>)<br>/g, '$1');
  html = html.replace(/(<hr[^>]*>)<br>/g, '$1');

  // ── 3. Restore code blocks ───────────────────────────────────
  for (var i = 0; i < codeBlocks.length; i++) {
    html = html.replace('\x00CB' + i + '\x00', codeBlocks[i]);
  }
  // Clean up any <br> adjacent to restored code block wrappers
  html = html.replace(/<br>(\s*<div class="chat-code-wrapper">)/g, '$1');
  html = html.replace(/(<\/div>)\s*<br>/g, '$1');

  return html;
}

/** Load highlight.js from CDN (once) */
let _hljsLoaded = false;
function loadHighlightJs() {
  if (_hljsLoaded) return;
  _hljsLoaded = true;
  // CSS theme — github-dark matches the dashboard aesthetic
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
  document.head.appendChild(link);
  // JS library
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
  script.onload = function() {
    // Highlight any existing code blocks
    highlightCodeBlocks(document);
  };
  document.head.appendChild(script);
}

/** Apply highlight.js to all unhighlighted code blocks within a root element */
function highlightCodeBlocks(root) {
  if (typeof hljs === 'undefined') return;
  const blocks = (root || document).querySelectorAll('pre.chat-code-block code:not(.hljs)');
  blocks.forEach(function(block) {
    hljs.highlightElement(block);
  });
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return d.toLocaleDateString();
}

// ── Inject CSS ──────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('chat-view-styles')) return;
  loadHighlightJs();
  const style = document.createElement('style');
  style.id = 'chat-view-styles';
  style.textContent = `
    .chat-root { display:flex; height:calc(100vh - 140px); gap:0; border-radius:12px; overflow:hidden; border:1px solid var(--db-border); background:var(--db-card-bg); }
    .chat-root.focus-mode .chat-sidebar-panel { display:none; }
    .chat-root.focus-mode .chat-main-panel { border-left:none; }

    .chat-sidebar-panel { width:260px; min-width:260px; background:var(--db-sidebar-bg,var(--db-card-bg)); border-right:1px solid var(--db-border); display:flex; flex-direction:column; }
    .chat-sidebar-head { padding:14px 16px; border-bottom:1px solid var(--db-border); display:flex; align-items:center; justify-content:space-between; }
    .chat-sidebar-head h3 { margin:0; font-size:15px; font-weight:600; }
    .chat-sidebar-agent { padding:10px 16px; border-bottom:1px solid var(--db-border); }
    .chat-sidebar-agent label { font-size:11px; color:var(--db-text-dim); display:block; margin-bottom:4px; text-transform:uppercase; font-weight:600; letter-spacing:.5px; }
    .chat-sidebar-agent select { width:100%; padding:6px 10px; background:var(--db-card-bg); border:1px solid var(--db-border); border-radius:6px; color:var(--db-text); font-size:13px; }
    .chat-sess-list { flex:1; overflow-y:auto; padding:8px; }
    .chat-sess-item { padding:10px 12px; border-radius:8px; cursor:pointer; margin-bottom:4px; font-size:13px; transition:background .15s; display:flex; flex-direction:column; gap:2px; }
    .chat-sess-item:hover { background:rgba(var(--db-accent-rgb,100,100,255),.08); }
    .chat-sess-item.active { background:rgba(var(--db-accent-rgb,100,100,255),.15); }
    .chat-sess-item .sess-title { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .chat-sess-item .sess-meta { font-size:11px; color:var(--db-text-dim); }

    .chat-main-panel { flex:1; display:flex; flex-direction:column; min-width:0; }
    .chat-top-bar { padding:10px 16px; border-bottom:1px solid var(--db-border); display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .chat-top-info { display:flex; align-items:center; gap:10px; min-width:0; }
    .chat-top-title { font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .chat-top-title svg { width:16px; height:16px; vertical-align:middle; }
    .chat-status-badge { font-size:11px; padding:2px 8px; border-radius:10px; background:rgba(34,197,94,.15); color:#22c55e; }
    .chat-status-badge.disconnected { background:rgba(239,68,68,.15); color:#ef4444; }
    .chat-status-badge.streaming { background:rgba(59,130,246,.15); color:#3b82f6; }
    .chat-status-badge.error { background:rgba(239,68,68,.15); color:#ef4444; }
    .chat-queue-badge { font-size:11px; padding:2px 8px; border-radius:10px; background:rgba(234,179,8,.15); color:#eab308; display:none; }
    .chat-top-actions { display:flex; gap:6px; align-items:center; flex-shrink:0; }
    .chat-icon-btn { background:none; border:1px solid var(--db-border); border-radius:6px; padding:4px 10px; cursor:pointer; font-size:12px; color:var(--db-text); transition:all .15s; }
    .chat-icon-btn:hover { background:rgba(var(--db-accent-rgb,100,100,255),.1); border-color:var(--db-accent); }
    .chat-icon-btn.active { background:var(--db-accent); color:#fff; border-color:var(--db-accent); }
    .chat-icon-btn.danger { color:#ef4444; border-color:rgba(239,68,68,.3); }
    .chat-icon-btn.danger:hover { background:rgba(239,68,68,.1); }

    .chat-messages-area { flex:1; overflow-y:auto; padding:20px; }
    .chat-welcome-box { text-align:center; padding:60px 20px; }
    .chat-welcome-box .icon { font-size:48px; margin-bottom:12px; }
    .chat-welcome-box h2 { margin:0 0 8px; font-size:22px; font-weight:700; }
    .chat-welcome-box p { margin:0; color:var(--db-text-dim); font-size:14px; }

    .chat-msg { display:flex; gap:10px; margin-bottom:16px; max-width:85%; }
    .chat-msg-user { margin-left:auto; flex-direction:row-reverse; }
    .chat-msg-avatar { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; background:var(--db-border); }
    .chat-msg-body { min-width:0; }
    .chat-msg-agent-name { font-size:11px; font-weight:600; color:var(--db-accent); margin-bottom:2px; }
    .chat-msg-content { background:var(--db-sidebar-bg,rgba(0,0,0,.05)); padding:10px 14px; border-radius:12px; font-size:13.5px; line-height:1.6; word-break:break-word; }
    .chat-msg-user .chat-msg-content { background:var(--db-accent); color:#fff; }
    .chat-msg-streaming .chat-msg-content::after { content:'▌'; animation:blink 1s infinite; }
    @keyframes blink { 50% { opacity:0; } }

    .chat-code-wrapper { margin:8px 0; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,.08); }
    .chat-code-header { display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:rgba(0,0,0,.3); font-size:12px; }
    .chat-code-lang { color:var(--db-text-dim,#999); font-weight:600; text-transform:lowercase; font-family:'SF Mono',Monaco,Consolas,monospace; }
    .chat-code-copy { background:transparent; border:1px solid rgba(255,255,255,.15); border-radius:4px; padding:2px 10px; color:var(--db-text-dim,#999); font-size:11px; cursor:pointer; transition:all .15s; font-family:inherit; }
    .chat-code-copy:hover { background:rgba(255,255,255,.1); color:var(--db-text,#fff); }
    .chat-msg-content pre.chat-code-block { background:rgba(0,0,0,.2); padding:12px 14px; margin:0; overflow-x:auto; font-size:13px; line-height:1.6; }
    .chat-msg-content pre.chat-code-block code { font-family:'SF Mono',Monaco,Consolas,monospace; font-size:13px; background:transparent !important; padding:0 !important; }
    .chat-msg-content code.chat-inline-code { background:rgba(0,0,0,.15); padding:2px 6px; border-radius:4px; font-size:12px; font-family:'SF Mono',Monaco,Consolas,monospace; }
    .chat-msg-content a { color:var(--db-accent); text-decoration:underline; }

    .chat-tool-call { margin:6px 0; padding:10px 16px; border-left:3px solid rgba(var(--db-accent-rgb,100,100,255),.4); background:rgba(var(--db-accent-rgb,100,100,255),.04); border-radius:0 10px 10px 0; font-size:13px; transition:all .3s ease; cursor:pointer; }
    .chat-tool-call:hover { background:rgba(var(--db-accent-rgb,100,100,255),.08); }
    .chat-tool-header { display:flex; align-items:center; gap:8px; }
    .chat-tool-step { font-weight:700; color:var(--db-text-dim); font-size:11px; text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; }
    .chat-tool-desc { font-weight:500; flex:1; color:var(--db-text); }
    .chat-tool-badge { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; padding:2px 10px; border-radius:20px; white-space:nowrap; }
    .chat-tool-chevron { font-size:10px; color:var(--db-text-dim); transition:transform .2s ease; margin-left:4px; }
    .chat-tool-call.expanded .chat-tool-chevron { transform:rotate(90deg); }
    .chat-tool-running .chat-tool-badge { background:rgba(245,158,11,.12); color:#f59e0b; }
    .chat-tool-running { border-left-color:#f59e0b; }
    .chat-tool-done .chat-tool-badge { background:rgba(34,197,94,.12); color:#22c55e; }
    .chat-tool-done { border-left-color:#22c55e; }
    .chat-tool-badge .tool-spinner { width:10px; height:10px; border:2px solid rgba(245,158,11,.25); border-top-color:#f59e0b; border-radius:50%; animation:spin .7s linear infinite; }
    .chat-tool-details { display:none; margin-top:8px; padding:8px 12px; background:rgba(0,0,0,.12); border-radius:8px; font-size:12px; max-height:600px; overflow-y:auto; }
    .chat-tool-call.expanded .chat-tool-details { display:block; }
    .chat-tool-details pre { margin:0; white-space:pre-wrap; word-break:break-word; color:var(--db-text-dim); font-size:11px; line-height:1.5; }
    .chat-tool-details .tool-detail-label { font-weight:600; color:var(--db-text); font-size:11px; text-transform:uppercase; letter-spacing:.3px; margin-bottom:4px; }
    .chat-tool-details .tool-detail-section { margin-bottom:8px; }
    .chat-tool-details .tool-detail-section:last-child { margin-bottom:0; }

    .chat-reasoning { margin:6px 0; padding:8px 12px; background:rgba(234,179,8,.08); border-radius:8px; font-size:12px; color:var(--db-text-dim); font-style:italic; }

    .chat-ask-widget { margin:10px 0; padding:14px 16px; border:1px solid rgba(234,179,8,.3); background:rgba(234,179,8,.06); border-radius:12px; max-width:85%; }
    .chat-ask-question { font-size:13.5px; font-weight:600; margin-bottom:10px; color:var(--db-text); }
    .chat-ask-question::before { content:'❓ '; }
    .chat-ask-options { display:flex; flex-wrap:wrap; gap:6px; }
    .chat-ask-option { padding:6px 16px; background:rgba(var(--db-accent-rgb,100,100,255),.12); color:var(--db-accent); border:1px solid rgba(var(--db-accent-rgb,100,100,255),.25); border-radius:8px; cursor:pointer; font-size:13px; transition:all .15s; }
    .chat-ask-option:hover { background:var(--db-accent); color:#fff; }
    .chat-ask-input-row { display:flex; gap:6px; }
    .chat-ask-input { flex:1; padding:8px 12px; border:1px solid var(--db-border); border-radius:8px; background:var(--db-sidebar-bg,var(--db-card-bg)); color:var(--db-text); font-size:13px; outline:none; }
    .chat-ask-input:focus { border-color:var(--db-accent); }
    .chat-ask-submit { padding:8px 14px; background:var(--db-accent); color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600; }
    .chat-ask-answered { opacity:.5; pointer-events:none; }

    .chat-memory-indicator { margin:6px 0; padding:6px 12px; background:rgba(147,51,234,.06); border:1px solid rgba(147,51,234,.15); border-radius:8px; font-size:12px; color:rgba(147,51,234,.8); display:flex; align-items:center; gap:6px; }
    .chat-memory-indicator .spinner { width:12px; height:12px; border:2px solid rgba(147,51,234,.2); border-top-color:rgba(147,51,234,.7); border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .chat-memory-done { opacity:.5; }

    .chat-metrics { display:flex; gap:12px; padding:4px 12px; font-size:11px; color:var(--db-text-dim); }
    .chat-metrics span { display:flex; align-items:center; gap:4px; }

    .chat-memory-panel { display:none; border-bottom:1px solid var(--db-border); background:var(--db-sidebar-bg,var(--db-card-bg)); max-height:300px; overflow-y:auto; padding:10px 14px; font-size:13px; }
    .chat-memory-panel.open { display:block; }
    .chat-memory-panel-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    .chat-memory-panel-header h4 { margin:0; font-size:13px; font-weight:600; color:var(--db-text); }
    .chat-memory-panel-actions { display:flex; gap:6px; }
    .chat-memory-panel-actions button { padding:3px 8px; font-size:11px; border:1px solid var(--db-border); border-radius:6px; background:transparent; color:var(--db-text-dim); cursor:pointer; }
    .chat-memory-panel-actions button:hover { background:rgba(147,51,234,.1); color:rgba(147,51,234,.9); }
    .chat-mem-item { padding:6px 8px; border:1px solid var(--db-border); border-radius:6px; margin-bottom:4px; font-size:12px; line-height:1.4; }
    .chat-mem-item .mem-type { font-size:10px; color:rgba(147,51,234,.7); font-weight:600; text-transform:uppercase; margin-bottom:2px; }
    .chat-mem-item .mem-text { color:var(--db-text); }
    .chat-mem-empty { color:var(--db-text-dim); font-style:italic; font-size:12px; }

    .chat-channel-badge { display:inline-flex; align-items:center; gap:4px; font-size:10px; padding:1px 6px; border-radius:6px; background:rgba(var(--db-accent-rgb,100,100,255),.1); color:var(--db-accent); font-weight:600; text-transform:uppercase; letter-spacing:.3px; }
    .chat-msg-channel .chat-msg-content { border-left:3px solid var(--db-accent); background:rgba(var(--db-accent-rgb,100,100,255),.04); }
    .chat-msg-channel .chat-msg-avatar { font-size:14px; }
    .chat-msg-channel .chat-msg-avatar svg { width:18px; height:18px; }
    .chat-msg-channel .chat-msg-avatar.plat-telegram { background:rgba(0,136,204,.2); color:#0088cc; }
    .chat-msg-channel .chat-msg-avatar.plat-slack { background:rgba(74,21,75,.15); color:#4A154B; }
    .chat-msg-channel .chat-msg-avatar.plat-discord { background:rgba(88,101,242,.2); color:#5865F2; }
    .chat-msg-channel .chat-msg-avatar.plat-whatsapp { background:rgba(37,211,102,.15); color:#25d366; }
    .chat-msg-channel .chat-msg-avatar.plat-signal { background:rgba(59,134,247,.15); color:#3b86f7; }
    .chat-msg-channel .chat-msg-avatar.plat-default { background:rgba(var(--db-accent-rgb,100,100,255),.15); }
    .chat-msg-channel-sender { font-size:11px; font-weight:600; color:var(--db-text-dim); margin-bottom:2px; display:flex; align-items:center; gap:6px; }
    .chat-sess-item .sess-platform-icon { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:4px; margin-right:4px; vertical-align:middle; }
    .chat-sess-item .sess-platform-icon svg { width:12px; height:12px; }
    .chat-sess-item .sess-platform-badge { font-size:10px; padding:1px 5px; border-radius:4px; background:rgba(var(--db-accent-rgb,100,100,255),.1); color:var(--db-accent); font-weight:600; }
    .chat-sess-item .sess-unread { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--db-accent); margin-left:4px; animation:blink 1.5s infinite; }

    .chat-compose { padding:14px 16px; border-top:1px solid var(--db-border); }
    .chat-compose-row { display:flex; gap:8px; align-items:flex-end; }
    .chat-compose textarea { flex:1; resize:none; padding:10px 14px; background:var(--db-sidebar-bg,var(--db-card-bg)); border:1px solid var(--db-border); border-radius:10px; color:var(--db-text); font-size:14px; font-family:inherit; line-height:1.5; max-height:150px; outline:none; transition:border .15s; }
    .chat-compose textarea:focus { border-color:var(--db-accent); }
    .chat-compose-actions { display:flex; gap:6px; }
    .chat-send-btn { padding:8px 18px; background:var(--db-accent); color:#fff; border:none; border-radius:10px; cursor:pointer; font-size:14px; font-weight:600; transition:all .15s; }
    .chat-send-btn:hover { filter:brightness(1.1); }
    .chat-send-btn:disabled { opacity:.5; cursor:not-allowed; }

    .chat-attach-btn { padding:8px 10px; background:transparent; border:1px solid var(--db-border); border-radius:10px; cursor:pointer; font-size:16px; color:var(--db-text-dim); transition:all .15s; display:flex; align-items:center; }
    .chat-attach-btn:hover { background:rgba(var(--db-accent-rgb,100,100,255),.1); color:var(--db-accent); border-color:var(--db-accent); }
    .chat-attach-strip { display:flex; flex-wrap:wrap; gap:6px; padding:0; margin:0; }
    .chat-attach-strip:empty { display:none; }
    .chat-attach-item { display:flex; align-items:center; gap:6px; padding:4px 10px; background:rgba(var(--db-accent-rgb,100,100,255),.08); border:1px solid rgba(var(--db-accent-rgb,100,100,255),.2); border-radius:8px; font-size:12px; color:var(--db-text); max-width:200px; }
    .chat-attach-item .attach-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
    .chat-attach-item .attach-icon { font-size:14px; }
    .chat-attach-item .attach-remove { cursor:pointer; color:var(--db-text-dim); font-size:14px; padding:0 2px; border:none; background:none; line-height:1; }
    .chat-attach-item .attach-remove:hover { color:#ef4444; }
    .chat-attach-item img.attach-thumb { width:24px; height:24px; object-fit:cover; border-radius:4px; }
  `;
  document.head.appendChild(style);
}

// ── Platform SVG Icons ──────────────────────────────────────────
const _PLATFORM_SVGS = {
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>',
  slack: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>',
  signal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 17.09l-1.098-.01c-.243 0-.374-.118-.41-.146a5.627 5.627 0 0 1-1.01-.905c-.277-.31-.49-.576-.77-.576-.18 0-.378.13-.578.396-.256.34-.505.85-.643 1.313-.042.14-.133.22-.377.22h-.004A8.174 8.174 0 0 1 8.8 15.3a10.475 10.475 0 0 1-2.288-3.18c-.055-.131-.052-.244.02-.337.065-.085.18-.136.29-.136h1.043c.221 0 .285.102.349.248l.015.033c.32.72.75 1.39 1.27 1.972.08.07.156.104.218.104.048 0 .078-.02.094-.032V11.6c-.004-.472-.12-.652-.207-.741-.058-.059-.117-.156.032-.279.1-.083.278-.139.45-.139h1.643c.186 0 .252.1.252.24v3.04c0 .047.023.075.046.075.079 0 .24-.096.496-.392a10.201 10.201 0 0 0 1.546-2.676c.037-.092.119-.226.353-.226h1.119c.054 0 .295 0 .347.179.055.194-.036.647-1.496 2.863l-.575.872c-.14.215-.192.327 0 .558.004.005.03.035.072.08.351.377 1.252 1.336 1.48 2.111.03.103.04.2-.126.2z"/></svg>',
};

function _getPlatformSVG(platform) {
  const key = (platform || '').toLowerCase();
  return _PLATFORM_SVGS[key] || null;
}

function _getPlatformClass(platform) {
  const key = (platform || '').toLowerCase();
  return ['telegram','slack','discord','whatsapp','signal'].includes(key) ? 'plat-' + key : 'plat-default';
}

// ── Main render (ES module entry point) ─────────────────────────
export async function render(container) {
  injectStyles();
  containerRef = container;

  container.innerHTML = `
    <div class="chat-root" id="chat-root">
      <div class="chat-sidebar-panel">
        <div class="chat-sidebar-head">
          <h3>💬 Chat</h3>
          <button class="chat-icon-btn" id="chat-new-session" title="New chat">+ New</button>
        </div>
        <div class="chat-sidebar-agent">
          <label>Agent</label>
          <select id="chat-agent-selector"><option value="">Auto (default)</option></select>
        </div>
        <div class="chat-sess-list" id="chat-sessions-list"></div>
      </div>
      <div class="chat-main-panel">
        <div class="chat-top-bar">
          <div class="chat-top-info">
            <span class="chat-top-title" id="chat-header-title">New Chat</span>
            <span class="chat-status-badge" id="chat-header-status">connecting…</span>
            <span class="chat-queue-badge" id="chat-queue-badge">0 queued</span>
          </div>
          <div class="chat-top-actions">
            <button class="chat-icon-btn" id="chat-memory-btn" title="Memory inspector">🧠</button>
            <button class="chat-icon-btn" id="chat-focus-btn" title="Focus mode">⛶</button>
            <button class="chat-icon-btn danger" id="chat-abort-btn" style="display:none" title="Stop">⬛ Stop</button>
          </div>
        </div>
        <div class="chat-memory-panel" id="chat-memory-panel">
          <div class="chat-memory-panel-header">
            <h4>🧠 Agent Memories</h4>
            <div class="chat-memory-panel-actions">
              <button id="chat-mem-refresh" title="Refresh">↻ Refresh</button>
              <button id="chat-mem-close" title="Close">✕</button>
            </div>
          </div>
          <div id="chat-memory-list"><span class="chat-mem-empty">Click refresh to load memories</span></div>
        </div>
        <div class="chat-messages-area" id="chat-messages">
          <div class="chat-welcome-box" id="chat-welcome">
            <div class="icon">🤖</div>
            <h2>PraisonAI Chat</h2>
            <p>Select an agent and start chatting. Messages stream in real-time.</p>
          </div>
        </div>
        <div class="chat-compose">
          <div class="chat-attach-strip" id="chat-attach-strip"></div>
          <div class="chat-compose-row">
            <button class="chat-attach-btn" id="chat-attach-btn" title="Attach file (PDF, image)">📎</button>
            <input type="file" id="chat-file-input" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,image/*,application/pdf" multiple style="display:none" />
            <textarea id="chat-input" placeholder="Type a message…" rows="1"></textarea>
            <div class="chat-compose-actions">
              <button class="chat-send-btn" id="chat-send-btn">Send ↵</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind events
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const abortBtn = document.getElementById('chat-abort-btn');
  const newBtn = document.getElementById('chat-new-session');
  const focusBtn = document.getElementById('chat-focus-btn');
  const memoryBtn = document.getElementById('chat-memory-btn');
  const memRefreshBtn = document.getElementById('chat-mem-refresh');
  const memCloseBtn = document.getElementById('chat-mem-close');
  const agentSelector = document.getElementById('chat-agent-selector');
  const attachBtn = document.getElementById('chat-attach-btn');
  const fileInput = document.getElementById('chat-file-input');
  // Guard: if DOM elements aren't present yet (race condition), bail out
  if (!input || !sendBtn) {
    console.warn('[chat] DOM elements not ready — skipping event binding');
    return;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  });
  sendBtn.addEventListener('click', sendMessage);
  abortBtn.addEventListener('click', abortRun);
  newBtn.addEventListener('click', newSession);
  agentSelector.addEventListener('change', (e) => { currentAgentName = e.target.value || null; });

  // File upload
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleFileUpload(fileInput));

  focusBtn.addEventListener('click', () => {
    focusMode = !focusMode;
    const root = document.getElementById('chat-root');
    if (root) root.classList.toggle('focus-mode', focusMode);
    focusBtn.classList.toggle('active', focusMode);
    focusBtn.title = focusMode ? 'Show sidebar' : 'Focus mode';
  });

  memoryBtn.addEventListener('click', () => toggleMemoryPanel());
  memRefreshBtn.addEventListener('click', () => loadMemories());
  memCloseBtn.addEventListener('click', () => {
    const panel = document.getElementById('chat-memory-panel');
    if (panel) panel.classList.remove('open');
  });

  await loadAgents();

  // Pre-select agent if passed via URL query param (from Agents page "Run" button)
  const urlAgent = new URLSearchParams(window.location.search).get('agent');
  if (urlAgent) {
    const selector = document.getElementById('chat-agent-selector');
    if (selector) {
      for (const opt of selector.options) {
        if (opt.value.toLowerCase() === urlAgent.toLowerCase()) {
          selector.value = opt.value;
          currentAgentName = opt.value;
          break;
        }
      }
    }
    // Clean the query param from URL to avoid stale state on refresh
    history.replaceState(history.state, '', window.location.pathname);
  }

  await loadSessions();
  connectWebSocket();
}

export function cleanup() {
  if (ws) { try { ws.close(); } catch(e) {} ws = null; }
  currentSessionId = null;
  currentAgentName = null;
  isStreaming = false;
  currentRunId = null;
  messageQueue = [];
  currentDeltaEl = null;
  currentDeltaText = '';
}

// ── API ──────────────────────────────────────────────────────────
async function loadAgents() {
  try {
    const resp = await fetch('/agents');
    const data = await resp.json();
    agents = data.agents || data || [];

    // Merge CRUD-defined agents from /api/agents/definitions
    try {
      const crudResp = await fetch('/api/agents/definitions');
      const crudData = await crudResp.json();
      const crudAgents = crudData.agents || crudData || [];
      crudAgents.forEach((a) => {
        const name = a.name || a.id;
        const nameLower = name.toLowerCase();
        if (!agents.some((x) => ((typeof x === 'string' ? x : x.name || x.id) || '').toLowerCase() === nameLower)) {
          agents.push(a);
        }
      });
    } catch (e) {
      // CRUD endpoint may not exist in minimal setups
    }

    const selector = document.getElementById('chat-agent-selector');
    if (selector) {
      agents.forEach((a) => {
        const opt = document.createElement('option');
        const name = typeof a === 'string' ? a : a.name || a.id;
        opt.value = name;
        opt.textContent = name;
        selector.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('[Chat] Failed to load agents:', e);
  }
}

async function loadSessions() {
  try {
    const resp = await fetch('/sessions');
    const data = await resp.json();
    const sessions = data.sessions || data || [];
    const list = document.getElementById('chat-sessions-list');
    if (!list) return;
    list.innerHTML = '';
    if (sessions.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--db-text-dim);font-size:12px">No sessions yet</div>';
      return;
    }
    sessions.slice(0, 30).forEach((s) => {
      const el = document.createElement('div');
      const id = s.id || s.session_id || '';
      el.className = 'chat-sess-item' + (id === currentSessionId ? ' active' : '');
      // Show platform icon for channel sessions (e.g. Slack with SVG)
      const platformName = s.platform || '';
      const platSvg = _getPlatformSVG(platformName);
      let title;
      let titlePrefix = '';
      if (platformName) {
        const displayName = platformName.charAt(0).toUpperCase() + platformName.slice(1);
        if (platSvg) {
          titlePrefix = '<span class="sess-platform-icon ' + _getPlatformClass(platformName) + '">' + platSvg + '</span>';
        }
        title = displayName;
      } else {
        title = s.name || s.title || s.label || id.substring(0, 12) + '…';
      }
      const agent = s.agent_id || s.agent || '';
      const time = timeAgo(s.created_at || s.updated_at);
      el.innerHTML = `
        <div class="sess-title">${titlePrefix}${escapeHtml(title)}</div>
        <div class="sess-meta">${agent ? '🤖 ' + escapeHtml(agent) + ' · ' : ''}${time}</div>
      `;
      el.title = id;
      el.addEventListener('click', () => loadSession(id));
      list.appendChild(el);
    });
  } catch (e) {
    console.warn('[Chat] Failed to load sessions:', e);
  }
}

async function loadSession(sessionId) {
  currentSessionId = sessionId;
  refreshStreamingUI();
  const messagesEl = document.getElementById('chat-messages');
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  try {
    const resp = await fetch('/api/chat/history/' + sessionId);
    const data = await resp.json();
    const messages = data.messages || [];

    messagesEl.innerHTML = '';
    let sessionPlatform = data.platform || null;
    let sessionIcon = data.icon || null;
    messages.forEach((m) => {
      if (m.platform) {
        // Channel message — render with platform badge and icon
        sessionPlatform = m.platform;
        sessionIcon = m.icon;
        _appendChannelMsg(m.role === 'assistant' ? 'assistant' : 'user', m);
      } else {
        // Render persisted tool calls before the message
        if (m.toolCalls && Array.isArray(m.toolCalls)) {
          m.toolCalls.forEach(tc => {
            const status = tc.type === 'tool_call_completed' ? 'done' : 'done';
            appendToolCall(tc, status);
          });
        }
        appendMessage(m.role, m.content, m.agent_name);
      }
    });

    // Update sidebar active state
    document.querySelectorAll('.chat-sess-item').forEach((el) => {
      el.classList.toggle('active', el.title === sessionId);
    });

    const title = document.getElementById('chat-header-title');
    if (sessionPlatform) {
      const platSvg = _getPlatformSVG(sessionPlatform);
      const displayName = sessionPlatform.charAt(0).toUpperCase() + sessionPlatform.slice(1);
      if (platSvg) {
        title.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px">' + platSvg + ' ' + escapeHtml(displayName) + '</span>';
      } else {
        title.textContent = (sessionIcon || '📨') + ' ' + displayName;
      }
    } else if (title) {
      title.textContent = 'Session ' + sessionId.substring(0, 8);
    }
  } catch (e) {
    console.warn('[Chat] Failed to load session:', e);
  }
}

async function restoreSessionHistory(sessionId) {
  // On reconnect, silently re-fetch history and restore messages
  // Only restore if messages area is empty (e.g., page refresh)
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl && messagesEl.querySelectorAll('.chat-msg').length === 0) {
    try {
      const resp = await fetch('/api/chat/history/' + sessionId);
      const data = await resp.json();
      const messages = data.messages || [];
      if (messages.length > 0) {
        const welcome = document.getElementById('chat-welcome');
        if (welcome) welcome.style.display = 'none';
        let sessionPlatform = null;
        let sessionIcon = null;
        messages.forEach((m) => {
          if (m.platform) {
            sessionPlatform = m.platform;
            sessionIcon = m.icon;
            _appendChannelMsg(m.role === 'assistant' ? 'assistant' : 'user', m);
          } else {
            // Render persisted tool calls before the message
            if (m.toolCalls && Array.isArray(m.toolCalls)) {
              m.toolCalls.forEach(tc => {
                appendToolCall(tc, 'done');
              });
            }
            appendMessage(m.role, m.content, m.agent_name);
          }
        });
        if (sessionPlatform) {
          const title = document.getElementById('chat-header-title');
          if (title) {
            const platSvg = _getPlatformSVG(sessionPlatform);
            const displayName = sessionPlatform.charAt(0).toUpperCase() + sessionPlatform.slice(1);
            if (platSvg) {
              title.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px">' + platSvg + ' ' + escapeHtml(displayName) + '</span>';
            } else {
              title.textContent = (sessionIcon || '📨') + ' ' + displayName;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Chat] Failed to restore session:', e);
    }
  }
}

function newSession() {
  currentSessionId = null;
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = `
      <div class="chat-welcome-box" id="chat-welcome">
        <div class="icon">🤖</div>
        <h2>PraisonAI Chat</h2>
        <p>Select an agent and start chatting. Messages stream in real-time.</p>
      </div>
    `;
  }
  const title = document.getElementById('chat-header-title');
  if (title) title.textContent = 'New Chat';
  document.querySelectorAll('.chat-sess-item').forEach((el) => el.classList.remove('active'));
  refreshStreamingUI();
}

// ── WebSocket ────────────────────────────────────────────────────
function connectWebSocket() {
  // Close any existing connection to prevent duplicate events
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch (e) {}
    ws = null;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = protocol + '//' + location.host + '/api/chat/ws';

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Chat] WebSocket connected');
      setStatus('connected');
      // Resume session if we had one before disconnect
      if (currentSessionId) {
        restoreSessionHistory(currentSessionId);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Uniform session filtering — all events including channel events
        if (data.session_id && currentSessionId && data.session_id !== currentSessionId) {
          _markSessionUnread(data.session_id);
          return;
        }
        handleWsMessage(data);
      } catch (e) {
        console.warn('[Chat] Invalid WS message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Chat] WebSocket closed, reconnecting in 3s…');
      setStatus('disconnected');
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (e) => {
      console.error('[Chat] WebSocket error:', e);
    };
  } catch (e) {
    console.warn('[Chat] WebSocket connection failed:', e);
    setTimeout(connectWebSocket, 5000);
  }
}

function handleWsMessage(data) {
  const type = data.type;

  switch (type) {
    case 'run_content':
      if (data.token) appendDelta(data.token, data.agent_name);
      setStatus('streaming');
      break;

    case 'run_completed':
      finalizeDelta(data.content, data.agent_name);
      setStatus('connected');
      setStreaming(false);
      drainQueue();
      break;

    case 'run_started':
      isStreaming = true;
      streamingSessionId = data.session_id || currentSessionId;
      currentRunId = data.run_id;
      setStatus('streaming');
      setStreaming(true);
      break;

    case 'run_error':
      appendMessage('system', '❌ Error: ' + (data.error || 'Unknown error'));
      setStatus('error');
      setStreaming(false);
      drainQueue();
      break;

    case 'run_cancelled':
      appendMessage('system', '⬛ Run cancelled');
      setStatus('connected');
      setStreaming(false);
      drainQueue();
      break;

    case 'tool_call_started':
      appendToolCall(data, 'running');
      break;

    case 'tool_call_completed':
      updateToolCall(data, 'done');
      break;

    case 'reasoning_step':
      appendReasoning(data.step);
      break;

    case 'run_paused':
      appendAskWidget(data.question, data.options, data.session_id, data.run_id);
      setStatus('paused');
      break;

    case 'memory_update_started':
      appendMemoryIndicator('Updating memory…');
      break;

    case 'updating_memory':
      // Memory update in progress — indicator already shown
      break;

    case 'memory_update_completed':
      completeMemoryIndicator();
      break;

    case 'team_run_started':
      appendMessage('system', '🤝 Team run started' + (data.agent_name ? ` — Agent: ${data.agent_name}` : ''));
      streamingSessionId = data.session_id || currentSessionId;
      setStatus('streaming');
      setStreaming(true);
      break;

    case 'team_run_content':
      if (data.token) appendDelta(data.token, data.agent_name);
      break;

    case 'team_run_completed':
      finalizeDelta(data.content, data.agent_name);
      setStatus('connected');
      setStreaming(false);
      drainQueue();
      break;

    case 'team_run_error':
      appendMessage('system', '❌ Team error: ' + (data.error || 'Unknown'));
      setStatus('error');
      setStreaming(false);
      drainQueue();
      break;

    case 'team_tool_call_started':
      appendToolCall(data, 'running');
      break;

    case 'team_tool_call_completed':
      updateToolCall(data, 'done');
      break;

    case 'team_reasoning_step':
      appendReasoning(data.step);
      break;

    case 'pong':
      break;

    case 'channel_message':
      // Incoming message from a channel bot (Slack/Discord/Telegram user)
      _handleChannelMessage(data);
      break;

    case 'channel_response':
      // Agent response sent back through a channel bot
      _handleChannelResponse(data);
      break;

    default:
      // Handle metrics from run_content events
      if (data.metrics) {
        showStreamMetrics(data.metrics);
      }
      console.log('[Chat] Unknown message type:', type, data);
  }
}

// ── Channel Message Handlers ────────────────────────────────────
// These render messages from platform bots (Slack, Discord, Telegram)
// into the Chat UI. They auto-switch to the channel session or show
// an unread notification dot if the user is viewing a different session.

function _handleChannelMessage(data) {
  const sessionId = data.session_id;
  const isViewing = currentSessionId === sessionId;

  // If user is on a fresh/empty chat, auto-switch to channel session
  if (!currentSessionId) {
    currentSessionId = sessionId;
  }

  if (currentSessionId === sessionId) {
    _appendChannelMsg('user', data);
  } else {
    // Mark unread in sidebar
    _markSessionUnread(sessionId);
  }

  // Refresh sessions to show new channel session
  setTimeout(loadSessions, 300);
}

function _handleChannelResponse(data) {
  const sessionId = data.session_id;

  if (currentSessionId === sessionId) {
    _appendChannelMsg('assistant', data);
  } else {
    _markSessionUnread(sessionId);
  }
}

function _appendChannelMsg(role, data) {
  const messagesEl = document.getElementById('chat-messages');
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg chat-msg-' + role + ' chat-msg-channel';

  const avatarEl = document.createElement('div');
  const platSvg = _getPlatformSVG(data.platform);
  avatarEl.className = 'chat-msg-avatar ' + _getPlatformClass(data.platform);
  if (platSvg) {
    avatarEl.innerHTML = platSvg;
  } else {
    avatarEl.textContent = (data.icon || '📨');
  }

  const bodyEl = document.createElement('div');
  bodyEl.className = 'chat-msg-body';

  // Sender/agent name with platform badge
  const senderEl = document.createElement('div');
  senderEl.className = 'chat-msg-channel-sender';
  const badge = '<span class="chat-channel-badge">' + escapeHtml(data.platform || 'channel') + '</span>';
  const name = role === 'user'
    ? (data.sender || 'User')
    : (data.agent_name || 'Assistant');
  senderEl.innerHTML = badge + ' ' + escapeHtml(name);
  bodyEl.appendChild(senderEl);

  const contentEl = document.createElement('div');
  contentEl.className = 'chat-msg-content';
  contentEl.innerHTML = renderMarkdown(data.content || '');
  bodyEl.appendChild(contentEl);

  msgEl.appendChild(avatarEl);
  msgEl.appendChild(bodyEl);
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Update header to show channel session
  const headerTitle = document.getElementById('chat-header-title');
  if (headerTitle && currentSessionId === data.session_id) {
    const hdrPlatSvg = _getPlatformSVG(data.platform);
    const hdrName = (data.platform || 'Channel').charAt(0).toUpperCase() + (data.platform || 'Channel').slice(1);
    if (hdrPlatSvg) {
      headerTitle.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px">' + hdrPlatSvg + ' ' + escapeHtml(hdrName) + '</span>';
    } else {
      headerTitle.textContent = (data.icon || '📨') + ' ' + hdrName;
    }
  }
}

function _markSessionUnread(sessionId) {
  // Add unread dot to matching session item in sidebar
  document.querySelectorAll('.chat-sess-item').forEach((el) => {
    if (el.title === sessionId && !el.querySelector('.sess-unread')) {
      const dot = document.createElement('span');
      dot.className = 'sess-unread';
      el.querySelector('.sess-title')?.appendChild(dot);
    }
  });
}

// ── Message Rendering ───────────────────────────────────────────

function appendMessage(role, content, agentName) {
  const messagesEl = document.getElementById('chat-messages');
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg chat-msg-' + role;

  const avatarEl = document.createElement('div');
  avatarEl.className = 'chat-msg-avatar';
  avatarEl.textContent = role === 'user' ? '👤' : role === 'system' ? '⚙️' : '🤖';

  const bodyEl = document.createElement('div');
  bodyEl.className = 'chat-msg-body';

  if (agentName) {
    const nameEl = document.createElement('div');
    nameEl.className = 'chat-msg-agent-name';
    nameEl.textContent = agentName;
    bodyEl.appendChild(nameEl);
  }

  const contentEl = document.createElement('div');
  contentEl.className = 'chat-msg-content';
  contentEl.innerHTML = renderMarkdown(content);
  highlightCodeBlocks(contentEl);
  bodyEl.appendChild(contentEl);

  msgEl.appendChild(avatarEl);
  msgEl.appendChild(bodyEl);
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendDelta(token, agentName) {
  const messagesEl = document.getElementById('chat-messages');

  if (!currentDeltaEl) {
    const welcome = document.getElementById('chat-welcome');
    if (welcome) welcome.style.display = 'none';

    currentDeltaText = '';
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg chat-msg-assistant';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'chat-msg-avatar';
    avatarEl.textContent = '🤖';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'chat-msg-body';

    if (agentName) {
      const nameEl = document.createElement('div');
      nameEl.className = 'chat-msg-agent-name';
      nameEl.textContent = agentName;
      bodyEl.appendChild(nameEl);
    }

    currentDeltaEl = document.createElement('div');
    currentDeltaEl.className = 'chat-msg-content chat-msg-streaming';
    bodyEl.appendChild(currentDeltaEl);

    msgEl.appendChild(avatarEl);
    msgEl.appendChild(bodyEl);
    messagesEl.appendChild(msgEl);
  }

  currentDeltaText += token;
  currentDeltaEl.innerHTML = renderMarkdown(currentDeltaText);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function finalizeDelta(content, agentName) {
  if (currentDeltaEl) {
    currentDeltaEl.classList.remove('chat-msg-streaming');
    if (content) {
      currentDeltaEl.innerHTML = renderMarkdown(content);
      highlightCodeBlocks(currentDeltaEl);
    }
    currentDeltaEl = null;
    currentDeltaText = '';
  } else if (content) {
    appendMessage('assistant', content, agentName);
  }
}

function appendToolCall(data, status) {
  const messagesEl = document.getElementById('chat-messages');

  // Use tool_call_id for unique element IDs
  const uniqueId = data.tool_call_id || ('tool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  const elId = 'tc-' + uniqueId.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Check if this tool call already has an element (re-broadcast with richer args)
  const existing = document.getElementById(elId);
  if (existing) {
    // Update description in-place with richer keyword text
    const icon = data.icon || '🔧';
    const description = data.description || (icon + ' ' + escapeHtml(data.name || 'tool'));
    const descEl = existing.querySelector('.chat-tool-desc');
    if (descEl) descEl.innerHTML = description;
    // Update detail panel with richer data
    _updateToolDetails(existing, data);
    return;
  }

  const el = document.createElement('div');
  el.className = 'chat-tool-call chat-tool-' + status;
  el.id = elId;

  // Enriched display fields from backend
  const icon = data.icon || '🔧';
  const description = data.description || (icon + ' ' + escapeHtml(data.name || 'tool'));
  const stepNum = data.step_number;

  // Build status badge with spinner for running
  const badgeContent = status === 'running'
    ? '<span class="tool-spinner"></span>running'
    : '✓ done';

  el.innerHTML =
    '<div class="chat-tool-header">' +
      (stepNum ? '<span class="chat-tool-step">Step ' + stepNum + '</span>' : '') +
      '<span class="chat-tool-desc">' + description + '</span>' +
      '<span class="chat-tool-badge">' + badgeContent + '</span>' +
      '<span class="chat-tool-chevron">▶</span>' +
    '</div>' +
    '<div class="chat-tool-details"></div>';

  // Click to toggle expand
  el.addEventListener('click', () => el.classList.toggle('expanded'));

  // Populate detail panel
  _updateToolDetails(el, data);

  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function _updateToolDetails(el, data) {
  const detailsEl = el.querySelector('.chat-tool-details');
  if (!detailsEl) return;
  let html = '';
  // Args section
  const args = data.args;
  if (args && typeof args === 'object' && Object.keys(args).length > 0) {
    html += '<div class="tool-detail-section">' +
      '<div class="tool-detail-label">Arguments</div>' +
      '<pre>' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' +
    '</div>';
  } else if (args && typeof args === 'string' && args.trim()) {
    html += '<div class="tool-detail-section">' +
      '<div class="tool-detail-label">Arguments</div>' +
      '<pre>' + escapeHtml(args) + '</pre>' +
    '</div>';
  }
  // Result section
  const result = data.result;
  if (result) {
    let resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    // Truncate very long results
    if (resultStr.length > 5000) resultStr = resultStr.substring(0, 5000) + '\n... (truncated)';
    html += '<div class="tool-detail-section">' +
      '<div class="tool-detail-label">Result</div>' +
      '<pre>' + escapeHtml(resultStr) + '</pre>' +
    '</div>';
  }
  if (html) {
    detailsEl.innerHTML = html;
  }
}

function updateToolCall(data, status) {
  // Find by tool_call_id first, fall back to most recent running
  let el = null;
  if (data.tool_call_id) {
    el = document.getElementById('tc-' + data.tool_call_id.replace(/[^a-zA-Z0-9_-]/g, '_'));
  }
  if (!el) {
    const all = document.querySelectorAll('.chat-tool-call.chat-tool-running');
    if (all.length > 0) el = all[all.length - 1];
  }
  if (el) {
    el.className = 'chat-tool-call chat-tool-' + status;
    const badge = el.querySelector('.chat-tool-badge');
    if (badge) {
      const displayResult = data.formatted_result || '✓ Done';
      badge.innerHTML = '✓ ' + escapeHtml(displayResult.replace(/^✓\s*/, ''));
    }
    // Update detail panel with completed data (args + result)
    _updateToolDetails(el, data);
  }
}

function appendReasoning(step) {
  const messagesEl = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-reasoning';
  el.innerHTML = '💭 ' + escapeHtml(step || '');
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendAskWidget(question, options, sessionId, runId) {
  const messagesEl = document.getElementById('chat-messages');
  const widget = document.createElement('div');
  widget.className = 'chat-ask-widget';

  const q = document.createElement('div');
  q.className = 'chat-ask-question';
  q.textContent = question || 'The agent needs your input';
  widget.appendChild(q);

  function sendResponse(answer) {
    widget.classList.add('chat-ask-answered');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'ask_response',
        response: answer,
        session_id: sessionId || currentSessionId,
        run_id: runId,
      }));
    }
    // Show what the user answered
    appendMessage('user', answer);
  }

  if (options && options.length > 0) {
    const optionsRow = document.createElement('div');
    optionsRow.className = 'chat-ask-options';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'chat-ask-option';
      btn.textContent = typeof opt === 'string' ? opt : opt.label || opt.value || String(opt);
      btn.onclick = () => sendResponse(btn.textContent);
      optionsRow.appendChild(btn);
    });
    widget.appendChild(optionsRow);
  } else {
    // Free-form input
    const inputRow = document.createElement('div');
    inputRow.className = 'chat-ask-input-row';
    const input = document.createElement('input');
    input.className = 'chat-ask-input';
    input.placeholder = 'Type your response...';
    input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) sendResponse(input.value.trim()); };
    const submitBtn = document.createElement('button');
    submitBtn.className = 'chat-ask-submit';
    submitBtn.textContent = 'Send';
    submitBtn.onclick = () => { if (input.value.trim()) sendResponse(input.value.trim()); };
    inputRow.appendChild(input);
    inputRow.appendChild(submitBtn);
    widget.appendChild(inputRow);
  }

  messagesEl.appendChild(widget);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMemoryIndicator(text) {
  const messagesEl = document.getElementById('chat-messages');
  // Remove existing indicator if any
  const existing = messagesEl.querySelector('.chat-memory-indicator:not(.chat-memory-done)');
  if (existing) return;

  const el = document.createElement('div');
  el.className = 'chat-memory-indicator';
  el.innerHTML = '<div class="spinner"></div> ' + escapeHtml(text || 'Updating memory…');
  el.id = 'chat-memory-active';
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function completeMemoryIndicator() {
  const el = document.getElementById('chat-memory-active');
  if (el) {
    el.classList.add('chat-memory-done');
    el.innerHTML = '🧠 Memory updated';
    el.removeAttribute('id');
  }
}

function showStreamMetrics(metrics) {
  let metricsEl = document.getElementById('chat-stream-metrics');
  if (!metricsEl) {
    const compose = document.querySelector('.chat-compose');
    if (!compose) return;
    metricsEl = document.createElement('div');
    metricsEl.className = 'chat-metrics';
    metricsEl.id = 'chat-stream-metrics';
    compose.prepend(metricsEl);
  }
  const parts = [];
  if (metrics.ttft != null) parts.push(`<span>⚡ TTFT: ${(metrics.ttft * 1000).toFixed(0)}ms</span>`);
  if (metrics.tokens_per_second != null) parts.push(`<span>📊 ${metrics.tokens_per_second.toFixed(1)} tok/s</span>`);
  if (metrics.total_tokens != null) parts.push(`<span>🔢 ${metrics.total_tokens} tokens</span>`);
  metricsEl.innerHTML = parts.join('') || '';
}

// ── Memory Panel ────────────────────────────────────────────────
function toggleMemoryPanel() {
  const panel = document.getElementById('chat-memory-panel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (isOpen) loadMemories();
}

async function loadMemories() {
  const listEl = document.getElementById('chat-memory-list');
  if (!listEl) return;
  listEl.innerHTML = '<span class="chat-mem-empty">Loading…</span>';

  try {
    // Fetch all memories (or session-scoped if we have a session)
    const endpoint = currentSessionId
      ? `/api/memory/session/${currentSessionId}`
      : '/api/memory';
    const resp = await fetch(endpoint);
    if (!resp.ok) {
      // Fall back to global if session endpoint isn't available
      const fallback = await fetch('/api/memory');
      if (!fallback.ok) throw new Error('Memory API unavailable');
      var data = await fallback.json();
    } else {
      var data = await resp.json();
    }

    const items = data.memories || [];
    if (items.length === 0) {
      listEl.innerHTML = '<span class="chat-mem-empty">No memories stored yet</span>';
      return;
    }

    listEl.innerHTML = items.map(m => `
      <div class="chat-mem-item">
        <div class="mem-type">${m.memory_type || 'long'}</div>
        <div class="mem-text">${escapeHtml(m.text || '')}</div>
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<span class="chat-mem-empty">Error: ${err.message}</span>`;
  }
}

// ── File Upload & Attachments ───────────────────────────────────
async function handleFileUpload(fileInput) {
  const files = Array.from(fileInput.files);
  if (!files.length) return;
  fileInput.value = '';  // reset so same file can be re-selected

  // Ensure session exists
  if (!currentSessionId) {
    currentSessionId = crypto.randomUUID ? crypto.randomUUID() :
      'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }

  for (const file of files) {
    // Validate type
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type) && !file.type.startsWith('image/')) {
      appendMessage('system', `❌ Unsupported file type: ${file.name} (${file.type})`);
      continue;
    }

    // Validate size (10 MB max)
    if (file.size > 10 * 1024 * 1024) {
      appendMessage('system', `❌ File too large: ${file.name} (max 10 MB)`);
      continue;
    }

    // Upload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', currentSessionId);

    try {
      const resp = await fetch('/api/chat/attachments', { method: 'POST', body: formData });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        appendMessage('system', `❌ Upload failed: ${err.error || err.detail || resp.statusText}`);
        continue;
      }
      const data = await resp.json();

      // Create thumbnail preview for images
      let preview_url = null;
      if (file.type.startsWith('image/')) {
        preview_url = URL.createObjectURL(file);
      }

      pendingAttachments.push({
        id: data.attachment_id || data.id || file.name,
        filename: file.name,
        content_type: file.type,
        preview_url,
      });
    } catch (e) {
      appendMessage('system', `❌ Upload error: ${e.message}`);
    }
  }

  renderAttachmentStrip();
}

function renderAttachmentStrip() {
  const strip = document.getElementById('chat-attach-strip');
  if (!strip) return;
  strip.innerHTML = pendingAttachments.map((a, i) => {
    const icon = a.content_type === 'application/pdf' ? '📄' : '🖼️';
    const thumb = a.preview_url
      ? `<img class="attach-thumb" src="${a.preview_url}" alt="" />`
      : `<span class="attach-icon">${icon}</span>`;
    return `<div class="chat-attach-item" data-idx="${i}">
      ${thumb}
      <span class="attach-name" title="${escapeHtml(a.filename)}">${escapeHtml(a.filename)}</span>
      <button class="attach-remove" data-idx="${i}" title="Remove">✕</button>
    </div>`;
  }).join('');

  // Bind remove buttons
  strip.querySelectorAll('.attach-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx);
      const removed = pendingAttachments.splice(idx, 1)[0];
      if (removed && removed.preview_url) URL.revokeObjectURL(removed.preview_url);
      renderAttachmentStrip();
    });
  });
}

function clearAttachments() {
  pendingAttachments.forEach(a => { if (a.preview_url) URL.revokeObjectURL(a.preview_url); });
  pendingAttachments = [];
  renderAttachmentStrip();
}

// ── Send / Queue / Abort ────────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content && pendingAttachments.length === 0) return;

  // Generate session ID if needed
  if (!currentSessionId) {
    currentSessionId = crypto.randomUUID ? crypto.randomUUID() :
      'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }

  // Build attachment info for display
  const attachInfo = pendingAttachments.length > 0
    ? '\n\n📎 ' + pendingAttachments.map(a => a.filename).join(', ')
    : '';

  // If currently streaming in THIS session, queue the message.
  // Messages to a different session go through immediately.
  if (isStreaming && streamingSessionId === currentSessionId) {
    messageQueue.push({ content, session_id: currentSessionId, agent_name: currentAgentName, attachment_ids: pendingAttachments.map(a => a.id) });
    updateQueueBadge();
    appendMessage('user', (content || '') + attachInfo);
    appendMessage('system', '📥 Message queued (' + messageQueue.length + ' pending)');
    input.value = '';
    input.style.height = 'auto';
    clearAttachments();
    return;
  }

  // Display user message immediately
  appendMessage('user', (content || '') + attachInfo);
  input.value = '';
  input.style.height = 'auto';

  // Send via WebSocket if connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = {
      type: 'chat',
      content: content || '',
      session_id: currentSessionId,
      agent_name: currentAgentName,
    };
    if (pendingAttachments.length > 0) {
      payload.attachment_ids = pendingAttachments.map(a => a.id);
    }
    ws.send(JSON.stringify(payload));
    setStreaming(true);
    setStatus('streaming');
  } else {
    // Fallback to HTTP
    setStatus('sending…');
    fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content || '',
        session_id: currentSessionId,
        agent_name: currentAgentName,
        attachment_ids: pendingAttachments.map(a => a.id),
      }),
    }).then((r) => r.json()).then((data) => {
      if (data.error) {
        appendMessage('system', '❌ ' + data.error);
      } else if (data.content || data.response) {
        appendMessage('assistant', data.content || data.response, data.agent_name);
      }
      setStatus('connected');
    }).catch((e) => {
      appendMessage('system', '❌ ' + e.message);
      setStatus('error');
    });
  }

  // Clear attachments and refresh sessions
  clearAttachments();
  setTimeout(loadSessions, 500);
}

function drainQueue() {
  if (messageQueue.length > 0) {
    const next = messageQueue.shift();
    updateQueueBadge();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', ...next }));
      setStreaming(true);
      setStatus('streaming');
    }
  }
}

function updateQueueBadge() {
  const badge = document.getElementById('chat-queue-badge');
  if (badge) {
    badge.style.display = messageQueue.length > 0 ? '' : 'none';
    badge.textContent = messageQueue.length + ' queued';
  }
}

function abortRun() {
  if (ws && ws.readyState === WebSocket.OPEN && currentRunId) {
    ws.send(JSON.stringify({ type: 'chat_abort', run_id: currentRunId }));
  }
  setStreaming(false);
  setStatus('connected');
}

// ── UI State ────────────────────────────────────────────────────
function setStatus(status) {
  const el = document.getElementById('chat-header-status');
  if (el) {
    const labels = { connected: 'connected', disconnected: 'disconnected', streaming: 'streaming…', error: 'error', 'sending…': 'sending…', 'connecting…': 'connecting…' };
    el.textContent = labels[status] || status;
    el.className = 'chat-status-badge' + (status !== 'connected' ? ' ' + status : '');
  }
}

function setStreaming(val) {
  isStreaming = val;
  if (!val) streamingSessionId = null;
  refreshStreamingUI();
  if (!val) {
    currentRunId = null;
    currentDeltaEl = null;
    currentDeltaText = '';
  }
}

// Re-evaluate UI state for the *current* session.
// If another session is streaming but we're not in it, show "Send" / "connected".
function refreshStreamingUI() {
  const inStreamingSession = isStreaming && streamingSessionId === currentSessionId;
  const abortBtn = document.getElementById('chat-abort-btn');
  const sendBtn = document.getElementById('chat-send-btn');
  if (abortBtn) abortBtn.style.display = inStreamingSession ? '' : 'none';
  if (sendBtn) sendBtn.textContent = inStreamingSession ? 'Queue ↵' : 'Send ↵';
  // Update status badge too
  if (!inStreamingSession && isStreaming) {
    setStatus('connected');  // other session streaming, but we're not in it
  }
}
