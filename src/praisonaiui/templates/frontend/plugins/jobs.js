/**
 * AIUI Jobs Dashboard Plugin
 *
 * Renders a dashboard view for async agent jobs.
 * Shows job status, progress, results with real-time SSE updates.
 */
import { showConfirm } from './toast.js';

let jobsData = null;
let refreshInterval = null;
let activeStreams = {};

const STATUS_CONFIG = {
  queued: { icon: '⏳', color: '#6b7280', label: 'Queued' },
  running: { icon: '🔄', color: '#3b82f6', label: 'Running', pulse: true },
  succeeded: { icon: '✅', color: '#22c55e', label: 'Completed' },
  failed: { icon: '❌', color: '#ef4444', label: 'Failed' },
  cancelled: { icon: '⚪', color: '#9ca3af', label: 'Cancelled' },
};

async function fetchJobs() {
  try {
    const resp = await fetch('/api/jobs');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    jobsData = data;
    return data;
  } catch (e) {
    console.warn('[AIUI:jobs] Fetch error:', e);
    return { jobs: [], total: 0 };
  }
}

async function cancelJob(jobId) {
  try {
    const resp = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) {
      showNotification(`Job "${jobId}" cancelled`, 'success');
      await fetchJobs();
      renderJobsUI();
    } else {
      showNotification(data.error || 'Cancel failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function deleteJob(jobId) {
  if (!await showConfirm('Delete Job', `Delete job "${jobId}"?`)) return;
  try {
    const resp = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    if (resp.ok) {
      showNotification(`Job "${jobId}" deleted`, 'success');
      await fetchJobs();
      renderJobsUI();
    } else {
      const data = await resp.json();
      showNotification(data.error || 'Delete failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.aiui-jobs-notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'aiui-jobs-notification';
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

function getStatusBadge(status) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  const pulseStyle = config.pulse ? 'animation: pulse 2s infinite;' : '';
  return `<span class="aiui-job-status-badge" style="
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    background: ${config.color}20;
    color: ${config.color};
    ${pulseStyle}
  ">
    <span>${config.icon}</span>
    <span>${config.label}</span>
  </span>`;
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimestamp(ts) {
  if (!ts) return '-';
  const date = new Date(ts * 1000);
  return date.toLocaleString();
}

function renderProgressBar(percentage) {
  return `
    <div class="aiui-job-progress-bar">
      <div class="aiui-job-progress-fill" style="width: ${percentage}%"></div>
    </div>
    <span class="aiui-job-progress-text">${percentage.toFixed(0)}%</span>
  `;
}

function renderJobRow(job) {
  const status = job.status || 'queued';
  const isTerminal = ['succeeded', 'failed', 'cancelled'].includes(status);
  const duration = job.started_at && job.completed_at 
    ? job.completed_at - job.started_at 
    : (job.started_at ? (Date.now() / 1000) - job.started_at : null);

  return `
    <tr class="aiui-job-row" data-job-id="${job.id}">
      <td class="aiui-job-id">
        <code>${job.id}</code>
      </td>
      <td class="aiui-job-prompt">
        <div class="aiui-job-prompt-text">${(job.prompt || '').substring(0, 50)}${job.prompt?.length > 50 ? '...' : ''}</div>
      </td>
      <td class="aiui-job-status">
        ${getStatusBadge(status)}
      </td>
      <td class="aiui-job-progress">
        ${status === 'running' ? renderProgressBar(job.progress_percentage || 0) : '-'}
      </td>
      <td class="aiui-job-created">
        ${formatTimestamp(job.created_at)}
      </td>
      <td class="aiui-job-duration">
        ${formatDuration(duration)}
      </td>
      <td class="aiui-job-actions">
        ${!isTerminal ? `
          <button class="aiui-btn aiui-btn-sm aiui-btn-cancel" onclick="window.aiuiCancelJob('${job.id}')" title="Cancel">
            ⏹️
          </button>
        ` : `
          <button class="aiui-btn aiui-btn-sm aiui-btn-delete" onclick="window.aiuiDeleteJob('${job.id}')" title="Delete">
            🗑️
          </button>
        `}
        <button class="aiui-btn aiui-btn-sm aiui-btn-view" onclick="window.aiuiViewJob('${job.id}')" title="View Details">
          👁️
        </button>
      </td>
    </tr>
  `;
}

async function viewJob(jobId) {
  try {
    const resp = await fetch(`/api/jobs/${jobId}`);
    const job = await resp.json();
    
    const modal = document.createElement('div');
    modal.className = 'aiui-job-modal';
    modal.innerHTML = `
      <div class="aiui-job-modal-backdrop" onclick="this.parentElement.remove()"></div>
      <div class="aiui-job-modal-content">
        <div class="aiui-job-modal-header">
          <h3>Job Details</h3>
          <button onclick="this.closest('.aiui-job-modal').remove()">✕</button>
        </div>
        <div class="aiui-job-modal-body">
          <div class="aiui-job-detail">
            <label>ID</label>
            <code>${job.id}</code>
          </div>
          <div class="aiui-job-detail">
            <label>Status</label>
            ${getStatusBadge(job.status)}
          </div>
          <div class="aiui-job-detail">
            <label>Prompt</label>
            <p>${job.prompt || '-'}</p>
          </div>
          ${job.result ? `
            <div class="aiui-job-detail">
              <label>Result</label>
              <pre>${typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 2)}</pre>
            </div>
          ` : ''}
          ${job.error ? `
            <div class="aiui-job-detail aiui-job-error">
              <label>Error</label>
              <pre>${job.error}</pre>
            </div>
          ` : ''}
          ${job.metrics ? `
            <div class="aiui-job-detail">
              <label>Metrics</label>
              <pre>${JSON.stringify(job.metrics, null, 2)}</pre>
            </div>
          ` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (e) {
    showNotification(`Error loading job: ${e.message}`, 'error');
  }
}

function renderJobsUI() {
  const container = document.querySelector('[data-aiui-jobs]');
  if (!container) return;

  if (!jobsData || jobsData.jobs.length === 0) {
    container.innerHTML = `
      <div class="aiui-jobs-empty">
        <div class="aiui-empty-icon">📋</div>
        <h3>No Jobs</h3>
        <p>Submit agent jobs via the API to see them here.</p>
        <p class="aiui-empty-hint">POST /api/jobs with a prompt to get started.</p>
      </div>
    `;
    return;
  }

  const statusCounts = {};
  jobsData.jobs.forEach(j => {
    statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
  });

  const rows = jobsData.jobs.map(renderJobRow).join('');
  
  container.innerHTML = `
    <div class="aiui-jobs-header">
      <h2>Agent Jobs</h2>
      <div class="aiui-jobs-summary">
        ${Object.entries(statusCounts).map(([status, count]) => `
          <span class="aiui-summary-stat">
            ${STATUS_CONFIG[status]?.icon || '?'} ${count} ${STATUS_CONFIG[status]?.label || status}
          </span>
        `).join('')}
      </div>
    </div>
    <div class="aiui-jobs-table-wrapper">
      <table class="aiui-jobs-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Prompt</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Created</th>
            <th>Duration</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-jobs-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-jobs-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    [data-aiui-jobs] {
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .aiui-jobs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-jobs-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-jobs-summary {
      display: flex;
      gap: 1rem;
    }

    .aiui-summary-stat {
      font-size: 0.875rem;
      color: #94a3b8;
    }

    .aiui-jobs-table-wrapper {
      overflow-x: auto;
    }

    .aiui-jobs-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    .aiui-jobs-table th {
      text-align: left;
      padding: 0.75rem 1rem;
      color: #64748b;
      font-weight: 500;
      text-transform: uppercase;
      font-size: 0.6875rem;
      letter-spacing: 0.05em;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-jobs-table td {
      padding: 0.75rem 1rem;
      color: #e2e8f0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    }

    .aiui-job-row:hover {
      background: rgba(148, 163, 184, 0.05);
    }

    .aiui-job-id code {
      font-size: 0.75rem;
      color: #94a3b8;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
    }

    .aiui-job-prompt-text {
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .aiui-job-progress {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .aiui-job-progress-bar {
      width: 80px;
      height: 6px;
      background: rgba(148, 163, 184, 0.2);
      border-radius: 3px;
      overflow: hidden;
    }

    .aiui-job-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .aiui-job-progress-text {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .aiui-job-actions {
      display: flex;
      gap: 0.375rem;
    }

    .aiui-btn-sm {
      padding: 0.375rem;
      font-size: 0.875rem;
      min-width: 32px;
    }

    .aiui-btn-cancel {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .aiui-btn-delete {
      background: rgba(107, 114, 128, 0.1);
      color: #9ca3af;
      border: 1px solid rgba(107, 114, 128, 0.2);
    }

    .aiui-btn-view {
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.2);
    }

    .aiui-jobs-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: #94a3b8;
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .aiui-jobs-empty h3 {
      font-size: 1.25rem;
      color: #e2e8f0;
      margin: 0 0 0.5rem 0;
    }

    .aiui-empty-hint {
      font-size: 0.8125rem;
      color: #64748b;
    }

    /* Modal styles */
    .aiui-job-modal {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .aiui-job-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
    }

    .aiui-job-modal-content {
      position: relative;
      background: #1e293b;
      border-radius: 0.75rem;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow: auto;
      border: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-job-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-job-modal-header h3 {
      margin: 0;
      color: #f1f5f9;
    }

    .aiui-job-modal-header button {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 1.25rem;
      cursor: pointer;
    }

    .aiui-job-modal-body {
      padding: 1.25rem;
    }

    .aiui-job-detail {
      margin-bottom: 1rem;
    }

    .aiui-job-detail label {
      display: block;
      font-size: 0.6875rem;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 0.375rem;
    }

    .aiui-job-detail pre {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.75rem;
      border-radius: 0.375rem;
      overflow-x: auto;
      font-size: 0.8125rem;
      color: #e2e8f0;
      margin: 0;
    }

    .aiui-job-error pre {
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.1);
    }

    @media (max-width: 768px) {
      .aiui-jobs-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForJobsPage(root) {
  const jobsSection = root.querySelector('[data-page="jobs"]') ||
                      root.querySelector('.jobs-page') ||
                      root.querySelector('#jobs');
  
  if (jobsSection && !jobsSection.hasAttribute('data-aiui-jobs')) {
    jobsSection.setAttribute('data-aiui-jobs', 'true');
    fetchJobs().then(renderJobsUI);
    
    // Auto-refresh every 5 seconds for running jobs
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      await fetchJobs();
      renderJobsUI();
    }, 5000);
  }
}

// Expose functions globally
window.aiuiCancelJob = cancelJob;
window.aiuiDeleteJob = deleteJob;
window.aiuiViewJob = viewJob;

export default {
  name: 'jobs',
  async init() {
    injectStyles();
    console.debug('[AIUI:jobs] Plugin loaded');
  },
  onContentChange(root) {
    checkForJobsPage(root);
  },
};
