/**
 * AIUI API Documentation Plugin
 *
 * Displays OpenAI-compatible API endpoints and documentation.
 */

let apiData = null;

async function fetchApiInfo() {
  try {
    const resp = await fetch('/v1');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    apiData = await resp.json();
    return apiData;
  } catch (e) {
    console.warn('[AIUI:api] Fetch error:', e);
    return { endpoints: [], capabilities_available: false };
  }
}

function renderEndpoint(endpoint) {
  const methodClass = endpoint.method.toLowerCase().replace('/', '-');
  return `
    <div class="aiui-endpoint">
      <div class="aiui-endpoint-header">
        <span class="aiui-method ${methodClass}">${endpoint.method}</span>
        <code class="aiui-path">${endpoint.path}</code>
      </div>
      <p class="aiui-endpoint-desc">${endpoint.description}</p>
    </div>
  `;
}

function renderApiUI() {
  const container = document.querySelector('[data-aiui-api]');
  if (!container) return;

  const endpoints = apiData?.endpoints || [];
  const available = apiData?.capabilities_available;
  
  container.innerHTML = `
    <div class="aiui-api-header">
      <h2>OpenAI-Compatible API</h2>
      <span class="aiui-api-status ${available ? 'available' : 'unavailable'}">
        ${available ? '✓ Available' : '✗ Capabilities not loaded'}
      </span>
    </div>
    
    <div class="aiui-api-info">
      <div class="aiui-info-card">
        <h4>Base URL</h4>
        <code>${window.location.origin}/v1</code>
      </div>
      <div class="aiui-info-card">
        <h4>SDK Usage</h4>
        <pre>from openai import OpenAI

client = OpenAI(
    base_url="${window.location.origin}/v1",
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)</pre>
      </div>
    </div>
    
    <h3>Available Endpoints</h3>
    <div class="aiui-endpoints-list">
      ${endpoints.map(renderEndpoint).join('')}
    </div>
    
    <div class="aiui-api-footer">
      <p>This API is compatible with the OpenAI Python SDK and other OpenAI-compatible clients.</p>
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-api-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-api-styles';
  style.textContent = `
    [data-aiui-api] {
      padding: 1.5rem;
      max-width: 900px;
      margin: 0 auto;
    }

    .aiui-api-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .aiui-api-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-api-status {
      font-size: 0.875rem;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
    }

    .aiui-api-status.available {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-api-status.unavailable {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    .aiui-api-info {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .aiui-info-card {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      padding: 1rem;
    }

    .aiui-info-card h4 {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: #64748b;
      margin: 0 0 0.5rem 0;
    }

    .aiui-info-card code {
      font-size: 0.875rem;
      color: #3b82f6;
      background: rgba(59, 130, 246, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
    }

    .aiui-info-card pre {
      font-size: 0.75rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 0.75rem;
      border-radius: 0.375rem;
      overflow-x: auto;
      color: #94a3b8;
      margin: 0;
      line-height: 1.5;
    }

    [data-aiui-api] h3 {
      font-size: 1rem;
      color: #e2e8f0;
      margin: 0 0 1rem 0;
    }

    .aiui-endpoints-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .aiui-endpoint {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
    }

    .aiui-endpoint-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.25rem;
    }

    .aiui-method {
      font-size: 0.6875rem;
      font-weight: 600;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      text-transform: uppercase;
    }

    .aiui-method.post {
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
    }

    .aiui-method.get {
      background: rgba(59, 130, 246, 0.2);
      color: #3b82f6;
    }

    .aiui-method.get-post {
      background: rgba(168, 85, 247, 0.2);
      color: #a855f7;
    }

    .aiui-path {
      font-size: 0.875rem;
      color: #e2e8f0;
      background: transparent;
    }

    .aiui-endpoint-desc {
      font-size: 0.8125rem;
      color: #64748b;
      margin: 0;
    }

    .aiui-api-footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-api-footer p {
      font-size: 0.8125rem;
      color: #64748b;
      margin: 0;
    }

    @media (max-width: 768px) {
      .aiui-api-info {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForApiPage(root) {
  const apiSection = root.querySelector('[data-page="api"]') ||
                     root.querySelector('.api-page') ||
                     root.querySelector('#api');
  
  if (apiSection && !apiSection.hasAttribute('data-aiui-api')) {
    apiSection.setAttribute('data-aiui-api', 'true');
    fetchApiInfo().then(renderApiUI);
  }
}

export default {
  name: 'api',
  async init() {
    injectStyles();
    console.debug('[AIUI:api] Plugin loaded');
  },
  onContentChange(root) {
    checkForApiPage(root);
  },
};
