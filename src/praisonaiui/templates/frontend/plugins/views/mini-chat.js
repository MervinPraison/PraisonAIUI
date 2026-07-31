/**
 * Mini-chat transport — shared agent WebSocket bridge for embedded chat panes.
 *
 * Reuses the same wire protocol as the full Chat view (chat.js): it connects
 * to /api/chat/ws, sends { type:'chat', content, session_id, agent_name },
 * and streams run_content / run_completed / run_error events back to the caller.
 *
 * The full Chat view keeps its own rich rendering; this module only owns the
 * transport so embedded surfaces (Work Hub Chat tab, etc.) can send to and
 * stream from the same agent without rebuilding chat from scratch.
 *
 * Usage:
 *   import { createMiniChat } from '/plugins/views/mini-chat.js';
 *   const chat = createMiniChat({ agentId, sessionId });
 *   chat.send({ text, onDelta, onComplete, onError });
 *   chat.disconnect();  // on card change / teardown
 */

function wsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + location.host + '/api/chat/ws';
}

function genSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Create a mini-chat transport bound to one agent + session.
 *
 * @param {Object} opts
 * @param {string} [opts.agentId]   - Agent name to route the message to.
 * @param {string} [opts.sessionId] - Session id (generated if omitted).
 * @returns {{ send: Function, disconnect: Function, sessionId: string }}
 */
export function createMiniChat({ agentId = '', sessionId = '' } = {}) {
  let ws = null;
  let closed = false;
  const session = sessionId || genSessionId();
  let active = null;  // { onDelta, onComplete, onError, done }

  function finish(handler, arg) {
    if (!active || active.done) return;
    active.done = true;
    const cb = active[handler];
    active = null;
    if (typeof cb === 'function') {
      try { cb(arg); } catch (_) { /* caller handler error */ }
    }
  }

  function handle(data) {
    const type = data && data.type;
    switch (type) {
      case 'run_content':
      case 'team_run_content':
        if (data.token && active && typeof active.onDelta === 'function') {
          try { active.onDelta(data.token); } catch (_) { /* handler error */ }
        }
        break;
      case 'run_completed':
      case 'team_run_completed':
        finish('onComplete', data.content || '');
        break;
      case 'run_error':
      case 'team_run_error':
        finish('onError', new Error(data.error || 'Run error'));
        break;
      default:
        break;
    }
  }

  function ensureSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws;
    ws = new WebSocket(wsUrl());
    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (_) { return; }
      if (data.session_id && data.session_id !== session) return;
      handle(data);
    };
    ws.onerror = () => {
      finish('onError', new Error('Connection error'));
    };
    ws.onclose = () => {
      if (!closed) finish('onError', new Error('Connection closed'));
    };
    return ws;
  }

  function transmit(text) {
    const sock = ensureSocket();
    const payload = JSON.stringify({
      type: 'chat',
      content: text,
      session_id: session,
      agent_name: agentId || null,
    });
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(payload);
    } else if (sock.readyState === WebSocket.CONNECTING) {
      sock.addEventListener('open', () => {
        if (!closed) {
          try { sock.send(payload); } catch (_) { finish('onError', new Error('Connection error')); }
        }
      }, { once: true });
    } else {
      finish('onError', new Error('Connection unavailable'));
    }
  }

  /**
   * Send a user message and stream the agent reply.
   *
   * @param {Object} req
   * @param {string} req.text          - Message text.
   * @param {Function} [req.onDelta]    - Called with each streamed token.
   * @param {Function} [req.onComplete] - Called with the final content string.
   * @param {Function} [req.onError]    - Called with an Error on failure.
   */
  function send({ text, onDelta, onComplete, onError }) {
    if (closed) {
      if (typeof onError === 'function') onError(new Error('Disconnected'));
      return;
    }
    if (active && !active.done) {
      finish('onError', new Error('Superseded'));
    }
    active = { onDelta, onComplete, onError, done: false };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      finish('onError', new Error('You are offline.'));
      return;
    }
    try {
      transmit(String(text == null ? '' : text));
    } catch (_) {
      finish('onError', new Error('Connection error'));
    }
  }

  function disconnect() {
    closed = true;
    active = null;
    if (ws) {
      try { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); } catch (_) { /* noop */ }
      ws = null;
    }
  }

  return { send, disconnect, sessionId: session };
}
