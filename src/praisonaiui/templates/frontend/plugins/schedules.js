/**
 * AIUI Schedules Dashboard Plugin
 *
 * Renders a dashboard view for scheduled jobs (cron, interval, one-shot).
 * Shows job status, execution stats, and provides start/stop/run-now controls.
 */
import { showConfirm } from './toast.js';
import { pageToolbar } from './views/_helpers.js';

let schedulesData = null;
let refreshInterval = null;

const SCHEDULE_ICONS = {
  every: '🔄',
  cron: '⏰',
  once: '▶️',
  default: '📅'
};

const STATUS_COLORS = {
  running: 'var(--db-p-success, #22c55e)',
  enabled: 'var(--db-p-success, #22c55e)',
  stopped: 'var(--db-p-text-muted, #6b7280)',
  disabled: 'var(--db-p-text-muted, #6b7280)',
  error: 'var(--db-p-error, #ef4444)',
};

async function fetchSchedules() {
  try {
    const resp = await fetch('/api/schedules');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    schedulesData = data;
    return data;
  } catch (e) {
    console.warn('[AIUI:schedules] Fetch error:', e);
    return { schedules: [], count: 0 };
  }
}

async function runJob(jobId) {
  try {
    const resp = await fetch(`/api/schedules/${encodeURIComponent(jobId)}/run`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) {
      showNotification(`Job "${jobId}" triggered`, 'success');
      await fetchSchedules();
      renderSchedulesUI();
    } else {
      showNotification(data.error || 'Run failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function stopJob(jobId) {
  try {
    const resp = await fetch(`/api/schedules/${encodeURIComponent(jobId)}/stop`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) {
      showNotification(`Job "${jobId}" stopped`, 'success');
      await fetchSchedules();
      renderSchedulesUI();
    } else {
      showNotification(data.error || 'Stop failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function toggleJob(jobId) {
  try {
    const resp = await fetch(`/api/schedules/${encodeURIComponent(jobId)}/toggle`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) {
      const status = data.enabled ? 'enabled' : 'disabled';
      showNotification(`Job "${jobId}" ${status}`, 'success');
      await fetchSchedules();
      renderSchedulesUI();
    } else {
      showNotification(data.error || 'Toggle failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function deleteJob(jobId) {
  if (!await showConfirm('Delete Job', `Delete job "${jobId}"?`)) return;
  try {
    const resp = await fetch(`/api/schedules/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    if (resp.ok) {
      showNotification(`Job "${jobId}" deleted`, 'success');
      await fetchSchedules();
      renderSchedulesUI();
    } else {
      const data = await resp.json();
      showNotification(data.error || 'Delete failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.aiui-schedules-notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'aiui-schedules-notification';
  notif.style.cssText = `
    position: fixed;
    top: 1rem;
    right: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: ${type === 'success' ? 'var(--db-p-success-strong, #22c55e)' : type === 'error' ? 'var(--db-p-error-strong, #ef4444)' : 'var(--db-p-info, #3b82f6)'};
    color: white;
    font-size: 0.875rem;
    z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

function getStatusDot(enabled) {
  const color = enabled ? STATUS_COLORS.enabled : STATUS_COLORS.disabled;
  return `<span style="
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: ${color};
    margin-right: 0.5rem;
    ${enabled ? 'box-shadow: 0 0 4px ' + color + ';' : ''}
  "></span>`;
}

function getScheduleIcon(kind) {
  return SCHEDULE_ICONS[kind] || SCHEDULE_ICONS.default;
}

// Job fields come from the API (names, messages and cron expressions are user
// input) and are written with innerHTML, so they are escaped as HTML text.
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatInterval(schedule) {
  if (!schedule) return 'Unknown';
  const kind = schedule.kind;
  if (kind === 'cron' && schedule.cron_expr) {
    return `Cron: ${escapeHtml(schedule.cron_expr)}`;
  }
  if (kind === 'every' && schedule.every_seconds) {
    const secs = schedule.every_seconds;
    if (secs >= 86400) return `Every ${Math.floor(secs / 86400)}d`;
    if (secs >= 3600) return `Every ${Math.floor(secs / 3600)}h`;
    if (secs >= 60) return `Every ${Math.floor(secs / 60)}m`;
    return `Every ${secs}s`;
  }
  if (kind === 'once' && schedule.at) {
    return `Once at ${new Date(schedule.at * 1000).toLocaleString()}`;
  }
  return kind ? escapeHtml(kind) : 'Unknown';
}

function formatTimestamp(ts) {
  if (!ts) return 'Never';
  const date = new Date(ts * 1000);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 0) {
    // Future time
    const absDiff = Math.abs(diff);
    if (absDiff < 60) return `In ${absDiff}s`;
    if (absDiff < 3600) return `In ${Math.floor(absDiff / 60)}m`;
    if (absDiff < 86400) return `In ${Math.floor(absDiff / 3600)}h`;
    return date.toLocaleString();
  }
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function renderJobCard(job) {
  const schedule = job.schedule || {};
  const enabled = job.enabled !== false;
  const statusText = enabled ? 'Active' : 'Paused';
  
  return `
    <div class="aiui-schedule-card" data-job-id="${escapeHtml(job.id)}">
      <div class="aiui-schedule-header">
        <span class="aiui-schedule-icon">${getScheduleIcon(schedule.kind)}</span>
        <div class="aiui-schedule-info">
          <h3 class="aiui-schedule-name">${escapeHtml(job.name || job.id)}</h3>
          <span class="aiui-schedule-interval">${formatInterval(schedule)}</span>
        </div>
        <div class="aiui-schedule-status">
          ${getStatusDot(enabled)}
          <span>${statusText}</span>
        </div>
      </div>
      <div class="aiui-schedule-message">
        ${job.message ? escapeHtml(job.message) : '<em>No message</em>'}
      </div>
      <div class="aiui-schedule-details">
        <div class="aiui-schedule-stat">
          <span class="aiui-stat-label">Last Run</span>
          <span class="aiui-stat-value">${formatTimestamp(job.last_run_at)}</span>
        </div>
        <div class="aiui-schedule-stat">
          <span class="aiui-stat-label">Created</span>
          <span class="aiui-stat-value">${formatTimestamp(job.created_at)}</span>
        </div>
      </div>
      <div class="aiui-schedule-actions">
        <button class="aiui-btn aiui-btn-run" onclick="window.aiuiRunJob(this.closest('[data-job-id]').dataset.jobId)" title="Run Now">
          ▶️ Run
        </button>
        <button class="aiui-btn aiui-btn-toggle" onclick="window.aiuiToggleJob(this.closest('[data-job-id]').dataset.jobId)" title="${enabled ? 'Pause' : 'Resume'}">
          ${enabled ? '⏸️ Pause' : '▶️ Resume'}
        </button>
        <button class="aiui-btn aiui-btn-delete" onclick="window.aiuiDeleteSchedule(this.closest('[data-job-id]').dataset.jobId)" title="Delete">
          🗑️
        </button>
      </div>
    </div>
  `;
}

function renderSchedulesUI() {
  const container = document.querySelector('[data-aiui-schedules]');
  if (!container) return;

  if (!schedulesData || schedulesData.schedules.length === 0) {
    container.innerHTML = `
      <div class="aiui-schedules-empty">
        <div class="aiui-empty-icon">⏰</div>
        <h3>No Scheduled Jobs</h3>
        <p>Create scheduled jobs to run your AI agents automatically at regular intervals.</p>
        <p class="aiui-empty-hint">Use the API or CLI to add schedules.</p>
      </div>
    `;
    return;
  }

  const enabledCount = schedulesData.schedules.filter(j => j.enabled !== false).length;
  const cards = schedulesData.schedules.map(renderJobCard).join('');
  
  container.innerHTML = `
    ${pageToolbar('Scheduled Jobs', `<div class="aiui-schedules-summary"><span class="aiui-summary-stat">${getStatusDot(true)} ${enabledCount} Active</span><span class="aiui-summary-stat">${schedulesData.count} Total</span></div>`)}
    <div class="aiui-schedules-grid">
      ${cards}
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-schedules-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-schedules-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    [data-aiui-schedules] {
      padding: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .aiui-schedules-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--db-p-border, rgba(148, 163, 184, 0.1));
    }

    .aiui-schedules-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--db-p-text, #f1f5f9);
      margin: 0;
    }

    .aiui-schedules-summary {
      display: flex;
      gap: 1.5rem;
    }

    .aiui-summary-stat {
      display: flex;
      align-items: center;
      font-size: 0.875rem;
      color: var(--db-p-text-dim, #94a3b8);
    }

    .aiui-schedules-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1rem;
    }

    .aiui-schedule-card {
      background: linear-gradient(135deg, var(--db-p-card-bg, rgba(30, 41, 59, 0.8)) 0%, var(--db-p-card-bg, rgba(15, 23, 42, 0.9)) 100%);
      border: 1px solid var(--db-p-border, rgba(148, 163, 184, 0.1));
      border-radius: 0.75rem;
      padding: 1.25rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .aiui-schedule-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }

    .aiui-schedule-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .aiui-schedule-icon {
      font-size: 1.75rem;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--db-p-warning-bg, rgba(234, 179, 8, 0.1));
      border-radius: 0.5rem;
    }

    .aiui-schedule-info {
      flex: 1;
    }

    .aiui-schedule-name {
      font-size: 1rem;
      font-weight: 600;
      color: var(--db-p-text, #f1f5f9);
      margin: 0 0 0.25rem 0;
    }

    .aiui-schedule-interval {
      font-size: 0.75rem;
      color: var(--db-p-text-muted, #64748b);
    }

    .aiui-schedule-status {
      display: flex;
      align-items: center;
      font-size: 0.8125rem;
      color: var(--db-p-text-dim, #94a3b8);
    }

    .aiui-schedule-message {
      font-size: 0.875rem;
      color: var(--db-p-text-dim, #94a3b8);
      padding: 0.75rem;
      background: var(--db-p-canvas, rgba(0, 0, 0, 0.2));
      border-radius: 0.375rem;
      margin-bottom: 0.75rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .aiui-schedule-details {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1rem;
    }

    .aiui-schedule-stat {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .aiui-stat-label {
      font-size: 0.6875rem;
      color: var(--db-p-text-muted, #64748b);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .aiui-stat-value {
      font-size: 0.875rem;
      color: var(--db-p-text, #e2e8f0);
    }

    .aiui-schedule-actions {
      display: flex;
      gap: 0.5rem;
    }

    .aiui-btn {
      padding: 0.5rem 0.75rem;
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

    .aiui-btn-run {
      background: var(--db-p-success-bg, rgba(34, 197, 94, 0.15));
      color: var(--db-p-success, #22c55e);
      border: 1px solid var(--db-p-success-bg, rgba(34, 197, 94, 0.3));
    }

    .aiui-btn-run:hover {
      background: var(--db-p-success-bg, rgba(34, 197, 94, 0.25));
    }

    .aiui-btn-toggle {
      background: var(--db-p-warning-bg, rgba(234, 179, 8, 0.15));
      color: var(--db-p-warning, #eab308);
      border: 1px solid var(--db-p-warning-bg, rgba(234, 179, 8, 0.3));
    }

    .aiui-btn-toggle:hover {
      background: var(--db-p-warning-bg, rgba(234, 179, 8, 0.25));
    }

    .aiui-btn-delete {
      background: var(--db-p-error-bg, rgba(239, 68, 68, 0.1));
      color: var(--db-p-error, #ef4444);
      border: 1px solid var(--db-p-error-bg, rgba(239, 68, 68, 0.2));
      padding: 0.5rem;
    }

    .aiui-btn-delete:hover {
      background: var(--db-p-error-bg, rgba(239, 68, 68, 0.2));
    }

    .aiui-schedules-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--db-p-text-dim, #94a3b8);
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .aiui-schedules-empty h3 {
      font-size: 1.25rem;
      color: var(--db-p-text, #e2e8f0);
      margin: 0 0 0.5rem 0;
    }

    .aiui-schedules-empty p {
      margin: 0.5rem 0;
      max-width: 400px;
      margin-left: auto;
      margin-right: auto;
    }

    .aiui-empty-hint {
      font-size: 0.8125rem;
      color: var(--db-p-text-muted, #64748b);
    }

    @media (max-width: 768px) {
      .aiui-schedules-grid {
        grid-template-columns: 1fr;
      }
      .aiui-schedules-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForSchedulesPage(root) {
  // Look for cron/schedules page container
  const schedulesSection = root.querySelector('[data-page="cron"]') ||
                           root.querySelector('[data-page="schedules"]') ||
                           root.querySelector('.cron-page') ||
                           root.querySelector('.schedules-page') ||
                           root.querySelector('#cron') ||
                           root.querySelector('#schedules');
  
  if (schedulesSection && !schedulesSection.hasAttribute('data-aiui-schedules')) {
    schedulesSection.setAttribute('data-aiui-schedules', 'true');
    fetchSchedules().then(renderSchedulesUI);
    
    // Set up auto-refresh every 30 seconds
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      await fetchSchedules();
      renderSchedulesUI();
    }, 30000);
  }
}

// Expose functions globally for onclick handlers
window.aiuiRunJob = runJob;
window.aiuiStopJob = stopJob;
window.aiuiToggleJob = toggleJob;
window.aiuiDeleteSchedule = deleteJob;

export default {
  name: 'schedules',
  async init() {
    injectStyles();
    console.debug('[AIUI:schedules] Plugin loaded');
  },
  onContentChange(root) {
    checkForSchedulesPage(root);
  },
  // Called by the view's cleanup() when the page is left: stop the refresh
  // poll so it does not keep running against a detached page. Idempotent.
  stop() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = null;
  },
};
