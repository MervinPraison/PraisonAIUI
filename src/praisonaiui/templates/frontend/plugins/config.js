/**
 * AIUI Config Form Editor Plugin
 *
 * Schema-driven form editor with YAML view toggle.
 */
import { showToast, showConfirm } from './toast.js';

let schema = null;
let config = {};
let viewMode = 'form'; // 'form' or 'yaml'
let errors = [];

async function fetchSchema() {
  try {
    const resp = await fetch('/api/config/schema');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    schema = data.schema;
    return schema;
  } catch (e) {
    console.warn('[AIUI:config] Schema fetch error:', e);
    return null;
  }
}

async function fetchConfig() {
  try {
    const resp = await fetch('/api/config/runtime');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    config = data.config || {};
    return config;
  } catch (e) {
    console.warn('[AIUI:config] Config fetch error:', e);
    return {};
  }
}

async function fetchDefaults() {
  try {
    const resp = await fetch('/api/config/defaults');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.defaults || {};
  } catch (e) {
    return {};
  }
}

async function validateConfig(cfg) {
  try {
    const resp = await fetch('/api/config/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });
    const data = await resp.json();
    return data;
  } catch (e) {
    return { valid: false, errors: [e.message] };
  }
}

async function applyConfig(cfg) {
  try {
    const resp = await fetch('/api/config/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg }),
    });
    const data = await resp.json();
    return data;
  } catch (e) {
    return { applied: false, errors: [e.message] };
  }
}

function renderFormField(key, propSchema, value, path = '') {
  const fullPath = path ? `${path}.${key}` : key;
  const type = propSchema.type;
  const title = propSchema.title || key;
  const isPassword = propSchema.format === 'password';
  
  if (type === 'object') {
    const subFields = Object.entries(propSchema.properties || {})
      .map(([k, v]) => renderFormField(k, v, (value || {})[k], fullPath))
      .join('');
    return `
      <div class="aiui-config-section" data-path="${fullPath}">
        <div class="aiui-config-section-header" onclick="window.aiuiToggleSection('${fullPath}')">
          <span class="aiui-section-toggle">▼</span>
          <h4>${title}</h4>
        </div>
        <div class="aiui-config-section-body">
          ${subFields}
        </div>
      </div>
    `;
  }
  
  let input = '';
  const currentValue = value !== undefined ? value : (propSchema.default || '');
  
  if (propSchema.enum) {
    const options = propSchema.enum.map(opt => 
      `<option value="${opt}" ${currentValue === opt ? 'selected' : ''}>${opt}</option>`
    ).join('');
    input = `<select data-path="${fullPath}" onchange="window.aiuiUpdateConfig('${fullPath}', this.value)">${options}</select>`;
  } else if (type === 'boolean') {
    input = `<label class="aiui-toggle">
      <input type="checkbox" data-path="${fullPath}" ${currentValue ? 'checked' : ''} 
             onchange="window.aiuiUpdateConfig('${fullPath}', this.checked)">
      <span class="aiui-toggle-slider"></span>
    </label>`;
  } else if (type === 'number' || type === 'integer') {
    const min = propSchema.minimum !== undefined ? `min="${propSchema.minimum}"` : '';
    const max = propSchema.maximum !== undefined ? `max="${propSchema.maximum}"` : '';
    const step = type === 'integer' ? 'step="1"' : 'step="0.1"';
    input = `<input type="number" data-path="${fullPath}" value="${currentValue}" ${min} ${max} ${step}
             onchange="window.aiuiUpdateConfig('${fullPath}', parseFloat(this.value))">`;
  } else {
    const inputType = isPassword ? 'password' : 'text';
    input = `<input type="${inputType}" data-path="${fullPath}" value="${currentValue}"
             onchange="window.aiuiUpdateConfig('${fullPath}', this.value)">`;
  }
  
  return `
    <div class="aiui-config-field">
      <label>${title}</label>
      ${input}
    </div>
  `;
}

function renderForm() {
  if (!schema) return '<div class="aiui-config-loading">Loading schema...</div>';
  
  const sections = Object.entries(schema.properties || {})
    .map(([key, propSchema]) => renderFormField(key, propSchema, config[key]))
    .join('');
  
  return `
    <div class="aiui-config-form">
      ${sections}
    </div>
  `;
}

function renderYaml() {
  try {
    const yaml = JSON.stringify(config, null, 2);
    return `
      <div class="aiui-config-yaml">
        <textarea id="aiui-yaml-editor" spellcheck="false">${yaml}</textarea>
      </div>
    `;
  } catch (e) {
    return `<div class="aiui-config-error">Error rendering YAML: ${e.message}</div>`;
  }
}

function renderErrors() {
  if (errors.length === 0) return '';
  return `
    <div class="aiui-config-errors">
      ${errors.map(e => `<div class="aiui-error-item">⚠️ ${e}</div>`).join('')}
    </div>
  `;
}

function renderConfigUI() {
  const container = document.querySelector('[data-aiui-config]');
  if (!container) return;
  
  container.innerHTML = `
    <div class="aiui-config-header">
      <h2>Configuration</h2>
      <div class="aiui-config-view-toggle">
        <button class="${viewMode === 'form' ? 'active' : ''}" onclick="window.aiuiSetView('form')">📝 Form</button>
        <button class="${viewMode === 'yaml' ? 'active' : ''}" onclick="window.aiuiSetView('yaml')">📄 YAML</button>
      </div>
    </div>
    
    ${renderErrors()}
    
    <div class="aiui-config-content">
      ${viewMode === 'form' ? renderForm() : renderYaml()}
    </div>
    
    <div class="aiui-config-actions">
      <button class="aiui-btn-primary" onclick="window.aiuiSaveConfig()">💾 Save</button>
      <button class="aiui-btn-secondary" onclick="window.aiuiResetDefaults()">↺ Reset to Defaults</button>
      <button class="aiui-btn-secondary" onclick="window.aiuiValidateConfig()">✓ Validate</button>
    </div>
  `;
}

window.aiuiSetView = function(mode) {
  viewMode = mode;
  renderConfigUI();
};

window.aiuiToggleSection = function(path) {
  const section = document.querySelector(`[data-path="${path}"]`);
  if (section) {
    section.classList.toggle('collapsed');
    const toggle = section.querySelector('.aiui-section-toggle');
    if (toggle) toggle.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
  }
};

window.aiuiUpdateConfig = function(path, value) {
  const parts = path.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  errors = [];
};

window.aiuiSaveConfig = async function() {
  // Get YAML content if in YAML mode
  if (viewMode === 'yaml') {
    const textarea = document.getElementById('aiui-yaml-editor');
    if (textarea) {
      try {
        config = JSON.parse(textarea.value);
      } catch (e) {
        errors = ['Invalid JSON: ' + e.message];
        renderConfigUI();
        return;
      }
    }
  }
  
  const result = await applyConfig(config);
  if (result.applied) {
    errors = [];
    showToast('Configuration saved successfully!', 'success');
  } else {
    errors = result.errors || ['Failed to save configuration'];
  }
  renderConfigUI();
};

window.aiuiResetDefaults = async function() {
  if (!await showConfirm('Reset Defaults', 'Reset all settings to defaults?')) return;
  config = await fetchDefaults();
  errors = [];
  renderConfigUI();
};

window.aiuiValidateConfig = async function() {
  if (viewMode === 'yaml') {
    const textarea = document.getElementById('aiui-yaml-editor');
    if (textarea) {
      try {
        config = JSON.parse(textarea.value);
      } catch (e) {
        errors = ['Invalid JSON: ' + e.message];
        renderConfigUI();
        return;
      }
    }
  }
  
  const result = await validateConfig(config);
  if (result.valid) {
    errors = [];
    showToast('Configuration is valid!', 'success');
  } else {
    errors = result.errors || ['Validation failed'];
  }
  renderConfigUI();
};

function injectStyles() {
  if (document.querySelector('#aiui-config-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-config-styles';
  style.textContent = `
    [data-aiui-config] {
      padding: 1.5rem;
      max-width: 800px;
      margin: 0 auto;
    }

    .aiui-config-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .aiui-config-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-config-view-toggle {
      display: flex;
      gap: 0.25rem;
    }

    .aiui-config-view-toggle button {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 0.375rem;
      background: rgba(148, 163, 184, 0.1);
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.875rem;
    }

    .aiui-config-view-toggle button.active {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }

    .aiui-config-errors {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 0.5rem;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }

    .aiui-error-item {
      color: #ef4444;
      font-size: 0.875rem;
      padding: 0.25rem 0;
    }

    .aiui-config-section {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      margin-bottom: 0.75rem;
      overflow: hidden;
    }

    .aiui-config-section-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: rgba(30, 41, 59, 0.8);
      cursor: pointer;
    }

    .aiui-config-section-header h4 {
      margin: 0;
      font-size: 0.9375rem;
      color: #e2e8f0;
    }

    .aiui-section-toggle {
      color: #64748b;
      font-size: 0.75rem;
    }

    .aiui-config-section.collapsed .aiui-config-section-body {
      display: none;
    }

    .aiui-config-section-body {
      padding: 1rem;
    }

    .aiui-config-field {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      margin-bottom: 1rem;
    }

    .aiui-config-field:last-child {
      margin-bottom: 0;
    }

    .aiui-config-field label {
      font-size: 0.8125rem;
      color: #94a3b8;
    }

    .aiui-config-field input,
    .aiui-config-field select {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
      color: #e2e8f0;
      font-size: 0.875rem;
    }

    .aiui-config-field input:focus,
    .aiui-config-field select:focus {
      outline: none;
      border-color: #3b82f6;
    }

    .aiui-toggle {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }

    .aiui-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .aiui-toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(148, 163, 184, 0.3);
      border-radius: 24px;
      transition: 0.3s;
    }

    .aiui-toggle-slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background: white;
      border-radius: 50%;
      transition: 0.3s;
    }

    .aiui-toggle input:checked + .aiui-toggle-slider {
      background: #3b82f6;
    }

    .aiui-toggle input:checked + .aiui-toggle-slider:before {
      transform: translateX(20px);
    }

    .aiui-config-yaml textarea {
      width: 100%;
      min-height: 400px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.5rem;
      padding: 1rem;
      color: #e2e8f0;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
      resize: vertical;
    }

    .aiui-config-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-btn-primary {
      padding: 0.625rem 1.25rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      cursor: pointer;
    }

    .aiui-btn-primary:hover {
      background: #2563eb;
    }

    .aiui-btn-secondary {
      padding: 0.625rem 1.25rem;
      background: rgba(148, 163, 184, 0.1);
      color: #94a3b8;
      border: none;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      cursor: pointer;
    }

    .aiui-btn-secondary:hover {
      background: rgba(148, 163, 184, 0.2);
    }
  `;
  document.head.appendChild(style);
}

function checkForConfigPage(root) {
  const configSection = root.querySelector('[data-page="config"]') ||
                        root.querySelector('.config-page') ||
                        root.querySelector('#config');
  
  if (configSection && !configSection.hasAttribute('data-aiui-config')) {
    configSection.setAttribute('data-aiui-config', 'true');
    Promise.all([fetchSchema(), fetchConfig()]).then(renderConfigUI);
  }
}

export default {
  name: 'config',
  async init() {
    injectStyles();
    console.debug('[AIUI:config] Plugin loaded');
  },
  onContentChange(root) {
    checkForConfigPage(root);
  },
};
