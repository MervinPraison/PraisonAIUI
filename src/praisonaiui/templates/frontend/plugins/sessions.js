/**
 * AIUI Sessions Dashboard Plugin
 *
 * Enhanced session management with reset, compact, and preview.
 */

let sessions = [];
let selectedSession = null;

async function fetchSessions() {
  try {
    const resp = await fetch('/sessions');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    sessions = data.sessions || [];
    return sessions;
  } catch (e) {
    console.warn('[AIUI:sessions] Fetch error:', e);
    return [];
  }
}

async function resetSession(sessionId) {
  if (!confirm(`Reset session "${sessionId}"? This will clear all messages but keep the session.`)) return;
  
  try {
    const resp = await fetch(`/api/sessions/${sessionId}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'clear' }),
    });
    const data = await resp.json();
    alert(`Session reset at ${new Date(data.timestamp * 1000).toLocaleTimeString()}`);
    renderSessionsUI();
  } catch (e) {
    alert('Failed to reset session: ' + e.message);
  }
}

async function compactSession(sessionId) {
  try {
    const resp = await fetch(`/api/sessions/${sessionId}/compact`, { method: 'POST' });
    const data = await resp.json();
    
    const saved = data.saved_tokens || 0;
    const before = data.before?.messages || 0;
    const after = data.after?.messages || 0;
    
    alert(`Compacted session:\n• Messages: ${before} → ${after}\n• Tokens saved: ~${saved}`);
    renderSessionsUI();
  } catch (e) {
    alert('Failed to compact session: ' + e.message);
  }
}

async function previewSession(sessionId) {
  try {
    const resp = await fetch(`/api/sessions/${sessionId}/preview`);
    const data = await resp.json();
    
    const modal = document.createElement('div');
    modal.className = 'aiui-session-modal';
    modal.innerHTML = `
      <div class="aiui-session-modal-content">
        <div class="aiui-modal-header">
          <h3>Session Preview: ${sessionId}</h3>
          <button onclick="this.closest('.aiui-session-modal').remove()">✕</button>
        </div>
        <div class="aiui-modal-body">
          <div class="aiui-preview-stat">
            <span class="label">Total Messages</span>
            <span class="value">${data.total_messages}</span>
          </div>
          <div class="aiui-preview-stat">
            <span class="label">Estimated Tokens</span>
            <span class="value">${data.estimated_tokens}</span>
          </div>
          ${data.labels?.length ? `
          <div class="aiui-preview-stat">
            <span class="label">Labels</span>
            <span class="value">${data.labels.join(', ')}</span>
          </div>
          ` : ''}
          ${data.first_message ? `
          <div class="aiui-preview-message">
            <div class="aiui-message-role">${data.first_message.role}</div>
            <div class="aiui-message-preview">${data.first_message.preview || '(empty)'}</div>
          </div>
          ` : ''}
          ${data.last_message && data.total_messages > 1 ? `
          <div class="aiui-preview-message">
            <div class="aiui-message-role">${data.last_message.role}</div>
            <div class="aiui-message-preview">${data.last_message.preview || '(empty)'}</div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  } catch (e) {
    alert('Failed to preview session: ' + e.message);
  }
}

async function deleteSession(sessionId) {
  if (!confirm(`Delete session "${sessionId}"? This cannot be undone.`)) return;
  
  try {
    const resp = await fetch(`/sessions/${sessionId}`, { method: 'DELETE' });
    if (resp.ok) {
      await fetchSessions();
      renderSessionsUI();
    }
  } catch (e) {
    alert('Failed to delete session: ' + e.message);
  }
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

function renderSessionCard(session) {
  const id = session.session_id || session.id;
  return `
    <div class="aiui-session-card">
      <div class="aiui-session-info">
        <div class="aiui-session-id">${id}</div>
        <div class="aiui-session-meta">
          ${session.created_at ? `Created: ${formatDate(session.created_at)}` : ''}
        </div>
      </div>
      <div class="aiui-session-actions">
        <button class="aiui-btn-icon" onclick="window.aiuiPreviewSession('${id}')" title="Preview">👁</button>
        <button class="aiui-btn-icon" onclick="window.aiuiCompactSession('${id}')" title="Compact">📦</button>
        <button class="aiui-btn-icon" onclick="window.aiuiResetSession('${id}')" title="Reset">↺</button>
        <button class="aiui-btn-icon danger" onclick="window.aiuiDeleteSession('${id}')" title="Delete">🗑</button>
      </div>
    </div>
  `;
}

function renderSessionsUI() {
  const container = document.querySelector('[data-aiui-sessions]');
  if (!container) return;
  
  container.innerHTML = `
    <div class="aiui-sessions-header">
      <h2>Sessions</h2>
      <span class="aiui-sessions-count">${sessions.length} sessions</span>
    </div>
    
    <div class="aiui-sessions-list">
      ${sessions.length === 0 
        ? '<div class="aiui-sessions-empty">No sessions</div>'
        : sessions.map(renderSessionCard).join('')
      }
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-sessions-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-sessions-styles';
  style.textContent = `
    [data-aiui-sessions] {
      padding: 1.5rem;
      max-width: 900px;
      margin: 0 auto;
    }

    .aiui-sessions-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .aiui-sessions-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-sessions-count {
      font-size: 0.875rem;
      color: #64748b;
    }

    .aiui-sessions-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .aiui-session-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      padding: 1rem;
    }

    .aiui-session-id {
      font-size: 0.9375rem;
      font-weight: 500;
      color: #e2e8f0;
    }

    .aiui-session-meta {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 0.25rem;
    }

    .aiui-session-actions {
      display: flex;
      gap: 0.5rem;
    }

    .aiui-btn-icon {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 0.375rem;
      background: rgba(148, 163, 184, 0.1);
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .aiui-btn-icon:hover {
      background: rgba(148, 163, 184, 0.2);
    }

    .aiui-btn-icon.danger:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    .aiui-sessions-empty {
      text-align: center;
      padding: 2rem;
      color: #64748b;
    }

    .aiui-session-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .aiui-session-modal-content {
      background: #1e293b;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.75rem;
      width: 90%;
      max-width: 500px;
      max-height: 80vh;
      overflow: auto;
    }

    .aiui-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-modal-header h3 {
      margin: 0;
      font-size: 1rem;
      color: #f1f5f9;
    }

    .aiui-modal-header button {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 1.25rem;
    }

    .aiui-modal-body {
      padding: 1.25rem;
    }

    .aiui-preview-stat {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-preview-stat .label {
      color: #64748b;
      font-size: 0.875rem;
    }

    .aiui-preview-stat .value {
      color: #e2e8f0;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .aiui-preview-message {
      margin-top: 1rem;
      padding: 0.75rem;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 0.375rem;
    }

    .aiui-message-role {
      font-size: 0.6875rem;
      text-transform: uppercase;
      color: #3b82f6;
      margin-bottom: 0.25rem;
    }

    .aiui-message-preview {
      font-size: 0.8125rem;
      color: #94a3b8;
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);
}

// Expose functions globally
window.aiuiResetSession = resetSession;
window.aiuiCompactSession = compactSession;
window.aiuiPreviewSession = previewSession;
window.aiuiDeleteSession = deleteSession;

function checkForSessionsPage(root) {
  const sessionsSection = root.querySelector('[data-page="sessions"]') ||
                          root.querySelector('.sessions-page') ||
                          root.querySelector('#sessions');
  
  if (sessionsSection && !sessionsSection.hasAttribute('data-aiui-sessions')) {
    sessionsSection.setAttribute('data-aiui-sessions', 'true');
    fetchSessions().then(renderSessionsUI);
  }
}

export default {
  name: 'sessions',
  async init() {
    injectStyles();
    console.debug('[AIUI:sessions] Plugin loaded');
  },
  onContentChange(root) {
    checkForSessionsPage(root);
  },
};
