/**
 * Config View — schema-driven runtime configuration editor
 * API: /api/config, /api/config/schema
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let config = {}, schema = {}, history = [];
  try { const r = await fetch('/api/config'); config = await r.json(); } catch(e) {}
  try { const r = await fetch('/api/config/schema'); schema = await r.json(); } catch(e) {}
  try { const r = await fetch('/api/config/history'); const d = await r.json(); history = d.history || d || []; } catch(e) {}

  const properties = schema.properties || {};
  
  container.innerHTML = `
    <div style="display:flex;gap:24px">
      <div style="flex:1">
        <div id="config-form"></div>
        <div style="margin-top:20px;display:flex;gap:10px">
          <button id="cfg-save" style="padding:8px 20px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px">Save & Apply</button>
          <button id="cfg-validate" style="padding:8px 20px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer;font-size:13px">Validate</button>
        </div>
        <div id="cfg-feedback" style="margin-top:12px;font-size:13px"></div>
      </div>
      <div style="width:280px">
        <div class="db-card" style="margin-bottom:16px">
          <div class="db-card-title">Change History</div>
          <div id="cfg-history" style="max-height:400px;overflow-y:auto;margin-top:8px">
            ${(Array.isArray(history) ? history : []).slice(0, 20).map(h => `<div style="font-size:11px;padding:6px 0;border-bottom:1px solid var(--db-border);color:var(--db-text-dim)">${h.key || 'config'}: ${h.action || 'updated'}<br/>${h.timestamp ? new Date(h.timestamp * 1000).toLocaleString() : ''}</div>`).join('') || '<div style="font-size:12px;color:var(--db-text-dim)">No changes yet</div>'}
          </div>
        </div>
      </div>
    </div>
  `;

  const form = container.querySelector('#config-form');
  // Build form from schema
  for (const [section, schemaDef] of Object.entries(properties)) {
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'db-card';
    sectionDiv.style.marginBottom = '16px';
    let html = `<div class="db-card-title">${schemaDef.title || section}</div>`;
    const sectionProps = schemaDef.properties || {};
    for (const [key, propDef] of Object.entries(sectionProps)) {
      const value = (config[section] && config[section][key]) || propDef.default || '';
      const inputType = propDef.format === 'password' ? 'password' : propDef.type === 'integer' ? 'number' : 'text';
      if (propDef.type === 'boolean') {
        html += `<label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13px;cursor:pointer">
          <input type="checkbox" data-section="${section}" data-key="${key}" ${value ? 'checked' : ''} style="accent-color:var(--db-accent)"> ${propDef.title || key}
        </label>`;
      } else if (propDef.enum) {
        html += `<label style="display:block;margin:10px 0"><span style="font-size:12px;color:var(--db-text-dim)">${propDef.title || key}</span>
          <select data-section="${section}" data-key="${key}" style="display:block;width:100%;margin-top:4px;padding:6px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:13px;box-sizing:border-box">
            ${propDef.enum.map(e => `<option value="${e}" ${e === value ? 'selected' : ''}>${e}</option>`).join('')}
          </select></label>`;
      } else {
        html += `<label style="display:block;margin:10px 0"><span style="font-size:12px;color:var(--db-text-dim)">${propDef.title || key}</span>
          <input type="${inputType}" data-section="${section}" data-key="${key}" value="${value}" ${propDef.minimum !== undefined ? `min="${propDef.minimum}"` : ''} ${propDef.maximum !== undefined ? `max="${propDef.maximum}"` : ''} style="display:block;width:100%;margin-top:4px;padding:6px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:13px;box-sizing:border-box" /></label>`;
      }
    }
    sectionDiv.innerHTML = html;
    form.appendChild(sectionDiv);
  }

  if (Object.keys(properties).length === 0) {
    form.innerHTML = `<div class="db-viewer"><pre>${JSON.stringify(config, null, 2)}</pre></div>`;
  }

  const feedback = container.querySelector('#cfg-feedback');
  container.querySelector('#cfg-save')?.addEventListener('click', async () => {
    const patch = collectFormData(form);
    try { const r = await fetch('/api/config/apply', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)}); const d = await r.json(); feedback.innerHTML = `<span style="color:#22c55e">✓ ${d.message || 'Applied'}</span>`; } catch(e) { feedback.innerHTML = `<span style="color:#ef4444">✗ Failed</span>`; }
  });
  container.querySelector('#cfg-validate')?.addEventListener('click', async () => {
    const patch = collectFormData(form);
    try { const r = await fetch('/api/config/validate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)}); const d = await r.json(); feedback.innerHTML = d.valid ? `<span style="color:#22c55e">✓ Valid</span>` : `<span style="color:#ef4444">✗ ${(d.errors||[]).join(', ')}</span>`; } catch(e) { feedback.innerHTML = `<span style="color:#ef4444">✗ Error</span>`; }
  });
}

function collectFormData(form) {
  const data = {};
  form.querySelectorAll('[data-section]').forEach(el => {
    const s = el.dataset.section, k = el.dataset.key;
    if (!data[s]) data[s] = {};
    data[s][k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  });
  return data;
}
