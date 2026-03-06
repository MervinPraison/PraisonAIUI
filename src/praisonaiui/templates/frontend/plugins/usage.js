/**
 * AIUI Usage Analytics Dashboard Plugin
 *
 * Renders usage analytics with cost tracking, time-series charts,
 * and per-model/session breakdowns.
 */

let usageData = null;
let timeseriesData = null;
let modelsData = null;
let refreshInterval = null;

async function fetchUsageData() {
  try {
    const [summaryResp, timeseriesResp, modelsResp] = await Promise.all([
      fetch('/api/usage'),
      fetch('/api/usage/timeseries?hours=24'),
      fetch('/api/usage/models'),
    ]);
    
    usageData = await summaryResp.json();
    timeseriesData = await timeseriesResp.json();
    modelsData = await modelsResp.json();
    
    return { usageData, timeseriesData, modelsData };
  } catch (e) {
    console.warn('[AIUI:usage] Fetch error:', e);
    return null;
  }
}

function formatCost(cost) {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens) {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function renderSummaryCards() {
  if (!usageData) return '';
  
  const cards = [
    {
      icon: '💰',
      label: 'Total Cost',
      value: formatCost(usageData.total_cost_usd || 0),
      color: '#22c55e',
    },
    {
      icon: '📊',
      label: 'Total Tokens',
      value: formatTokens(usageData.total_tokens || 0),
      color: '#3b82f6',
    },
    {
      icon: '📨',
      label: 'Requests',
      value: usageData.total_requests || 0,
      color: '#8b5cf6',
    },
    {
      icon: '📈',
      label: 'Avg Cost/Request',
      value: formatCost(usageData.avg_cost_per_request || 0),
      color: '#f59e0b',
    },
  ];
  
  return cards.map(card => `
    <div class="aiui-usage-card">
      <div class="aiui-usage-card-icon" style="background: ${card.color}20; color: ${card.color}">
        ${card.icon}
      </div>
      <div class="aiui-usage-card-content">
        <div class="aiui-usage-card-value">${card.value}</div>
        <div class="aiui-usage-card-label">${card.label}</div>
      </div>
    </div>
  `).join('');
}

function renderTimeseriesChart() {
  if (!timeseriesData || !timeseriesData.timeseries) return '';
  
  const data = timeseriesData.timeseries;
  const maxTokens = Math.max(...data.map(d => d.tokens), 1);
  const maxCost = Math.max(...data.map(d => d.cost), 0.001);
  
  // SVG-based chart (no external dependencies)
  const width = 600;
  const height = 200;
  const padding = 40;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  
  // Generate path for tokens
  const tokenPoints = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * chartWidth;
    const y = height - padding - (d.tokens / maxTokens) * chartHeight;
    return `${x},${y}`;
  }).join(' ');
  
  // Generate path for cost
  const costPoints = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * chartWidth;
    const y = height - padding - (d.cost / maxCost) * chartHeight;
    return `${x},${y}`;
  }).join(' ');
  
  // X-axis labels (every 4 hours)
  const xLabels = data.filter((_, i) => i % 4 === 0).map((d, i) => {
    const x = padding + ((i * 4) / (data.length - 1)) * chartWidth;
    return `<text x="${x}" y="${height - 10}" class="aiui-chart-label">${d.hour}</text>`;
  }).join('');
  
  return `
    <div class="aiui-usage-chart-container">
      <h3>Usage Over Time (24h)</h3>
      <div class="aiui-chart-legend">
        <span class="aiui-legend-item"><span class="aiui-legend-dot" style="background: #3b82f6"></span> Tokens</span>
        <span class="aiui-legend-item"><span class="aiui-legend-dot" style="background: #22c55e"></span> Cost</span>
      </div>
      <svg class="aiui-usage-chart" viewBox="0 0 ${width} ${height}">
        <!-- Grid lines -->
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="rgba(148,163,184,0.2)" />
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(148,163,184,0.2)" />
        
        <!-- Token line -->
        <polyline points="${tokenPoints}" fill="none" stroke="#3b82f6" stroke-width="2" />
        
        <!-- Cost line -->
        <polyline points="${costPoints}" fill="none" stroke="#22c55e" stroke-width="2" stroke-dasharray="4,2" />
        
        <!-- X-axis labels -->
        ${xLabels}
        
        <!-- Y-axis labels -->
        <text x="10" y="${padding + 5}" class="aiui-chart-label">${formatTokens(maxTokens)}</text>
        <text x="10" y="${height - padding}" class="aiui-chart-label">0</text>
      </svg>
    </div>
  `;
}

function renderModelsTable() {
  if (!modelsData || !modelsData.models || modelsData.models.length === 0) {
    return '<p class="aiui-usage-empty">No model usage data yet</p>';
  }
  
  const rows = modelsData.models.slice(0, 10).map(m => `
    <tr>
      <td><code>${m.model}</code></td>
      <td>${m.requests}</td>
      <td>${formatTokens(m.input_tokens)}</td>
      <td>${formatTokens(m.output_tokens)}</td>
      <td class="aiui-cost-cell">${formatCost(m.cost_usd)}</td>
    </tr>
  `).join('');
  
  return `
    <div class="aiui-usage-table-container">
      <h3>Cost by Model</h3>
      <table class="aiui-usage-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Requests</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderModelsBarchart() {
  if (!modelsData || !modelsData.models || modelsData.models.length === 0) {
    return '';
  }
  
  const models = modelsData.models.slice(0, 5);
  const maxCost = Math.max(...models.map(m => m.cost_usd), 0.001);
  
  const bars = models.map(m => {
    const width = (m.cost_usd / maxCost) * 100;
    return `
      <div class="aiui-bar-row">
        <div class="aiui-bar-label">${m.model.split('/').pop()}</div>
        <div class="aiui-bar-container">
          <div class="aiui-bar" style="width: ${width}%"></div>
          <span class="aiui-bar-value">${formatCost(m.cost_usd)}</span>
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <div class="aiui-usage-barchart">
      <h3>Top Models by Cost</h3>
      ${bars}
    </div>
  `;
}

function renderUsageUI() {
  const container = document.querySelector('[data-aiui-usage]');
  if (!container) return;

  if (!usageData) {
    container.innerHTML = `
      <div class="aiui-usage-empty">
        <div class="aiui-empty-icon">📈</div>
        <h3>No Usage Data</h3>
        <p>Usage statistics will appear here as you use the AI agents.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="aiui-usage-header">
      <h2>Usage Analytics</h2>
      <div class="aiui-usage-period">Last 24 hours</div>
    </div>
    
    <div class="aiui-usage-cards">
      ${renderSummaryCards()}
    </div>
    
    ${renderTimeseriesChart()}
    
    <div class="aiui-usage-grid">
      ${renderModelsBarchart()}
      ${renderModelsTable()}
    </div>
  `;
}

function injectStyles() {
  if (document.querySelector('#aiui-usage-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-usage-styles';
  style.textContent = `
    [data-aiui-usage] {
      padding: 1.5rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .aiui-usage-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .aiui-usage-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-usage-period {
      font-size: 0.875rem;
      color: #64748b;
      background: rgba(148, 163, 184, 0.1);
      padding: 0.375rem 0.75rem;
      border-radius: 9999px;
    }

    .aiui-usage-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .aiui-usage-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.25rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .aiui-usage-card-icon {
      width: 48px;
      height: 48px;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }

    .aiui-usage-card-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #f1f5f9;
    }

    .aiui-usage-card-label {
      font-size: 0.75rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .aiui-usage-chart-container {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }

    .aiui-usage-chart-container h3 {
      font-size: 1rem;
      font-weight: 600;
      color: #e2e8f0;
      margin: 0 0 0.75rem 0;
    }

    .aiui-chart-legend {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 0.75rem;
    }

    .aiui-legend-item {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .aiui-legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .aiui-usage-chart {
      width: 100%;
      height: auto;
    }

    .aiui-chart-label {
      font-size: 10px;
      fill: #64748b;
    }

    .aiui-usage-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }

    .aiui-usage-barchart {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.25rem;
    }

    .aiui-usage-barchart h3 {
      font-size: 1rem;
      font-weight: 600;
      color: #e2e8f0;
      margin: 0 0 1rem 0;
    }

    .aiui-bar-row {
      margin-bottom: 0.75rem;
    }

    .aiui-bar-label {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-bottom: 0.25rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .aiui-bar-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .aiui-bar {
      height: 20px;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      border-radius: 4px;
      min-width: 4px;
    }

    .aiui-bar-value {
      font-size: 0.75rem;
      color: #e2e8f0;
      white-space: nowrap;
    }

    .aiui-usage-table-container {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1.25rem;
      overflow-x: auto;
    }

    .aiui-usage-table-container h3 {
      font-size: 1rem;
      font-weight: 600;
      color: #e2e8f0;
      margin: 0 0 1rem 0;
    }

    .aiui-usage-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }

    .aiui-usage-table th {
      text-align: left;
      padding: 0.5rem;
      color: #64748b;
      font-weight: 500;
      font-size: 0.6875rem;
      text-transform: uppercase;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }

    .aiui-usage-table td {
      padding: 0.5rem;
      color: #e2e8f0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    }

    .aiui-usage-table code {
      font-size: 0.75rem;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
    }

    .aiui-cost-cell {
      color: #22c55e;
      font-weight: 500;
    }

    .aiui-usage-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: #94a3b8;
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .aiui-usage-empty h3 {
      font-size: 1.25rem;
      color: #e2e8f0;
      margin: 0 0 0.5rem 0;
    }

    @media (max-width: 768px) {
      .aiui-usage-grid {
        grid-template-columns: 1fr;
      }
      .aiui-usage-cards {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForUsagePage(root) {
  const usageSection = root.querySelector('[data-page="usage"]') ||
                       root.querySelector('.usage-page') ||
                       root.querySelector('#usage');
  
  if (usageSection && !usageSection.hasAttribute('data-aiui-usage')) {
    usageSection.setAttribute('data-aiui-usage', 'true');
    fetchUsageData().then(renderUsageUI);
    
    // Auto-refresh every 30 seconds
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      await fetchUsageData();
      renderUsageUI();
    }, 30000);
  }
}

export default {
  name: 'usage',
  async init() {
    injectStyles();
    console.debug('[AIUI:usage] Plugin loaded');
  },
  onContentChange(root) {
    checkForUsagePage(root);
  },
};
