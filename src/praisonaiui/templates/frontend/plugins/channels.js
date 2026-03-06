/**
 * AIUI Channels Dashboard Plugin
 *
 * Renders a dashboard view for messaging platform channels (Discord, Slack, Telegram, WhatsApp).
 * Shows channel status, connection health, and provides restart functionality.
 */

let channelsData = null;
let refreshInterval = null;

const PLATFORM_ICONS = {
  telegram: '📱',
  discord: '🎮',
  slack: '💼',
  whatsapp: '💬',
  imessage: '💙',
  signal: '🔒',
  googlechat: '💬',
  nostr: '🟣',
  default: '📡'
};

const STATUS_COLORS = {
  running: '#22c55e',    // green
  enabled: '#eab308',    // yellow
  stopped: '#ef4444',    // red
  error: '#ef4444',      // red
  not_configured: '#6b7280' // gray
};

async function fetchChannels() {
  try {
    const resp = await fetch('/api/channels');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    channelsData = data;
    return data;
  } catch (e) {
    console.warn('[AIUI:channels] Fetch error:', e);
    return { channels: [], count: 0 };
  }
}

async function restartChannel(channelId) {
  try {
    const resp = await fetch(`/api/channels/${channelId}/restart`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) {
      showNotification(`Channel "${channelId}" restart initiated`, 'success');
      await fetchChannels();
      renderChannelsUI();
    } else {
      showNotification(data.error || 'Restart failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.aiui-channels-notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'aiui-channels-notification';
  notif.style.cssText = `
    position: fixed;
    top: 1rem;
    right: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    font-size: 0.875rem;
    z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

function getStatusDot(status) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.not_configured;
  return `<span style="
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: ${color};
    margin-right: 0.5rem;
    box-shadow: 0 0 4px ${color};
  "></span>`;
}

function getPlatformIcon(platform) {
  return PLATFORM_ICONS[platform?.toLowerCase()] || PLATFORM_ICONS.default;
}

function formatLastActivity(timestamp) {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function renderChannelCard(channel) {
  const status = channel.running ? 'running' : (channel.enabled ? 'enabled' : 'stopped');
  const statusText = channel.running ? 'Online' : (channel.enabled ? 'Enabled' : 'Offline');
  
  return `
    <div class="aiui-channel-card" data-channel-id="${channel.id}">
      <div class="aiui-channel-header">
        <span class="aiui-channel-icon">${getPlatformIcon(channel.platform)}</span>
        <div class="aiui-channel-info">
          <h3 class="aiui-channel-name">${channel.name || channel.id}</h3>
          <span class="aiui-channel-platform">${channel.platform || 'Unknown'}</span>
        </div>
        <div class="aiui-channel-status">
          ${getStatusDot(status)}
          <span>${statusText}</span>
        </div>
      </div>
      <div class="aiui-channel-details">
        <div class="aiui-channel-stat">
          <span class="aiui-stat-label">Last Activity</span>
          <span class="aiui-stat-value">${formatLastActivity(channel.last_activity)}</span>
        </div>
        <div class="aiui-channel-stat">
          <span class="aiui-stat-label">Status</span>
          <span class="aiui-stat-value">${channel.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
      <div class="aiui-channel-actions">
        <button class="aiui-btn aiui-btn-restart" onclick="window.aiuiRestartChannel('${channel.id}')">
          🔄 Restart
        </button>
      </div>
    </div>
  `;
}

function renderChannelsUI() {
  const container = document.querySelector('[data-aiui-channels]');
  if (!container) return;

  if (!channelsData || channelsData.channels.length === 0) {
    container.innerHTML = `
      <div class="aiui-channels-empty">
        <div class="aiui-empty-icon">📡</div>
        <h3>No Channels Configured</h3>
        <p>Add messaging channels to connect your AI agents to Discord, Slack, Telegram, or WhatsApp.</p>
        <p class="aiui-empty-hint">Use the API or CLI to add channels.</p>
      </div>
    `;
    return;
  }

  const cards = channelsData.channels.map(renderChannelCard).join('');
  container.innerHTML = `
    <div class="aiui-channels-header">
      <h2>Messaging Channels</h2>
      <div class="aiui-channels-summary">
        <span class="aiui-summary-stat">
          ${getStatusDot('running')} ${channelsData.channels.filter(c => c.running).length} Online
        </span>
        <span class="aiui-summary-stat">
          ${channelsData.count} Total
        </span>
      </div>
    </div>
    <div class="aiui-channels-grid">
      ${cards}
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-channels-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-channels-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    [data-aiui-channels] {
      padding: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .aiui-channels-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-channels-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-channels-summary {
      display: flex;
      gap: 1.5rem;
    }

    .aiui-summary-stat {
      display: flex;
      align-items: center;
      font-size: 0.875rem;
      color: #94a3b8;
    }

    .aiui-channels-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    .aiui-channel-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.25rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .aiui-channel-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }

    .aiui-channel-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .aiui-channel-icon {
      font-size: 2rem;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(56, 189, 248, 0.1);
      border-radius: 0.5rem;
    }

    .aiui-channel-info {
      flex: 1;
    }

    .aiui-channel-name {
      font-size: 1rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0 0 0.25rem 0;
    }

    .aiui-channel-platform {
      font-size: 0.75rem;
      color: #64748b;
      text-transform: capitalize;
    }

    .aiui-channel-status {
      display: flex;
      align-items: center;
      font-size: 0.8125rem;
      color: #94a3b8;
    }

    .aiui-channel-details {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1rem;
      padding: 0.75rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 0.5rem;
    }

    .aiui-channel-stat {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .aiui-stat-label {
      font-size: 0.6875rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .aiui-stat-value {
      font-size: 0.875rem;
      color: #e2e8f0;
    }

    .aiui-channel-actions {
      display: flex;
      gap: 0.5rem;
    }

    .aiui-btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
    }

    .aiui-btn:active {
      transform: scale(0.98);
    }

    .aiui-btn-restart {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .aiui-btn-restart:hover {
      background: rgba(56, 189, 248, 0.25);
    }

    .aiui-channels-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: #94a3b8;
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .aiui-channels-empty h3 {
      font-size: 1.25rem;
      color: #e2e8f0;
      margin: 0 0 0.5rem 0;
    }

    .aiui-channels-empty p {
      margin: 0.5rem 0;
      max-width: 400px;
      margin-left: auto;
      margin-right: auto;
    }

    .aiui-empty-hint {
      font-size: 0.8125rem;
      color: #64748b;
    }

    @media (max-width: 768px) {
      .aiui-channels-grid {
        grid-template-columns: 1fr;
      }
      .aiui-channels-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForChannelsPage(root) {
  // Look for a channels page container or dashboard section
  const channelsSection = root.querySelector('[data-page="channels"]') ||
                          root.querySelector('.channels-page') ||
                          root.querySelector('#channels');
  
  if (channelsSection && !channelsSection.hasAttribute('data-aiui-channels')) {
    channelsSection.setAttribute('data-aiui-channels', 'true');
    fetchChannels().then(renderChannelsUI);
    
    // Set up auto-refresh every 30 seconds
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      await fetchChannels();
      renderChannelsUI();
    }, 30000);
  }
}

// Expose restart function globally for onclick handlers
window.aiuiRestartChannel = restartChannel;

export default {
  name: 'channels',
  async init() {
    injectStyles();
    console.debug('[AIUI:channels] Plugin loaded');
  },
  onContentChange(root) {
    checkForChannelsPage(root);
  },
};
