/**
 * AIUI Skills/Tools Dashboard Plugin
 *
 * Renders a tool catalog with enable/disable toggles,
 * category filtering, and configuration options.
 */

let skillsData = null;
let categoriesData = null;
let refreshInterval = null;
let activeCategory = null;
let searchQuery = '';

const CATEGORY_ICONS = {
  search: '🔍',
  crawl: '🕷️',
  file: '📁',
  code: '💻',
  shell: '🖥️',
  skills: '⚡',
  schedule: '⏰',
  custom: '✨',
  other: '🔧',
};

async function fetchSkills() {
  try {
    let url = '/api/skills';
    const params = [];
    if (activeCategory) params.push(`category=${activeCategory}`);
    if (searchQuery) params.push(`search=${encodeURIComponent(searchQuery)}`);
    if (params.length) url += '?' + params.join('&');
    
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    skillsData = await resp.json();
    return skillsData;
  } catch (e) {
    console.warn('[AIUI:skills] Fetch error:', e);
    return { skills: [], count: 0 };
  }
}

async function fetchCategories() {
  try {
    const resp = await fetch('/api/skills/categories');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    categoriesData = await resp.json();
    return categoriesData;
  } catch (e) {
    console.warn('[AIUI:skills] Categories fetch error:', e);
    return { categories: [] };
  }
}

async function toggleSkill(skillId) {
  try {
    const resp = await fetch(`/api/skills/${skillId}/toggle`, { method: 'POST' });
    const data = await resp.json();
    if (resp.ok) {
      showNotification(`Tool "${skillId}" ${data.enabled ? 'enabled' : 'disabled'}`, 'success');
      await fetchSkills();
      renderSkillsUI();
    } else {
      showNotification(data.error || 'Toggle failed', 'error');
    }
  } catch (e) {
    showNotification(`Error: ${e.message}`, 'error');
  }
}

function showNotification(message, type = 'info') {
  const existing = document.querySelector('.aiui-skills-notification');
  if (existing) existing.remove();

  const notif = document.createElement('div');
  notif.className = 'aiui-skills-notification';
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

function renderCategoryTabs() {
  if (!categoriesData || !categoriesData.categories) return '';
  
  const tabs = [
    { name: null, label: 'All', count: skillsData?.count || 0 },
    ...categoriesData.categories.map(c => ({
      name: c.name,
      label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
      count: c.count,
      icon: CATEGORY_ICONS[c.name] || '🔧',
    })),
  ];
  
  return `
    <div class="aiui-skills-tabs">
      ${tabs.map(tab => `
        <button class="aiui-skills-tab ${activeCategory === tab.name ? 'active' : ''}"
                onclick="window.aiuiFilterCategory('${tab.name}')">
          ${tab.icon || ''} ${tab.label}
          <span class="aiui-tab-count">${tab.count}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderToolCard(tool) {
  const statusClass = tool.enabled ? 'enabled' : 'disabled';
  const keysStatus = tool.required_keys?.length > 0 
    ? (tool.keys_configured ? '🔑 Configured' : '⚠️ API Key Required')
    : '';
  
  return `
    <div class="aiui-tool-card ${statusClass}" data-tool-id="${tool.id}">
      <div class="aiui-tool-header">
        <div class="aiui-tool-icon">${tool.icon || '🔧'}</div>
        <div class="aiui-tool-info">
          <h4 class="aiui-tool-name">${tool.name}</h4>
          <span class="aiui-tool-category">${tool.category}</span>
        </div>
        <label class="aiui-toggle">
          <input type="checkbox" ${tool.enabled ? 'checked' : ''} 
                 onchange="window.aiuiToggleSkill('${tool.id}')">
          <span class="aiui-toggle-slider"></span>
        </label>
      </div>
      <p class="aiui-tool-description">${tool.description}</p>
      <div class="aiui-tool-footer">
        <span class="aiui-tool-type ${tool.type}">${tool.type}</span>
        ${keysStatus ? `<span class="aiui-tool-keys">${keysStatus}</span>` : ''}
      </div>
    </div>
  `;
}

function renderSkillsUI() {
  const container = document.querySelector('[data-aiui-skills]');
  if (!container) return;

  if (!skillsData || skillsData.skills.length === 0) {
    container.innerHTML = `
      <div class="aiui-skills-header">
        <h2>Tools & Skills</h2>
      </div>
      ${renderCategoryTabs()}
      <div class="aiui-skills-empty">
        <div class="aiui-empty-icon">🔧</div>
        <h3>No Tools Found</h3>
        <p>No tools match your current filter.</p>
      </div>
    `;
    return;
  }

  const enabledCount = skillsData.skills.filter(t => t.enabled).length;
  const cards = skillsData.skills.map(renderToolCard).join('');
  
  container.innerHTML = `
    <div class="aiui-skills-header">
      <div class="aiui-skills-title">
        <h2>Tools & Skills</h2>
        <span class="aiui-skills-summary">${enabledCount}/${skillsData.count} enabled</span>
      </div>
      <div class="aiui-skills-search">
        <input type="text" placeholder="Search tools..." value="${searchQuery}"
               oninput="window.aiuiSearchSkills(this.value)">
      </div>
    </div>
    ${renderCategoryTabs()}
    <div class="aiui-tools-grid">
      ${cards}
    </div>
  `;
}

function filterCategory(category) {
  activeCategory = category === 'null' ? null : category;
  fetchSkills().then(renderSkillsUI);
}

function searchSkills(query) {
  searchQuery = query;
  // Debounce search
  clearTimeout(window._skillsSearchTimeout);
  window._skillsSearchTimeout = setTimeout(() => {
    fetchSkills().then(renderSkillsUI);
  }, 300);
}

function injectStyles() {
  if (document.querySelector('#aiui-skills-styles')) return;
  const style = document.createElement('style');
  style.id = 'aiui-skills-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    [data-aiui-skills] {
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .aiui-skills-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .aiui-skills-title {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .aiui-skills-title h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0;
    }

    .aiui-skills-summary {
      font-size: 0.875rem;
      color: #64748b;
      background: rgba(148, 163, 184, 0.1);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
    }

    .aiui-skills-search input {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      color: #e2e8f0;
      font-size: 0.875rem;
      width: 200px;
    }

    .aiui-skills-search input::placeholder {
      color: #64748b;
    }

    .aiui-skills-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }

    .aiui-skills-tab {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      color: #94a3b8;
      font-size: 0.8125rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .aiui-skills-tab:hover {
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.3);
    }

    .aiui-skills-tab.active {
      background: rgba(59, 130, 246, 0.2);
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .aiui-tab-count {
      background: rgba(148, 163, 184, 0.2);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.6875rem;
    }

    .aiui-tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }

    .aiui-tool-card {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
      border: 1px solid rgba(148, 163, 184, 0.1);
      border-radius: 0.75rem;
      padding: 1rem;
      transition: all 0.2s;
    }

    .aiui-tool-card:hover {
      border-color: rgba(59, 130, 246, 0.3);
      transform: translateY(-2px);
    }

    .aiui-tool-card.disabled {
      opacity: 0.6;
    }

    .aiui-tool-header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .aiui-tool-icon {
      font-size: 2rem;
      line-height: 1;
    }

    .aiui-tool-info {
      flex: 1;
    }

    .aiui-tool-name {
      font-size: 1rem;
      font-weight: 600;
      color: #f1f5f9;
      margin: 0 0 0.25rem 0;
    }

    .aiui-tool-category {
      font-size: 0.6875rem;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.05em;
    }

    .aiui-tool-description {
      font-size: 0.8125rem;
      color: #94a3b8;
      margin: 0 0 0.75rem 0;
      line-height: 1.5;
    }

    .aiui-tool-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .aiui-tool-type {
      font-size: 0.6875rem;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      text-transform: uppercase;
    }

    .aiui-tool-type.builtin {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
    }

    .aiui-tool-type.custom {
      background: rgba(168, 85, 247, 0.2);
      color: #c084fc;
    }

    .aiui-tool-keys {
      font-size: 0.75rem;
      color: #f59e0b;
    }

    /* Toggle switch */
    .aiui-toggle {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
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
      background-color: rgba(148, 163, 184, 0.3);
      transition: 0.3s;
      border-radius: 22px;
    }

    .aiui-toggle-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }

    .aiui-toggle input:checked + .aiui-toggle-slider {
      background-color: #22c55e;
    }

    .aiui-toggle input:checked + .aiui-toggle-slider:before {
      transform: translateX(18px);
    }

    .aiui-skills-empty {
      text-align: center;
      padding: 4rem 2rem;
      color: #94a3b8;
    }

    .aiui-empty-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .aiui-skills-empty h3 {
      font-size: 1.25rem;
      color: #e2e8f0;
      margin: 0 0 0.5rem 0;
    }

    @media (max-width: 768px) {
      .aiui-skills-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }
      .aiui-skills-search input {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);
}

function checkForSkillsPage(root) {
  const skillsSection = root.querySelector('[data-page="skills"]') ||
                        root.querySelector('.skills-page') ||
                        root.querySelector('#skills');
  
  if (skillsSection && !skillsSection.hasAttribute('data-aiui-skills')) {
    skillsSection.setAttribute('data-aiui-skills', 'true');
    Promise.all([fetchSkills(), fetchCategories()]).then(renderSkillsUI);
    
    // Auto-refresh every 30 seconds
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(async () => {
      await fetchSkills();
      renderSkillsUI();
    }, 30000);
  }
}

// Expose functions globally
window.aiuiToggleSkill = toggleSkill;
window.aiuiFilterCategory = filterCategory;
window.aiuiSearchSkills = searchSkills;

export default {
  name: 'skills',
  async init() {
    injectStyles();
    console.debug('[AIUI:skills] Plugin loaded');
  },
  onContentChange(root) {
    checkForSkillsPage(root);
  },
};
