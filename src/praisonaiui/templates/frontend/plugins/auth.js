/**
 * AIUI Auth Plugin
 *
 * Authentication management UI with API keys and session management.
 */
import { showToast, showConfirm } from './toast.js';

let authConfig = null;
let apiKeys = [];

async function fetchAuthConfig() {
  try {
    const resp = await fetch('/api/auth/config');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    authConfig = await resp.json();
    return authConfig;
  } catch (e) {
    console.warn('[AIUI:auth] Config fetch error:', e);
    return { mode: 'none' };
  }
}

async function fetchApiKeys() {
  try {
    const resp = await fetch('/api/auth/keys');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    apiKeys = data.keys || [];
    return apiKeys;
  } catch (e) {
    console.warn('[AIUI:auth] Keys fetch error:', e);
    return [];
  }
}

async function setAuthMode(mode) {
  try {
    const resp = await fetch('/api/auth/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (resp.ok) {
      await fetchAuthConfig();
      renderAuthUI();
    }
  } catch (e) {
    showToast('Failed to set auth mode: ' + e.message, 'error');
  }
}

async function createApiKey() {
  const name = prompt('Enter a name for this API key:');
  if (!name) return;
  
  try {
    const resp = await fetch('/api/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await resp.json();
    
    if (data.key) {
      showToast(`API Key created! Key: ${data.key} — Copy this key now, it won't be shown again!`, 'success', 10000);
      await fetchApiKeys();
      renderAuthUI();
    }
  } catch (e) {
    showToast('Failed to create API key: ' + e.message, 'error');
  }
}

async function revokeApiKey(keyId) {
  if (!await showConfirm('Revoke API Key', 'Revoke this API key? This cannot be undone.')) return;
  
  try {
    const resp = await fetch(`/api/auth/keys/${keyId}`, { method: 'DELETE' });
    if (resp.ok) {
      await fetchApiKeys();
      renderAuthUI();
    }
  } catch (e) {
    showToast('Failed to revoke API key: ' + e.message, 'error');
  }
}

async function setPassword() {
  const password = prompt('Enter new password (min 8 characters):');
  if (!password || password.length < 8) {
    showToast('Password must be at least 8 characters', 'error');
    return;
  }
  
  try {
    const resp = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (resp.ok) {
      showToast('Password set successfully!', 'success');
      await fetchAuthConfig();
      renderAuthUI();
    }
  } catch (e) {
    showToast('Failed to set password: ' + e.message, 'error');
  }
}

function formatDate(timestamp) {
  if (!timestamp) return 'Never';
  return new Date(timestamp * 1000).toLocaleString();
}

function renderAuthUI() {
  const container = document.querySelector('[data-aiui-auth]');
  if (!container) return;
  
  const mode = authConfig?.mode || 'none';
  
  container.innerHTML = `
    <div class="aiui-auth-header">
      <h2>Authentication</h2>
    </div>
    
    <div class="aiui-auth-section">
      <h3>Auth Mode</h3>
      <div class="aiui-auth-modes">
        <button class="${mode === 'none' ? 'active' : ''}" onclick="window.aiuiSetAuthMode('none')">
          🔓 None
        </button>
        <button class="${mode === 'api_key' ? 'active' : ''}" onclick="window.aiuiSetAuthMode('api_key')">
          🔑 API Key
        </button>
        <button class="${mode === 'session' ? 'active' : ''}" onclick="window.aiuiSetAuthMode('session')">
          🎫 Session
        </button>
        <button class="${mode === 'password' ? 'active' : ''}" onclick="window.aiuiSetAuthMode('password')">
          🔐 Password
        </button>
      </div>
      <p class="aiui-auth-mode-desc">
        ${mode === 'none' ? 'No authentication required. Anyone can access the dashboard.' : ''}
        ${mode === 'api_key' ? 'Requires X-API-Key header or ?api_key= query parameter.' : ''}
        ${mode === 'session' ? 'Requires login to get a session token.' : ''}
        ${mode === 'password' ? 'Requires password to login.' : ''}
      </p>
    </div>
    
    ${mode === 'password' ? `
    <div class="aiui-auth-section">
      <h3>Password</h3>
      <p class="aiui-auth-status">
        ${authConfig?.password_set ? '✓ Password is set' : '⚠️ No password set'}
      </p>
      <button class="aiui-btn-primary" onclick="window.aiuiSetPassword()">
        ${authConfig?.password_set ? 'Change Password' : 'Set Password'}
      </button>
    </div>
    ` : ''}
    
    <div class="aiui-auth-section">
      <h3>API Keys</h3>
      <div class="aiui-api-keys-list">
        ${apiKeys.length === 0 
          ? '<p class="aiui-auth-empty">No API keys</p>'
          : apiKeys.map(key => `
            <div class="aiui-api-key-item">
              <div class="aiui-api-key-info">
                <span class="aiui-api-key-name">${key.name}</span>
                <span class="aiui-api-key-id">${key.id}</span>
              </div>
              <div class="aiui-api-key-meta">
                <span>Created: ${formatDate(key.created_at)}</span>
                <span>Last used: ${formatDate(key.last_used)}</span>
              </div>
              <button class="aiui-btn-danger" onclick="window.aiuiRevokeKey('${key.id}')">Revoke</button>
            </div>
          `).join('')
        }
      </div>
      <button class="aiui-btn-primary" onclick="window.aiuiCreateApiKey()">+ Create API Key</button>
    </div>
    
    <div class="aiui-auth-section">
      <h3>Active Sessions</h3>
      <p class="aiui-auth-status">${authConfig?.sessions_count || 0} active sessions</p>
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-auth-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-auth-styles';
  style.textContent = `
    [data-aiui-auth] {
      padding: 1.5rem;
      max-width: 800px;
      margin: 0 auto;
    }

    .aiui-auth-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0 0 1.5rem 0;
    }

    .aiui-auth-section {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }

    .aiui-auth-section h3 {
      font-size: 1rem;
      color: #e2e8f0;
      margin: 0 0 1rem 0;
    }

    .aiui-auth-modes {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .aiui-auth-modes button {
      padding: 0.5rem 1rem;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.375rem;
      background: rgba(15, 23, 42, 0.6);
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.875rem;
    }

    .aiui-auth-modes button.active {
      background: rgba(59, 130, 246, 0.2);
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .aiui-auth-mode-desc {
      font-size: 0.8125rem;
      color: #64748b;
      margin: 1rem 0 0 0;
    }

    .aiui-auth-status {
      font-size: 0.875rem;
      color: #94a3b8;
      margin: 0 0 1rem 0;
    }

    .aiui-auth-empty {
      font-size: 0.875rem;
      color: #64748b;
      margin: 0;
    }

    .aiui-api-keys-list {
      margin-bottom: 1rem;
    }

    .aiui-api-key-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 0.375rem;
      margin-bottom: 0.5rem;
    }

    .aiui-api-key-info {
      flex: 1;
    }

    .aiui-api-key-name {
      display: block;
      font-size: 0.9375rem;
      color: #e2e8f0;
    }

    .aiui-api-key-id {
      font-size: 0.75rem;
      color: #64748b;
      font-family: monospace;
    }

    .aiui-api-key-meta {
      display: flex;
      flex-direction: column;
      font-size: 0.75rem;
      color: #64748b;
    }

    .aiui-btn-primary {
      padding: 0.5rem 1rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.875rem;
    }

    .aiui-btn-danger {
      padding: 0.375rem 0.75rem;
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.75rem;
    }
  `;
  document.head.appendChild(style);
}

// Expose functions globally
window.aiuiSetAuthMode = setAuthMode;
window.aiuiCreateApiKey = createApiKey;
window.aiuiRevokeKey = revokeApiKey;
window.aiuiSetPassword = setPassword;

function checkForAuthPage(root) {
  const authSection = root.querySelector('[data-page="auth"]') ||
                      root.querySelector('.auth-page') ||
                      root.querySelector('#auth');
  
  if (authSection && !authSection.hasAttribute('data-aiui-auth')) {
    authSection.setAttribute('data-aiui-auth', 'true');
    Promise.all([fetchAuthConfig(), fetchApiKeys()]).then(renderAuthUI);
  }
}

export default {
  name: 'auth',
  async init() {
    injectStyles();
    console.debug('[AIUI:auth] Plugin loaded');
  },
  onContentChange(root) {
    checkForAuthPage(root);
  },
};
