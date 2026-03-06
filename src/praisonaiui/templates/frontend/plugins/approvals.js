/**
 * AIUI Approvals Dashboard Plugin
 *
 * Provides a real-time approval queue with approve/deny actions,
 * policy management, and history view.
 */

let approvalsData = null;
let policiesData = null;
let historyData = null;
let refreshInterval = null;
let eventSource = null;
let activeTab = 'pending';

const RISK_COLORS = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

async function fetchPending() {
  try {
    const resp = await fetch('/api/approvals/pending');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    approvalsData = await resp.json();
    return approvalsData;
  } catch (e) {
    console.warn('[AIUI:approvals] Fetch error:', e);
    return { approvals: [], count: 0 };
  }
}

async function fetchHistory() {
  try {
    const resp = await fetch('/api/approvals/history?limit=50');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    historyData = await resp.json();
    return historyData;
  } catch (e) {
    console.warn('[AIUI:approvals] History fetch error:', e);
    return { history: [], count: 0 };
  }
}

async function fetchPolicies() {
  try {
    const resp = await fetch('/api/approvals/policies');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    policiesData = await resp.json();
    return policiesData;
  } catch (e) {
    console.warn('[AIUI:approvals] Policies fetch error:', e);
    return { policies: {} };
  }
}

async function approveRequest(id, always = false) {
  try {
    const resp = await fetch(`/api/approvals/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ always }),
    });
    if (resp.ok) {
      showNotification('Request approved', 'success');
      await fetchPending();
      renderApprovalsUI();
    } else {
      const data = await resp.json();
      showNotification(data.error || 'Approve failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function denyRequest(id, always = false) {
  try {
    const resp = await fetch(`/api/approvals/${id}/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ always }),
    });
    if (resp.ok) {
      showNotification('Request denied', 'success');
      await fetchPending();
      renderApprovalsUI();
    } else {
      const data = await resp.json();
      showNotification(data.error || 'Deny failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function updatePolicies(updates) {
  try {
    const resp = await fetch('/api/approvals/policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (resp.ok) {
      showNotification('Policies updated', 'success');
      await fetchPolicies();
      renderApprovalsUI();
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.aiui-approvals-notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'aiui-approvals-notification';
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

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = (now - date) / 1000;
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
}

function renderPendingCard(approval) {
  const riskColor = RISK_COLORS[approval.risk_level] || RISK_COLORS.medium;
  const args = JSON.stringify(approval.arguments || {}, null, 2);
  
  return `
    <div class="aiui-approval-card" data-id="${approval.id}">
      <div class="aiui-approval-header">
        <div class="aiui-approval-risk" style="background: ${riskColor}20; color: ${riskColor}">
          ${approval.risk_icon || '⚠️'} ${approval.risk_level}
        </div>
        <span class="aiui-approval-time">${formatTime(approval.created_at)}</span>
      </div>
      <div class="aiui-approval-body">
        <h4 class="aiui-approval-tool">${approval.tool_name}</h4>
        <p class="aiui-approval-agent">Agent: ${approval.agent_name || 'Unknown'}</p>
        ${approval.description ? `<p class="aiui-approval-desc">${approval.description}</p>` : ''}
        <details class="aiui-approval-args">
          <summary>Arguments</summary>
          <pre>${args}</pre>
        </details>
      </div>
      <div class="aiui-approval-actions">
        <div class="aiui-approval-always">
          <label>
            <input type="checkbox" id="always-${approval.id}"> Always
          </label>
        </div>
        <button class="aiui-btn aiui-btn-deny" onclick="window.aiuiDenyApproval('${approval.id}')">
          ✕ Deny
        </button>
        <button class="aiui-btn aiui-btn-approve" onclick="window.aiuiApproveApproval('${approval.id}')">
          ✓ Approve
        </button>
      </div>
    </div>
  `;
}

function renderHistoryRow(item) {
  const statusClass = item.status === 'approved' ? 'approved' : 'denied';
  return `
    <tr class="aiui-history-row ${statusClass}">
      <td>${item.risk_icon || '⚠️'}</td>
      <td>${item.tool_name}</td>
      <td>${item.agent_name || '-'}</td>
      <td><span class="aiui-status-badge ${statusClass}">${item.status}</span></td>
      <td>${item.approver || '-'}</td>
      <td>${formatTime(item.resolved_at)}</td>
    </tr>
  `;
}

function renderPoliciesTab() {
  const policies = policiesData?.policies || {};
  
  return `
    <div class="aiui-policies-section">
      <h3>Approval Policies</h3>
      
      <div class="aiui-policy-group">
        <label>Risk Threshold</label>
        <p class="aiui-policy-help">Auto-approve requests below this risk level</p>
        <select id="risk-threshold" onchange="window.aiuiUpdateRiskThreshold(this.value)">
          <option value="low" ${policies.risk_threshold === 'low' ? 'selected' : ''}>Low only</option>
          <option value="medium" ${policies.risk_threshold === 'medium' ? 'selected' : ''}>Low + Medium</option>
          <option value="high" ${policies.risk_threshold === 'high' ? 'selected' : ''}>Low + Medium + High</option>
          <option value="critical" ${policies.risk_threshold === 'critical' ? 'selected' : ''}>All (auto-approve everything)</option>
        </select>
      </div>
      
      <div class="aiui-policy-group">
        <label>Auto-Approve Tools</label>
        <p class="aiui-policy-help">These tools are always approved</p>
        <div class="aiui-policy-list">
          ${(policies.auto_approve_tools || []).map(t => `
            <span class="aiui-policy-tag approve">
              ${t}
              <button onclick="window.aiuiRemoveAutoApprove('${t}')">×</button>
            </span>
          `).join('') || '<em>None</em>'}
        </div>
      </div>
      
      <div class="aiui-policy-group">
        <label>Always Deny Tools</label>
        <p class="aiui-policy-help">These tools are always denied</p>
        <div class="aiui-policy-list">
          ${(policies.always_deny_tools || []).map(t => `
            <span class="aiui-policy-tag deny">
              ${t}
              <button onclick="window.aiuiRemoveAlwaysDeny('${t}')">×</button>
            </span>
          `).join('') || '<em>None</em>'}
        </div>
      </div>
    </div>
  `;
}

function renderApprovalsUI() {
  const container = document.querySelector('[data-aiui-approvals]');
  if (!container) return;

  const pendingCount = approvalsData?.count || 0;
  const historyCount = historyData?.count || 0;
  
  let content = '';
  
  if (activeTab === 'pending') {
    if (pendingCount === 0) {
      content = `
        <div class="aiui-approvals-empty">
          <div class="aiui-empty-icon">✅</div>
          <h3>No Pending Approvals</h3>
          <p>All clear! No actions require your approval.</p>
        </div>
      `;
    } else {
      content = `
        <div class="aiui-approvals-grid">
          ${approvalsData.approvals.map(renderPendingCard).join('')}
        </div>
      `;
    }
  } else if (activeTab === 'history') {
    if (historyCount === 0) {
      content = `
        <div class="aiui-approvals-empty">
          <div class="aiui-empty-icon">📋</div>
          <h3>No History</h3>
          <p>No approval decisions have been made yet.</p>
        </div>
      `;
    } else {
      content = `
        <table class="aiui-history-table">
          <thead>
            <tr>
              <th></th>
              <th>Tool</th>
              <th>Agent</th>
              <th>Decision</th>
              <th>By</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            ${historyData.history.map(renderHistoryRow).join('')}
          </tbody>
        </table>
      `;
    }
  } else if (activeTab === 'policies') {
    content = renderPoliciesTab();
  }
  
  container.innerHTML = `
    <div class="aiui-approvals-header">
      <div class="aiui-approvals-title">
        <h2>Approvals</h2>
        ${pendingCount > 0 ? `<span class="aiui-pending-badge">${pendingCount}</span>` : ''}
      </div>
    </div>
    <div class="aiui-approvals-tabs">
      <button class="aiui-tab ${activeTab === 'pending' ? 'active' : ''}" 
              onclick="window.aiuiSwitchTab('pending')">
        Pending ${pendingCount > 0 ? `(${pendingCount})` : ''}
      </button>
      <button class="aiui-tab ${activeTab === 'history' ? 'active' : ''}"
              onclick="window.aiuiSwitchTab('history')">
        History
      </button>
      <button class="aiui-tab ${activeTab === 'policies' ? 'active' : ''}"
              onclick="window.aiuiSwitchTab('policies')">
        Policies
      </button>
    </div>
    <div class="aiui-approvals-content">
      ${content}
    </div>
  `;
}

function switchTab(tab) {
  activeTab = tab;
  if (tab === 'history' && !historyData) {
    fetchHistory().then(renderApprovalsUI);
  } else if (tab === 'policies' && !policiesData) {
    fetchPolicies().then(renderApprovalsUI);
  } else {
    renderApprovalsUI();
  }
}

function injectStyles() {
  if (document.querySelector('#aiui-approvals-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-approvals-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    [data-aiui-approvals] {
      padding: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .aiui-approvals-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .aiui-approvals-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .aiui-approvals-title h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-pending-badge {
      background: #ef4444;
      color: white;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 9999px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .aiui-approvals-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      padding-bottom: 0.5rem;
    }

    .aiui-tab {
      background: transparent;
      border: none;
      color: #94a3b8;
      padding: 0.5rem 1rem;
      cursor: pointer;
      font-size: 0.875rem;
      border-radius: 0.375rem;
      transition: all 0.2s;
    }

    .aiui-tab:hover {
      background: rgba(148, 163, 184, 0.1);
    }

    .aiui-tab.active {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }

    .aiui-approvals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1rem;
    }

    .aiui-approval-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1rem;
      transition: all 0.2s;
    }

    .aiui-approval-card:hover {
      border-color: rgba(59, 130, 246, 0.3);
    }

    .aiui-approval-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .aiui-approval-risk {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      text-transform: uppercase;
    }

    .aiui-approval-time {
      font-size: 0.75rem;
      color: #64748b;
    }

    .aiui-approval-tool {
      font-size: 1.125rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0 0 0.25rem 0;
    }

    .aiui-approval-agent {
      font-size: 0.8125rem;
      color: #94a3b8;
      margin: 0 0 0.5rem 0;
    }

    .aiui-approval-desc {
      font-size: 0.8125rem;
      color: #64748b;
      margin: 0 0 0.5rem 0;
    }

    .aiui-approval-args {
      margin-bottom: 1rem;
    }

    .aiui-approval-args summary {
      font-size: 0.75rem;
      color: #64748b;
      cursor: pointer;
    }

    .aiui-approval-args pre {
      font-size: 0.6875rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 0.5rem;
      border-radius: 0.25rem;
      overflow-x: auto;
      color: #94a3b8;
      margin: 0.5rem 0 0 0;
    }

    .aiui-approval-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-approval-always {
      flex: 1;
      font-size: 0.75rem;
      color: #64748b;
    }

    .aiui-approval-always label {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
    }

    .aiui-btn {
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .aiui-btn-approve {
      background: #22c55e;
      color: white;
    }

    .aiui-btn-approve:hover {
      background: #16a34a;
    }

    .aiui-btn-deny {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
    }

    .aiui-btn-deny:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    .aiui-approvals-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: #94a3b8;
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }

    .aiui-approvals-empty h3 {
      font-size: 1.25rem;
      color: #e2e8f0;
      margin: 0 0 0.5rem 0;
    }

    /* History table */
    .aiui-history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    .aiui-history-table th {
      text-align: left;
      padding: 0.75rem;
      color: #64748b;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
      font-weight: 500;
    }

    .aiui-history-table td {
      padding: 0.75rem;
      color: #e2e8f0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    }

    .aiui-status-badge {
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      text-transform: uppercase;
      font-weight: 600;
    }

    .aiui-status-badge.approved {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-status-badge.denied {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    /* Policies */
    .aiui-policies-section {
      max-width: 600px;
    }

    .aiui-policies-section h3 {
      color: #f1f5f9;
      margin: 0 0 1.5rem 0;
    }

    .aiui-policy-group {
      margin-bottom: 1.5rem;
    }

    .aiui-policy-group label {
      display: block;
      font-weight: 500;
      color: #e2e8f0;
      margin-bottom: 0.25rem;
    }

    .aiui-policy-help {
      font-size: 0.8125rem;
      color: #64748b;
      margin: 0 0 0.5rem 0;
    }

    .aiui-policy-group select {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.375rem;
      padding: 0.5rem;
      color: #e2e8f0;
      font-size: 0.875rem;
    }

    .aiui-policy-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .aiui-policy-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
    }

    .aiui-policy-tag.approve {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-policy-tag.deny {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    .aiui-policy-tag button {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0;
      font-size: 1rem;
      line-height: 1;
    }

    @media (max-width: 768px) {
      .aiui-approvals-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForApprovalsPage(root) {
  const approvalsSection = root.querySelector('[data-page="approvals"]') ||
                           root.querySelector('.approvals-page') ||
                           root.querySelector('#approvals');
  
  if (approvalsSection && !approvalsSection.hasAttribute('data-aiui-approvals')) {
    approvalsSection.setAttribute('data-aiui-approvals', 'true');
    Promise.all([fetchPending(), fetchPolicies()]).then(renderApprovalsUI);
    
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      await fetchPending();
      renderApprovalsUI();
    }, 5000);
  }
}

// Expose functions globally
window.aiuiApproveApproval = (id) => {
  const always = document.getElementById(`always-${id}`)?.checked || false;
  approveRequest(id, always);
};
window.aiuiDenyApproval = (id) => {
  const always = document.getElementById(`always-${id}`)?.checked || false;
  denyRequest(id, always);
};
window.aiuiSwitchTab = switchTab;
window.aiuiUpdateRiskThreshold = (value) => updatePolicies({ risk_threshold: value });
window.aiuiRemoveAutoApprove = (tool) => {
  const tools = (policiesData?.policies?.auto_approve_tools || []).filter(t => t !== tool);
  updatePolicies({ auto_approve_tools: tools });
};
window.aiuiRemoveAlwaysDeny = (tool) => {
  const tools = (policiesData?.policies?.always_deny_tools || []).filter(t => t !== tool);
  updatePolicies({ always_deny_tools: tools });
};

export default {
  name: 'approvals',
  async init() {
    injectStyles();
    console.debug('[AIUI:approvals] Plugin loaded');
  },
  onContentChange(root) {
    checkForApprovalsPage(root);
  },
};
