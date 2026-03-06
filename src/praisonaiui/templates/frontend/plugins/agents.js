/**
 * AIUI Agents Dashboard Plugin
 *
 * Provides full CRUD for agent management with an editor interface.
 */

let agentsData = null;
let modelsData = null;
let editingAgent = null;
let refreshInterval = null;

async function fetchAgents() {
  try {
    const resp = await fetch('/api/agents/definitions');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    agentsData = await resp.json();
    return agentsData;
  } catch (e) {
    console.warn('[AIUI:agents] Fetch error:', e);
    return { agents: [], count: 0 };
  }
}

async function fetchModels() {
  try {
    const resp = await fetch('/api/agents/models');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    modelsData = await resp.json();
    return modelsData;
  } catch (e) {
    console.warn('[AIUI:agents] Models fetch error:', e);
    return { models: [], default: 'gpt-4o-mini' };
  }
}

async function createAgent(data) {
  try {
    const resp = await fetch('/api/agents/definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await resp.json();
    if (resp.ok) {
      showNotification(`Agent "${data.name}" created`, 'success');
      await fetchAgents();
      renderAgentsUI();
      closeEditor();
    } else {
      showNotification(result.error || 'Create failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function updateAgent(agentId, data) {
  try {
    const resp = await fetch(`/api/agents/definitions/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await resp.json();
    if (resp.ok) {
      showNotification(`Agent "${data.name}" updated`, 'success');
      await fetchAgents();
      renderAgentsUI();
      closeEditor();
    } else {
      showNotification(result.error || 'Update failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function deleteAgent(agentId, agentName) {
  if (!confirm(`Delete agent "${agentName}"? This cannot be undone.`)) return;
  
  try {
    const resp = await fetch(`/api/agents/definitions/${agentId}`, {
      method: 'DELETE',
    });
    if (resp.ok) {
      showNotification(`Agent "${agentName}" deleted`, 'success');
      await fetchAgents();
      renderAgentsUI();
    } else {
      const result = await resp.json();
      showNotification(result.error || 'Delete failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

async function duplicateAgent(agentId) {
  try {
    const resp = await fetch(`/api/agents/duplicate/${agentId}`, {
      method: 'POST',
    });
    if (resp.ok) {
      showNotification('Agent duplicated', 'success');
      await fetchAgents();
      renderAgentsUI();
    } else {
      const result = await resp.json();
      showNotification(result.error || 'Duplicate failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.aiui-agents-notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'aiui-agents-notification';
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

function openEditor(agent = null) {
  editingAgent = agent;
  renderAgentsUI();
}

function closeEditor() {
  editingAgent = null;
  renderAgentsUI();
}

function saveAgent() {
  const form = document.querySelector('.aiui-agent-form');
  if (!form) return;

  const data = {
    name: form.querySelector('[name="name"]').value.trim(),
    description: form.querySelector('[name="description"]').value.trim(),
    instructions: form.querySelector('[name="instructions"]').value.trim(),
    system_prompt: form.querySelector('[name="system_prompt"]').value.trim(),
    model: form.querySelector('[name="model"]').value,
    temperature: parseFloat(form.querySelector('[name="temperature"]').value),
    icon: form.querySelector('[name="icon"]').value || '🤖',
  };

  if (!data.name) {
    showNotification('Agent name is required', 'error');
    return;
  }

  if (editingAgent && editingAgent.id) {
    updateAgent(editingAgent.id, data);
  } else {
    createAgent(data);
  }
}

function renderAgentCard(agent) {
  const statusClass = agent.status === 'active' ? 'active' : 'inactive';
  
  return `
    <div class="aiui-agent-card ${statusClass}" data-agent-id="${agent.id}">
      <div class="aiui-agent-header">
        <div class="aiui-agent-icon">${agent.icon || '🤖'}</div>
        <div class="aiui-agent-info">
          <h4 class="aiui-agent-name">${agent.name}</h4>
          <span class="aiui-agent-model">${agent.model || 'gpt-4o-mini'}</span>
        </div>
        <div class="aiui-agent-actions">
          <button class="aiui-btn aiui-btn-sm" onclick="window.aiuiEditAgent('${agent.id}')" title="Edit">
            ✏️
          </button>
          <button class="aiui-btn aiui-btn-sm" onclick="window.aiuiDuplicateAgent('${agent.id}')" title="Duplicate">
            📋
          </button>
          <button class="aiui-btn aiui-btn-sm aiui-btn-danger" onclick="window.aiuiDeleteAgent('${agent.id}', '${agent.name}')" title="Delete">
            🗑️
          </button>
        </div>
      </div>
      <p class="aiui-agent-description">${agent.description || 'No description'}</p>
      <div class="aiui-agent-footer">
        <span class="aiui-agent-status ${statusClass}">${agent.status || 'active'}</span>
        <span class="aiui-agent-temp">Temp: ${agent.temperature || 0.7}</span>
      </div>
    </div>
  `;
}

function renderEditor() {
  const agent = editingAgent || {};
  const models = modelsData?.models || ['gpt-4o-mini'];
  const isNew = !agent.id;
  
  const modelOptions = models.map(m => 
    `<option value="${m}" ${agent.model === m ? 'selected' : ''}>${m}</option>`
  ).join('');

  return `
    <div class="aiui-agent-editor">
      <div class="aiui-editor-header">
        <h3>${isNew ? 'Create New Agent' : 'Edit Agent'}</h3>
        <button class="aiui-btn" onclick="window.aiuiCloseEditor()">✕</button>
      </div>
      <form class="aiui-agent-form" onsubmit="event.preventDefault(); window.aiuiSaveAgent();">
        <div class="aiui-form-row">
          <div class="aiui-form-group">
            <label>Icon</label>
            <input type="text" name="icon" value="${agent.icon || '🤖'}" maxlength="2" class="aiui-icon-input">
          </div>
          <div class="aiui-form-group aiui-form-grow">
            <label>Name *</label>
            <input type="text" name="name" value="${agent.name || ''}" required placeholder="My Agent">
          </div>
        </div>
        
        <div class="aiui-form-group">
          <label>Description</label>
          <input type="text" name="description" value="${agent.description || ''}" placeholder="What does this agent do?">
        </div>
        
        <div class="aiui-form-row">
          <div class="aiui-form-group aiui-form-grow">
            <label>Model</label>
            <select name="model">${modelOptions}</select>
          </div>
          <div class="aiui-form-group">
            <label>Temperature: <span id="temp-value">${agent.temperature || 0.7}</span></label>
            <input type="range" name="temperature" min="0" max="2" step="0.1" 
                   value="${agent.temperature || 0.7}" 
                   oninput="document.getElementById('temp-value').textContent = this.value">
          </div>
        </div>
        
        <div class="aiui-form-group">
          <label>System Prompt</label>
          <textarea name="system_prompt" rows="4" placeholder="You are a helpful assistant...">${agent.system_prompt || ''}</textarea>
        </div>
        
        <div class="aiui-form-group">
          <label>Instructions</label>
          <textarea name="instructions" rows="6" placeholder="Detailed instructions for the agent...">${agent.instructions || ''}</textarea>
        </div>
        
        <div class="aiui-form-actions">
          <button type="button" class="aiui-btn aiui-btn-secondary" onclick="window.aiuiCloseEditor()">Cancel</button>
          <button type="submit" class="aiui-btn aiui-btn-primary">${isNew ? 'Create Agent' : 'Save Changes'}</button>
        </div>
      </form>
    </div>
  `;
}

function renderAgentsUI() {
  const container = document.querySelector('[data-aiui-agents]');
  if (!container) return;

  // If editing, show editor
  if (editingAgent !== null) {
    container.innerHTML = renderEditor();
    return;
  }

  if (!agentsData || agentsData.agents.length === 0) {
    container.innerHTML = `
      <div class="aiui-agents-header">
        <h2>Agents</h2>
        <button class="aiui-btn aiui-btn-primary" onclick="window.aiuiCreateAgent()">
          + New Agent
        </button>
      </div>
      <div class="aiui-agents-empty">
        <div class="aiui-empty-icon">🤖</div>
        <h3>No Agents</h3>
        <p>Create your first agent to get started.</p>
        <button class="aiui-btn aiui-btn-primary" onclick="window.aiuiCreateAgent()">
          Create Agent
        </button>
      </div>
    `;
    return;
  }

  const cards = agentsData.agents.map(renderAgentCard).join('');
  
  container.innerHTML = `
    <div class="aiui-agents-header">
      <div class="aiui-agents-title">
        <h2>Agents</h2>
        <span class="aiui-agents-count">${agentsData.count} agents</span>
      </div>
      <button class="aiui-btn aiui-btn-primary" onclick="window.aiuiCreateAgent()">
        + New Agent
      </button>
    </div>
    <div class="aiui-agents-grid">
      ${cards}
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-agents-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-agents-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    [data-aiui-agents] {
      padding: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .aiui-agents-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .aiui-agents-title {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .aiui-agents-title h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-agents-count {
      font-size: 0.875rem;
      color: #64748b;
      background: rgba(148, 163, 184, 0.1);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
    }

    .aiui-agents-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    .aiui-agent-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.25rem;
      transition: all 0.2s;
    }

    .aiui-agent-card:hover {
      border-color: rgba(59, 130, 246, 0.3);
      transform: translateY(-2px);
    }

    .aiui-agent-card.inactive {
      opacity: 0.6;
    }

    .aiui-agent-header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .aiui-agent-icon {
      font-size: 2.5rem;
      line-height: 1;
    }

    .aiui-agent-info {
      flex: 1;
    }

    .aiui-agent-name {
      font-size: 1.125rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0 0 0.25rem 0;
    }

    .aiui-agent-model {
      font-size: 0.75rem;
      color: #64748b;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
    }

    .aiui-agent-actions {
      display: flex;
      gap: 0.25rem;
    }

    .aiui-agent-description {
      font-size: 0.875rem;
      color: #94a3b8;
      margin: 0 0 0.75rem 0;
      line-height: 1.5;
    }

    .aiui-agent-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
    }

    .aiui-agent-status {
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      text-transform: uppercase;
    }

    .aiui-agent-status.active {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-agent-status.inactive {
      background: rgba(148, 163, 184, 0.2);
      color: #94a3b8;
    }

    .aiui-agent-temp {
      color: #64748b;
    }

    /* Editor styles */
    .aiui-agent-editor {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.5rem;
      max-width: 700px;
      margin: 0 auto;
    }

    .aiui-editor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-editor-header h3 {
      font-size: 1.25rem;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-form-row {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .aiui-form-group {
      margin-bottom: 1rem;
    }

    .aiui-form-grow {
      flex: 1;
    }

    .aiui-form-group label {
      display: block;
      font-size: 0.8125rem;
      color: #94a3b8;
      margin-bottom: 0.375rem;
    }

    .aiui-form-group input,
    .aiui-form-group select,
    .aiui-form-group textarea {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.5rem;
      padding: 0.625rem 0.875rem;
      color: #e2e8f0;
      font-size: 0.875rem;
    }

    .aiui-form-group textarea {
      resize: vertical;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8125rem;
    }

    .aiui-icon-input {
      width: 60px !important;
      text-align: center;
      font-size: 1.5rem !important;
    }

    .aiui-form-group input:focus,
    .aiui-form-group select:focus,
    .aiui-form-group textarea:focus {
      outline: none;
      border-color: #3b82f6;
    }

    .aiui-form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-btn {
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .aiui-btn-sm {
      padding: 0.375rem 0.5rem;
      font-size: 0.8125rem;
    }

    .aiui-btn-primary {
      background: #3b82f6;
      color: white;
    }

    .aiui-btn-primary:hover {
      background: #2563eb;
    }

    .aiui-btn-secondary {
      background: rgba(148, 163, 184, 0.2);
      color: #e2e8f0;
    }

    .aiui-btn-danger {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
    }

    .aiui-agents-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: #94a3b8;
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .aiui-agents-empty h3 {
      font-size: 1.25rem;
      color: #e2e8f0;
      margin: 0 0 0.5rem 0;
    }

    @media (max-width: 768px) {
      .aiui-agents-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
      .aiui-form-row {
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForAgentsPage(root) {
  const agentsSection = root.querySelector('[data-page="agents"]') ||
                        root.querySelector('.agents-page') ||
                        root.querySelector('#agents');
  
  if (agentsSection && !agentsSection.hasAttribute('data-aiui-agents')) {
    agentsSection.setAttribute('data-aiui-agents', 'true');
    Promise.all([fetchAgents(), fetchModels()]).then(renderAgentsUI);
    
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      if (editingAgent === null) {
        await fetchAgents();
        renderAgentsUI();
      }
    }, 30000);
  }
}

// Expose functions globally
window.aiuiCreateAgent = () => openEditor({});
window.aiuiEditAgent = async (id) => {
  const resp = await fetch(`/api/agents/definitions/${id}`);
  if (resp.ok) {
    const agent = await resp.json();
    openEditor(agent);
  }
};
window.aiuiDeleteAgent = deleteAgent;
window.aiuiDuplicateAgent = duplicateAgent;
window.aiuiCloseEditor = closeEditor;
window.aiuiSaveAgent = saveAgent;

export default {
  name: 'agents',
  async init() {
    injectStyles();
    console.debug('[AIUI:agents] Plugin loaded');
  },
  onContentChange(root) {
    checkForAgentsPage(root);
  },
};
