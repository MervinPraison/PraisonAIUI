/**
 * Chat View — Real-time agent chat with streaming, markdown, and tool display.
 *
 * Gaps covered: 1 (Chat UI), 2 (Markdown rendering), 3 (Delta streaming),
 *               5 (Abort), 7 (Sanitization), 14 (Tool streaming display),
 *               17 (Syntax-highlighted code blocks).
 *
 * Protocol-driven: connects to /api/chat/ws or /api/chat/send.
 * Config-driven: auto-discovers agents and sessions from existing APIs.
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMarkdown(text) {
    // Basic markdown renderer — handles bold, italic, code, code blocks, links, lists
    if (!text) return '';
    let html = escapeHtml(text);
    // Code blocks (```lang\ncode\n```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
      return '<pre class="chat-code-block" data-lang="' + escapeHtml(lang) + '"><code>' + code + '</code></pre>';
    });
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ── State ────────────────────────────────────────────────────────
  let ws = null;
  let currentSessionId = null;
  let currentAgentName = null;
  let isStreaming = false;
  let currentRunId = null;
  let agents = [];

  // ── DOM ──────────────────────────────────────────────────────────
  const HOST = '';  // Same origin

  function createChatView(container) {
    container.innerHTML = `
      <div class="chat-container">
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <h3>💬 Chat</h3>
            <button class="chat-btn chat-btn-new" id="chat-new-session" title="New chat">+</button>
          </div>
          <div class="chat-agent-select">
            <label>Agent</label>
            <select id="chat-agent-selector">
              <option value="">Auto</option>
            </select>
          </div>
          <div class="chat-sessions-list" id="chat-sessions-list">
            <!-- Populated dynamically -->
          </div>
        </div>
        <div class="chat-main">
          <div class="chat-header">
            <div class="chat-header-info">
              <span class="chat-header-title" id="chat-header-title">New Chat</span>
              <span class="chat-header-status" id="chat-header-status">ready</span>
            </div>
            <div class="chat-header-actions">
              <button class="chat-btn chat-btn-abort" id="chat-abort-btn" style="display:none" title="Stop">⬛ Stop</button>
            </div>
          </div>
          <div class="chat-messages" id="chat-messages">
            <div class="chat-welcome" id="chat-welcome">
              <div class="chat-welcome-icon">🤖</div>
              <h2>PraisonAI Chat</h2>
              <p>Select an agent and start chatting. Messages stream in real-time.</p>
            </div>
          </div>
          <div class="chat-input-area">
            <div class="chat-input-wrapper">
              <textarea
                id="chat-input"
                class="chat-input"
                placeholder="Type a message..."
                rows="1"
              ></textarea>
              <button class="chat-btn chat-btn-send" id="chat-send-btn" title="Send">
                <span>▶</span>
              </button>
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
    const agentSelector = document.getElementById('chat-agent-selector');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    });

    sendBtn.addEventListener('click', sendMessage);
    abortBtn.addEventListener('click', abortRun);
    newBtn.addEventListener('click', newSession);
    agentSelector.addEventListener('change', (e) => {
      currentAgentName = e.target.value || null;
    });

    loadAgents();
    loadSessions();
    connectWebSocket();
  }

  // ── API ──────────────────────────────────────────────────────────
  async function loadAgents() {
    try {
      const resp = await fetch(HOST + '/agents');
      const data = await resp.json();
      agents = data.agents || data || [];
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
      console.warn('Failed to load agents:', e);
    }
  }

  async function loadSessions() {
    try {
      const resp = await fetch(HOST + '/sessions');
      const data = await resp.json();
      const sessions = data.sessions || data || [];
      const list = document.getElementById('chat-sessions-list');
      if (!list) return;
      list.innerHTML = '';
      sessions.slice(0, 20).forEach((s) => {
        const el = document.createElement('div');
        el.className = 'chat-session-item' + (s.id === currentSessionId ? ' active' : '');
        el.textContent = s.name || s.title || s.id.substring(0, 8) + '...';
        el.title = s.id;
        el.addEventListener('click', () => loadSession(s.id));
        list.appendChild(el);
      });
    } catch (e) {
      console.warn('Failed to load sessions:', e);
    }
  }

  async function loadSession(sessionId) {
    currentSessionId = sessionId;
    const messagesEl = document.getElementById('chat-messages');
    const welcome = document.getElementById('chat-welcome');
    if (welcome) welcome.style.display = 'none';

    try {
      const resp = await fetch(HOST + '/api/chat/history/' + sessionId);
      const data = await resp.json();
      const messages = data.messages || [];

      messagesEl.innerHTML = '';
      messages.forEach((m) => appendMessage(m.role, m.content, m.agent_name));

      // Update sidebar active state
      document.querySelectorAll('.chat-session-item').forEach((el) => {
        el.classList.toggle('active', el.title === sessionId);
      });

      const title = document.getElementById('chat-header-title');
      if (title) title.textContent = 'Session ' + sessionId.substring(0, 8);
    } catch (e) {
      console.warn('Failed to load session:', e);
    }
  }

  function newSession() {
    currentSessionId = null;
    const messagesEl = document.getElementById('chat-messages');
    const welcome = document.getElementById('chat-welcome');
    if (messagesEl) messagesEl.innerHTML = '';
    if (welcome) {
      welcome.style.display = '';
      messagesEl.appendChild(welcome);
    }
    const title = document.getElementById('chat-header-title');
    if (title) title.textContent = 'New Chat';
    document.querySelectorAll('.chat-session-item').forEach((el) => el.classList.remove('active'));
  }

  // ── WebSocket ────────────────────────────────────────────────────
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + location.host + '/api/chat/ws';

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[Chat] WebSocket connected');
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWsMessage(data);
        } catch (e) {
          console.warn('[Chat] Invalid WS message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[Chat] WebSocket closed, reconnecting in 3s...');
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
        // Delta streaming — append token to current assistant message
        if (data.token) {
          appendDelta(data.token, data.agent_name);
        }
        setStatus('streaming...');
        break;

      case 'run_completed':
        finalizeDelta(data.content, data.agent_name);
        setStatus('ready');
        setStreaming(false);
        break;

      case 'run_started':
        isStreaming = true;
        currentRunId = data.run_id;
        setStatus('thinking...');
        setStreaming(true);
        break;

      case 'run_error':
        appendMessage('system', '❌ Error: ' + (data.error || 'Unknown error'));
        setStatus('error');
        setStreaming(false);
        break;

      case 'run_cancelled':
        appendMessage('system', '⬛ Run cancelled');
        setStatus('ready');
        setStreaming(false);
        break;

      case 'tool_call_started':
        appendToolCall(data.name, data.args, 'running');
        break;

      case 'tool_call_completed':
        updateToolCall(data.name, data.result, 'done');
        break;

      case 'reasoning_step':
        appendReasoning(data.step);
        break;

      case 'pong':
        break;

      default:
        console.log('[Chat] Unknown message type:', type, data);
    }
  }

  // ── Message Rendering ───────────────────────────────────────────
  let currentDeltaEl = null;
  let currentDeltaText = '';

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
      }
      currentDeltaEl = null;
      currentDeltaText = '';
    } else if (content) {
      appendMessage('assistant', content, agentName);
    }
  }

  function appendToolCall(name, args, status) {
    const messagesEl = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-tool-call chat-tool-' + status;
    el.id = 'tool-' + name;
    el.innerHTML =
      '<div class="chat-tool-header">' +
      '<span class="chat-tool-icon">🔧</span>' +
      '<span class="chat-tool-name">' + escapeHtml(name) + '</span>' +
      '<span class="chat-tool-status">' + status + '</span>' +
      '</div>' +
      (args ? '<div class="chat-tool-args"><pre>' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre></div>' : '');
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateToolCall(name, result, status) {
    const el = document.getElementById('tool-' + name);
    if (el) {
      el.className = 'chat-tool-call chat-tool-' + status;
      const statusEl = el.querySelector('.chat-tool-status');
      if (statusEl) statusEl.textContent = status;
      if (result) {
        const resultEl = document.createElement('div');
        resultEl.className = 'chat-tool-result';
        resultEl.innerHTML = '<pre>' + escapeHtml(typeof result === 'string' ? result : JSON.stringify(result, null, 2)) + '</pre>';
        el.appendChild(resultEl);
      }
    }
  }

  function appendReasoning(step) {
    const messagesEl = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-reasoning';
    el.innerHTML = '<span class="chat-reasoning-icon">💭</span>' + escapeHtml(step || '');
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Send / Abort ────────────────────────────────────────────────
  function sendMessage() {
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content || isStreaming) return;

    // Generate session ID if needed
    if (!currentSessionId) {
      currentSessionId = crypto.randomUUID ? crypto.randomUUID() :
        'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    }

    // Display user message immediately
    appendMessage('user', content);
    input.value = '';
    input.style.height = 'auto';

    // Send via WebSocket if connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        content: content,
        session_id: currentSessionId,
        agent_name: currentAgentName,
      }));
      setStreaming(true);
      setStatus('sending...');
    } else {
      // Fallback to HTTP
      fetch(HOST + '/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content,
          session_id: currentSessionId,
          agent_name: currentAgentName,
        }),
      }).then((r) => r.json()).then((data) => {
        if (data.error) {
          appendMessage('system', '❌ ' + data.error);
        }
      }).catch((e) => {
        appendMessage('system', '❌ ' + e.message);
      });
    }

    // Refresh sessions list
    setTimeout(loadSessions, 500);
  }

  function abortRun() {
    if (ws && ws.readyState === WebSocket.OPEN && currentRunId) {
      ws.send(JSON.stringify({
        type: 'chat_abort',
        run_id: currentRunId,
      }));
    }
    setStreaming(false);
    setStatus('aborted');
  }

  // ── UI State ────────────────────────────────────────────────────
  function setStatus(status) {
    const el = document.getElementById('chat-header-status');
    if (el) {
      el.textContent = status;
      el.className = 'chat-header-status chat-status-' + status.replace(/[^a-z]/g, '');
    }
  }

  function setStreaming(val) {
    isStreaming = val;
    const abortBtn = document.getElementById('chat-abort-btn');
    const sendBtn = document.getElementById('chat-send-btn');
    if (abortBtn) abortBtn.style.display = val ? '' : 'none';
    if (sendBtn) sendBtn.disabled = val;
    if (!val) {
      currentRunId = null;
      currentDeltaEl = null;
      currentDeltaText = '';
    }
  }

  // ── Register as dashboard plugin ─────────────────────────────────
  if (typeof window !== 'undefined') {
    window.__praisonai_register_view = window.__praisonai_register_view || [];
    window.__praisonai_register_view.push({
      id: 'chat',
      title: 'Chat',
      icon: '💬',
      group: 'Control',
      order: 5,
      init: createChatView,
    });
  }
})();
