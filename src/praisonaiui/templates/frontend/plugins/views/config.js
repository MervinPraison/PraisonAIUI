/**
 * Config View — Schema-driven runtime configuration editor.
 *
 * Enhanced with: sidebar section navigation, search/filter, Form/Raw JSON toggle,
 *                section collapse/expand, change history, validation feedback.
 *
 * API: /api/config, /api/config/schema, /api/config/history
 */
import { helpBanner } from '/plugins/views/_helpers.js';

let currentSection = null;
let rawMode = false;
let searchQuery = '';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let config = {}, schema = {}, history = [];
  try { const r = await fetch('/api/config'); config = await r.json(); } catch(e) {}
  try { const r = await fetch('/api/config/schema'); schema = await r.json(); } catch(e) {}
  try { const r = await fetch('/api/config/history'); const d = await r.json(); history = d.history || d || []; } catch(e) {}

  const properties = schema.properties || {};
  const sections = Object.entries(properties);
  if (sections.length > 0 && !currentSection) currentSection = sections[0][0];

  container.innerHTML = `
    <div style="display:flex;gap:0;border:1px solid var(--db-border);border-radius:12px;overflow:hidden;min-height:500px">
      <!-- Sidebar Navigation -->
      <div style="width:200px;background:var(--db-sidebar-bg,var(--db-card-bg));border-right:1px solid var(--db-border);display:flex;flex-direction:column">
        <div style="padding:12px">
          <input id="cfg-search" type="text" placeholder="Search…" value="${searchQuery}" style="width:100%;padding:6px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:12px;box-sizing:border-box">
        </div>
        <div id="cfg-sections" style="flex:1;overflow-y:auto;padding:0 8px 8px">
          ${sections.map(([key, def]) => {
            const title = def.title || key;
            const hidden = searchQuery && !title.toLowerCase().includes(searchQuery.toLowerCase());
            return hidden ? '' : `<button class="cfg-section-btn${currentSection === key ? ' active' : ''}" data-section="${key}" style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:${currentSection === key ? 'rgba(var(--db-accent-rgb,100,100,255),.12)' : 'transparent'};color:${currentSection === key ? 'var(--db-accent)' : 'var(--db-text)'};border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:2px;font-weight:${currentSection === key ? '600' : '400'};transition:all .15s">${title}</button>`;
          }).join('')}
          ${sections.length === 0 ? '<div style="padding:12px;font-size:12px;color:var(--db-text-dim)">No schema available</div>' : ''}
        </div>
        <div style="padding:8px;border-top:1px solid var(--db-border)">
          <button id="cfg-mode-toggle" style="width:100%;padding:6px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer;font-size:11px;font-weight:500">${rawMode ? '📝 Form Mode' : '{ } Raw JSON'}</button>
        </div>
      </div>

      <!-- Content Area -->
      <div style="flex:1;display:flex;flex-direction:column">
        <div style="padding:16px 20px;border-bottom:1px solid var(--db-border);display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0;font-size:16px;font-weight:600">${currentSection ? (properties[currentSection]?.title || currentSection) : 'Configuration'}</h3>
          <div style="display:flex;gap:8px">
            <button id="cfg-validate" style="padding:6px 14px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer;font-size:12px">✓ Validate</button>
            <button id="cfg-save" style="padding:6px 14px;background:var(--db-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">Save & Apply</button>
          </div>
        </div>

        <div style="flex:1;overflow-y:auto;padding:20px" id="cfg-content">
          ${rawMode ? renderRawEditor(config) : renderFormEditor(config, properties, currentSection)}
        </div>

        <div id="cfg-feedback" style="padding:10px 20px;font-size:13px;border-top:1px solid var(--db-border);min-height:20px"></div>
      </div>

      <!-- History Panel -->
      <div style="width:220px;border-left:1px solid var(--db-border);background:var(--db-sidebar-bg,var(--db-card-bg))">
        <div style="padding:12px 14px;border-bottom:1px solid var(--db-border);font-size:13px;font-weight:600">Change History</div>
        <div id="cfg-history" style="max-height:500px;overflow-y:auto;padding:8px 14px">
          ${(Array.isArray(history) ? history : []).slice(0, 20).map(h => `
            <div style="font-size:11px;padding:8px 0;border-bottom:1px solid var(--db-border)">
              <div style="font-weight:500;color:var(--db-text)">${h.key || 'config'}: ${h.action || 'updated'}</div>
              <div style="color:var(--db-text-dim);margin-top:2px">${h.timestamp ? new Date(h.timestamp * 1000).toLocaleString() : ''}</div>
            </div>
          `).join('') || '<div style="font-size:12px;color:var(--db-text-dim)">No changes yet</div>'}
        </div>
      </div>
    </div>
    ${helpBanner({
      title: 'Configuration',
      what: 'This is your settings panel. You can adjust how your AI agents behave, which AI model they use, and how the server runs.',
      howToUse: 'Browse sections in the left sidebar, change any value, and click <b>Save & Apply</b>. Changes take effect immediately — no restart needed.',
      tip: 'Use the search box to quickly find a setting. Toggle between Form and Raw JSON mode at the bottom of the sidebar.',
      collapsed: true,
    })}
  `;

  // Bind section navigation
  container.querySelectorAll('.cfg-section-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSection = btn.dataset.section;
      render(container);
    });
  });

  // Search
  container.querySelector('#cfg-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    render(container);
  });

  // Mode toggle
  container.querySelector('#cfg-mode-toggle')?.addEventListener('click', () => {
    rawMode = !rawMode;
    render(container);
  });

  // Save
  const feedback = container.querySelector('#cfg-feedback');
  container.querySelector('#cfg-save')?.addEventListener('click', async () => {
    const patch = rawMode ? collectRawData(container) : collectFormData(container.querySelector('#cfg-content'));
    try {
      const r = await fetch('/api/config/apply', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)});
      const d = await r.json();
      feedback.innerHTML = `<span style="color:#22c55e">✓ ${d.message || 'Applied successfully'}</span>`;
    } catch(e) {
      feedback.innerHTML = `<span style="color:#ef4444">✗ Failed to apply</span>`;
    }
  });

  // Validate
  container.querySelector('#cfg-validate')?.addEventListener('click', async () => {
    const patch = rawMode ? collectRawData(container) : collectFormData(container.querySelector('#cfg-content'));
    try {
      const r = await fetch('/api/config/validate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)});
      const d = await r.json();
      feedback.innerHTML = d.valid
        ? `<span style="color:#22c55e">✓ Configuration is valid</span>`
        : `<span style="color:#ef4444">✗ ${(d.errors||[]).join(', ')}</span>`;
    } catch(e) {
      feedback.innerHTML = `<span style="color:#ef4444">✗ Validation error</span>`;
    }
  });
}

function renderFormEditor(config, properties, section) {
  if (!section || !properties[section]) {
    if (Object.keys(properties).length === 0) {
      return `<div class="db-viewer"><pre>${JSON.stringify(config, null, 2)}</pre></div>`;
    }
    return '<div style="color:var(--db-text-dim);font-size:13px">Select a section from the sidebar</div>';
  }

  const schemaDef = properties[section];
  const sectionProps = schemaDef.properties || {};
  let html = '';

  if (schemaDef.description) {
    html += `<div style="margin-bottom:16px;padding:10px 14px;background:rgba(var(--db-accent-rgb,100,100,255),.06);border-radius:8px;font-size:12px;color:var(--db-text-dim)">${schemaDef.description}</div>`;
  }

  for (const [key, propDef] of Object.entries(sectionProps)) {
    const value = (config[section] && config[section][key]) ?? propDef.default ?? '';
    const inputType = propDef.format === 'password' ? 'password' : propDef.type === 'integer' ? 'number' : 'text';
    const desc = propDef.description ? `<div style="font-size:11px;color:var(--db-text-dim);margin-top:2px">${propDef.description}</div>` : '';

    if (propDef.type === 'boolean') {
      html += `<label style="display:flex;align-items:center;gap:10px;margin:14px 0;font-size:13px;cursor:pointer;padding:8px 12px;border-radius:8px;transition:background .1s" onmouseenter="this.style.background='rgba(var(--db-accent-rgb,100,100,255),.04)'" onmouseleave="this.style.background=''">
        <input type="checkbox" data-section="${section}" data-key="${key}" ${value ? 'checked' : ''} style="accent-color:var(--db-accent);width:16px;height:16px">
        <div><div style="font-weight:500">${propDef.title || key}</div>${desc}</div>
      </label>`;
    } else if (propDef.enum) {
      html += `<label style="display:block;margin:14px 0">
        <span style="font-size:12px;font-weight:500">${propDef.title || key}</span>${desc}
        <select data-section="${section}" data-key="${key}" style="display:block;width:100%;margin-top:6px;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;color:var(--db-text);font-size:13px;box-sizing:border-box">
          ${propDef.enum.map(e => `<option value="${e}" ${e === value ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </label>`;
    } else {
      html += `<label style="display:block;margin:14px 0">
        <span style="font-size:12px;font-weight:500">${propDef.title || key}</span>${desc}
        <input type="${inputType}" data-section="${section}" data-key="${key}" value="${value}" ${propDef.minimum !== undefined ? `min="${propDef.minimum}"` : ''} ${propDef.maximum !== undefined ? `max="${propDef.maximum}"` : ''} placeholder="${propDef.default || ''}" style="display:block;width:100%;margin-top:6px;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;color:var(--db-text);font-size:13px;box-sizing:border-box" />
      </label>`;
    }
  }

  return html || '<div style="color:var(--db-text-dim);font-size:13px">No properties in this section</div>';
}

function renderRawEditor(config) {
  return `<textarea id="cfg-raw-editor" style="width:100%;height:400px;padding:12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:8px;color:var(--db-text);font-family:monospace;font-size:12px;line-height:1.6;resize:vertical;box-sizing:border-box">${JSON.stringify(config, null, 2)}</textarea>`;
}

function collectFormData(form) {
  const data = {};
  if (!form) return data;
  form.querySelectorAll('[data-section]').forEach(el => {
    const s = el.dataset.section, k = el.dataset.key;
    if (!data[s]) data[s] = {};
    data[s][k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  });
  return data;
}

function collectRawData(container) {
  const textarea = container.querySelector('#cfg-raw-editor');
  try { return JSON.parse(textarea?.value || '{}'); } catch(e) { return {}; }
}
