/**
 * Skills View — tool/skill catalog with enable/disable toggles
 * API: /api/skills
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let tools = [], categories = [];
  try { const r = await fetch('/api/skills'); const d = await r.json(); tools = d.tools || d.skills || d || []; if (!Array.isArray(tools)) tools = Object.entries(tools).map(([id,t]) => ({id,...(typeof t==='object'?t:{name:t})})); } catch(e) {}
  try { const r = await fetch('/api/skills/categories'); const d = await r.json(); categories = d.categories || d || []; } catch(e) {}

  // Group by category
  const grouped = {};
  tools.forEach(t => { const cat = t.category || 'other'; if (!grouped[cat]) grouped[cat] = []; grouped[cat].push(t); });

  const enabledCount = tools.filter(t => t.enabled !== false).length;

  container.innerHTML = `
    <div class="db-columns" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="db-card"><div class="db-card-title">Total Skills</div><div class="db-card-value">${tools.length}</div></div>
      <div class="db-card"><div class="db-card-title">Enabled</div><div class="db-card-value" style="color:#22c55e">${enabledCount}</div></div>
      <div class="db-card"><div class="db-card-title">Categories</div><div class="db-card-value">${Object.keys(grouped).length}</div></div>
    </div>
    <div id="skills-list"></div>
  `;

  const list = container.querySelector('#skills-list');
  for (const [category, catTools] of Object.entries(grouped)) {
    const section = document.createElement('div');
    section.style.marginBottom = '20px';
    section.innerHTML = `<h3 style="font-size:14px;font-weight:600;margin:0 0 10px;text-transform:capitalize">${category} (${catTools.length})</h3>`;

    const grid = document.createElement('div');
    grid.className = 'db-columns';
    grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(280px,1fr))';

    catTools.forEach(t => {
      const card = document.createElement('div');
      card.className = 'db-card';
      card.style.cssText = 'padding:14px 18px;display:flex;align-items:center;justify-content:space-between';
      const enabled = t.enabled !== false;
      const icon = t.icon || '🔧';
      const keyStatus = t.api_key_set ? '🔑' : '';
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <span style="font-size:20px">${icon}</span>
          <div>
            <div style="font-size:13px;font-weight:500">${t.name || t.id} ${keyStatus}</div>
            <div style="font-size:11px;color:var(--db-text-dim)">${t.description || ''}</div>
          </div>
        </div>
        <label style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer">
          <input type="checkbox" class="skill-toggle" data-id="${t.id || t.name}" ${enabled ? 'checked' : ''} style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;background:${enabled ? 'var(--db-accent)' : 'var(--db-border)'};border-radius:22px;transition:0.3s"></span>
          <span style="position:absolute;top:2px;left:${enabled ? '20px' : '2px'};width:18px;height:18px;background:#fff;border-radius:50%;transition:0.3s"></span>
        </label>
      `;
      grid.appendChild(card);
    });

    section.appendChild(grid);
    list.appendChild(section);
  }

  if (tools.length === 0) list.innerHTML = '<div class="db-viewer"><pre>No skills/tools available</pre></div>';

  container.querySelectorAll('.skill-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      try { await fetch(`/api/skills/${cb.dataset.id}/toggle`, {method:'POST'}); render(container); } catch(e) {}
    });
  });
}
