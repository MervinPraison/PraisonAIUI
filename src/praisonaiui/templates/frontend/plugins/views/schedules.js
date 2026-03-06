/**
 * Schedules View — cron/interval job management
 * API: /api/schedules
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let jobs = [];
  try { const r = await fetch('/api/schedules'); const d = await r.json(); jobs = d.jobs || d.schedules || d || []; if (!Array.isArray(jobs)) jobs = Object.values(jobs); } catch(e) {}

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <span style="color:var(--db-text-dim);font-size:13px">${jobs.length} schedule(s)</span>
      <button id="sched-add" style="background:var(--db-accent);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px">+ Add Schedule</button>
    </div>
    <div id="sched-list"></div>
    <div id="sched-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center"></div>
  `;

  const list = container.querySelector('#sched-list');
  jobs.forEach(j => {
    const card = document.createElement('div');
    card.className = 'db-card';
    card.style.cssText = 'margin-bottom:10px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between';
    const enabled = j.enabled !== false;
    card.innerHTML = `
      <div style="flex:1">
        <div style="font-weight:500;font-size:14px">${j.name || j.job_id || j.id || 'Unnamed'}</div>
        <div style="font-size:12px;color:var(--db-text-dim);margin-top:4px">${j.schedule || j.cron || j.interval || ''} · ${j.action || j.task || ''}</div>
        ${j.next_run ? `<div style="font-size:11px;color:var(--db-text-dim);margin-top:2px">Next: ${j.next_run}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="sched-toggle" data-id="${j.job_id||j.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:${enabled ? 'rgba(34,197,94,0.15)' : 'var(--db-card-bg)'};color:${enabled ? '#22c55e' : 'var(--db-text-dim)'};border-radius:6px;cursor:pointer">${enabled ? '● Enabled' : '○ Disabled'}</button>
        <button class="sched-run" data-id="${j.job_id||j.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">▶ Run</button>
        <button class="sched-del" data-id="${j.job_id||j.id}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">✕</button>
      </div>
    `;
    list.appendChild(card);
  });

  if (jobs.length === 0) list.innerHTML = '<div class="db-viewer"><pre>No schedules configured</pre></div>';

  container.querySelectorAll('.sched-toggle').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/schedules/${b.dataset.id}/toggle`, {method:'POST'}); render(container); } catch(e){} }));
  container.querySelectorAll('.sched-run').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/schedules/${b.dataset.id}/run`, {method:'POST'}); } catch(e){} }));
  container.querySelectorAll('.sched-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete?')) return; try { await fetch(`/api/schedules/${b.dataset.id}`, {method:'DELETE'}); render(container); } catch(e){} }));

  container.querySelector('#sched-add')?.addEventListener('click', () => {
    const m = container.querySelector('#sched-modal'); m.style.display = 'flex';
    m.innerHTML = `<div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;padding:28px;width:420px">
      <h3 style="margin:0 0 20px;font-size:18px">New Schedule</h3>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Name</span><input id="sf-name" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Schedule (cron)</span><input id="sf-schedule" placeholder="*/5 * * * *" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <label style="display:block;margin-bottom:20px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Action</span><input id="sf-action" placeholder="Send report" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="sf-cancel" style="padding:8px 16px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="sf-save" style="padding:8px 16px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer">Create</button>
      </div>
    </div>`;
    m.querySelector('#sf-cancel').addEventListener('click', () => m.style.display = 'none');
    m.querySelector('#sf-save').addEventListener('click', async () => {
      const body = { name: m.querySelector('#sf-name').value, schedule: m.querySelector('#sf-schedule').value, action: m.querySelector('#sf-action').value };
      try { await fetch('/api/schedules', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); m.style.display='none'; render(container); } catch(e){}
    });
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });
}
