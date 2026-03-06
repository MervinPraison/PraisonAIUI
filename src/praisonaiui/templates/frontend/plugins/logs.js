/**
 * AIUI Logs Dashboard Plugin
 *
 * Real-time log streaming with level filtering, search, and auto-scroll.
 */

let ws = null;
let logs = [];
let levelFilter = 'DEBUG';
let searchFilter = '';
let autoScroll = true;
let paused = false;

const LEVEL_COLORS = {
  DEBUG: '#6b7280',
  INFO: '#3b82f6',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  CRITICAL: '#dc2626',
};

const LEVEL_PRIORITY = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/logs/stream?level=${levelFilter}&search=${encodeURIComponent(searchFilter)}`;
  
  ws = new WebSocket(url);
  
  ws.onopen = () => {
    console.debug('[AIUI:logs] WebSocket connected');
    updateConnectionStatus(true);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'initial' || data.type === 'filtered') {
      logs = data.data || [];
      renderLogs();
    } else if (data.type === 'log') {
      if (!paused && shouldShowLog(data.data)) {
        logs.push(data.data);
        if (logs.length > 500) logs.shift();
        renderLogs();
      }
    } else if (data.type === 'cleared') {
      logs = [];
      renderLogs();
    }
  };
  
  ws.onclose = () => {
    console.debug('[AIUI:logs] WebSocket disconnected');
    updateConnectionStatus(false);
    setTimeout(connectWebSocket, 3000);
  };
  
  ws.onerror = (err) => {
    console.warn('[AIUI:logs] WebSocket error:', err);
  };
}

function shouldShowLog(entry) {
  const entryPriority = LEVEL_PRIORITY[entry.level] || 20;
  const filterPriority = LEVEL_PRIORITY[levelFilter] || 10;
  
  if (entryPriority < filterPriority) return false;
  if (searchFilter && !entry.message.toLowerCase().includes(searchFilter.toLowerCase())) return false;
  
  return true;
}

function updateConnectionStatus(connected) {
  const status = document.querySelector('.aiui-logs-status');
  if (status) {
    status.className = `aiui-logs-status ${connected ? 'connected' : 'disconnected'}`;
    status.textContent = connected ? '● Connected' : '○ Disconnected';
  }
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderLogEntry(entry) {
  const color = LEVEL_COLORS[entry.level] || LEVEL_COLORS.INFO;
  return `
    <div class="aiui-log-entry" data-level="${entry.level}">
      <span class="aiui-log-time">${formatTimestamp(entry.timestamp)}</span>
      <span class="aiui-log-level" style="color: ${color}">${entry.level}</span>
      <span class="aiui-log-logger">${entry.logger || ''}</span>
      <span class="aiui-log-message">${escapeHtml(entry.message)}</span>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderLogs() {
  const container = document.querySelector('.aiui-logs-content');
  if (!container) return;
  
  const filteredLogs = logs.filter(shouldShowLog);
  
  if (filteredLogs.length === 0) {
    container.innerHTML = '<div class="aiui-logs-empty">No logs matching filters</div>';
    return;
  }
  
  container.innerHTML = filteredLogs.map(renderLogEntry).join('');
  
  if (autoScroll && !paused) {
    container.scrollTop = container.scrollHeight;
  }
  
  // Update count
  const count = document.querySelector('.aiui-logs-count');
  if (count) {
    count.textContent = `${filteredLogs.length} / ${logs.length} logs`;
  }
}

function setLevelFilter(level) {
  levelFilter = level;
  
  // Update UI
  document.querySelectorAll('.aiui-level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === level);
  });
  
  // Send filter update to server
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'filter', level, search: searchFilter }));
  }
}

function setSearchFilter(search) {
  searchFilter = search;
  renderLogs();
}

function togglePause() {
  paused = !paused;
  const btn = document.querySelector('.aiui-pause-btn');
  if (btn) {
    btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    btn.classList.toggle('paused', paused);
  }
}

function clearLogs() {
  fetch('/api/logs/clear', { method: 'POST' })
    .then(() => {
      logs = [];
      renderLogs();
    })
    .catch(err => console.warn('[AIUI:logs] Clear error:', err));
}

function renderLogsUI() {
  const container = document.querySelector('[data-aiui-logs]');
  if (!container) return;
  
  container.innerHTML = `
    <div class="aiui-logs-header">
      <div class="aiui-logs-title">
        <h2>Logs</h2>
        <span class="aiui-logs-status disconnected">○ Disconnected</span>
      </div>
      <div class="aiui-logs-controls">
        <span class="aiui-logs-count">0 logs</span>
      </div>
    </div>
    
    <div class="aiui-logs-toolbar">
      <div class="aiui-level-filters">
        <button class="aiui-level-btn active" data-level="DEBUG" onclick="window.aiuiSetLogLevel('DEBUG')">DEBUG</button>
        <button class="aiui-level-btn" data-level="INFO" onclick="window.aiuiSetLogLevel('INFO')">INFO</button>
        <button class="aiui-level-btn" data-level="WARNING" onclick="window.aiuiSetLogLevel('WARNING')">WARNING</button>
        <button class="aiui-level-btn" data-level="ERROR" onclick="window.aiuiSetLogLevel('ERROR')">ERROR</button>
      </div>
      <div class="aiui-logs-search">
        <input type="text" placeholder="Search logs..." oninput="window.aiuiSetLogSearch(this.value)">
      </div>
      <div class="aiui-logs-actions">
        <button class="aiui-pause-btn" onclick="window.aiuiTogglePause()">⏸ Pause</button>
        <button class="aiui-clear-btn" onclick="window.aiuiClearLogs()">🗑 Clear</button>
      </div>
    </div>
    
    <div class="aiui-logs-content"></div>
  `;
  
  connectWebSocket();
}

function injectStyles() {
  if (document.querySelector('#aiui-logs-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-logs-styles';
  style.textContent = `
    [data-aiui-logs] {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 1rem;
      max-width: 100%;
    }

    .aiui-logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .aiui-logs-title {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .aiui-logs-title h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-logs-status {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 9999px;
    }

    .aiui-logs-status.connected {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-logs-status.disconnected {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    .aiui-logs-count {
      font-size: 0.8125rem;
      color: #64748b;
    }

    .aiui-logs-toolbar {
      display: flex;
      gap: 1rem;
      align-items: center;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }

    .aiui-level-filters {
      display: flex;
      gap: 0.25rem;
    }

    .aiui-level-btn {
      padding: 0.375rem 0.75rem;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.6875rem;
      font-weight: 600;
      cursor: pointer;
      background: rgba(148, 163, 184, 0.1);
      color: #94a3b8;
      transition: all 0.2s;
    }

    .aiui-level-btn:hover {
      background: rgba(148, 163, 184, 0.2);
    }

    .aiui-level-btn.active {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }

    .aiui-level-btn[data-level="DEBUG"].active { background: rgba(107, 114, 128, 0.2); color: #6b7280; }
    .aiui-level-btn[data-level="INFO"].active { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
    .aiui-level-btn[data-level="WARNING"].active { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
    .aiui-level-btn[data-level="ERROR"].active { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

    .aiui-logs-search input {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.375rem;
      padding: 0.375rem 0.75rem;
      color: #e2e8f0;
      font-size: 0.8125rem;
      width: 200px;
    }

    .aiui-logs-search input:focus {
      outline: none;
      border-color: #3b82f6;
    }

    .aiui-logs-actions {
      display: flex;
      gap: 0.5rem;
      margin-left: auto;
    }

    .aiui-pause-btn, .aiui-clear-btn {
      padding: 0.375rem 0.75rem;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      cursor: pointer;
      background: rgba(148, 163, 184, 0.1);
      color: #94a3b8;
    }

    .aiui-pause-btn.paused {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-logs-content {
      flex: 1;
      overflow-y: auto;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      padding: 0.5rem;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.75rem;
      line-height: 1.5;
    }

    .aiui-log-entry {
      display: flex;
      gap: 0.5rem;
      padding: 0.125rem 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    }

    .aiui-log-entry:hover {
      background: rgba(148, 163, 184, 0.05);
    }

    .aiui-log-time {
      color: #64748b;
      flex-shrink: 0;
    }

    .aiui-log-level {
      font-weight: 600;
      width: 60px;
      flex-shrink: 0;
    }

    .aiui-log-logger {
      color: #8b5cf6;
      flex-shrink: 0;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .aiui-log-message {
      color: #e2e8f0;
      word-break: break-word;
    }

    .aiui-logs-empty {
      text-align: center;
      padding: 2rem;
      color: #64748b;
    }

    @media (max-width: 768px) {
      .aiui-logs-toolbar {
        flex-direction: column;
        align-items: flex-start;
      }
      .aiui-logs-actions {
        margin-left: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForLogsPage(root) {
  const logsSection = root.querySelector('[data-page="logs"]') ||
                      root.querySelector('.logs-page') ||
                      root.querySelector('#logs');
  
  if (logsSection && !logsSection.hasAttribute('data-aiui-logs')) {
    logsSection.setAttribute('data-aiui-logs', 'true');
    renderLogsUI();
  }
}

// Expose functions globally
window.aiuiSetLogLevel = setLevelFilter;
window.aiuiSetLogSearch = setSearchFilter;
window.aiuiTogglePause = togglePause;
window.aiuiClearLogs = clearLogs;

export default {
  name: 'logs',
  async init() {
    injectStyles();
    console.debug('[AIUI:logs] Plugin loaded');
  },
  onContentChange(root) {
    checkForLogsPage(root);
  },
  destroy() {
    if (ws) {
      ws.close();
      ws = null;
    }
  },
};
