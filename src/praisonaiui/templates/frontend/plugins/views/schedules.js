/**
 * Schedules View — Cron/interval job management with run history.
 *
 * Enhanced with: run history log, next-run countdown, channel targeting,
 *                schedule type toggle (cron vs interval), advanced form fields.
 *
 * API: /api/schedules
 */
import { helpBanner } from '/plugins/views/_helpers.js';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let jobs = [], history = [];
  try {
    const r = await fetch('/api/schedules');
    const d = await r.json();
    jobs = d.jobs || d.schedules || d || [];
    if (!Array.isArray(jobs)) jobs = Object.values(jobs);
  } catch(e) {}
  try {
    const r = await fetch('/api/schedules/history');
    const d = await r.json();
    history = d.history || d.runs || d || [];
    if (!Array.isArray(history)) history = [];
  } catch(e) {}

  const enabledCount = jobs.filter(j => j.enabled !== false).length;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <span style="color:var(--db-text-dim);font-size:13px">${jobs.length} schedule(s)</span>
        <span style="margin-left:8px;font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(34,197,94,.15);color:#22c55e">${enabledCount} active</span>
      </div>
      <button id="sched-add" style="background:var(--db-accent);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500">+ Add Schedule</button>
    </div>

    <div style="display:flex;gap:20px">
      <!-- Schedule List -->
      <div style="flex:1" id="sched-list"></div>

      <!-- Run History Panel -->
      <div style="width:300px">
        <div class="db-card">
          <div class="db-card-title">Run History</div>
          <div id="sched-history" style="max-height:500px;overflow-y:auto;margin-top:8px">
            ${history.length === 0 ? '<div style="font-size:12px;color:var(--db-text-dim);padding:8px 0">No runs yet</div>' :
              history.slice(0, 30).map(h => `
                <div style="padding:8px 0;border-bottom:1px solid var(--db-border);font-size:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:500">${h.name || h.job_id || 'unknown'}</span>
                    <span style="font-size:10px;padding:2px 6px;border-radius:8px;${h.status === 'succeeded' || h.status === 'success' ? 'background:rgba(34,197,94,.15);color:#22c55e' : h.status === 'failed' ? 'background:rgba(239,68,68,.15);color:#ef4444' : 'background:rgba(59,130,246,.15);color:#3b82f6'}">${h.status || 'unknown'}</span>
                  </div>
                  <div style="color:var(--db-text-dim);font-size:11px;margin-top:2px">${h.timestamp ? new Date(typeof h.timestamp === 'number' ? h.timestamp * 1000 : h.timestamp).toLocaleString() : ''}</div>
                  ${h.duration ? `<div style="color:var(--db-text-dim);font-size:11px">Duration: ${h.duration}s</div>` : ''}
                  ${h.result ? `<div style="margin-top:4px;padding:6px 8px;background:var(--db-card-bg);border-radius:4px;font-size:11px;color:var(--db-text);max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-word">${String(h.result).substring(0, 500)}</div>` : ''}
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>
    </div>

    ${helpBanner({
      title: 'Jobs & Schedules',
      what: 'Set up your AI agents to run tasks automatically on a schedule — like daily reports, regular check-ins, or periodic data updates.',
      howToUse: 'Click <b>+ Add Schedule</b> above to create a new recurring task. Give it a name, choose how often it runs (e.g. every hour, daily at 9am), and describe what the agent should do. You can pause, resume, or run any job instantly with the buttons on each card.',
      tip: 'You can also ask your agent in chat: <i>"Remind me every morning at 9am to check the dashboard"</i> to create schedules conversationally.',
      collapsed: true,
    })}

    <div id="sched-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center"></div>
  `;

  const list = container.querySelector('#sched-list');
  jobs.forEach(j => {
    const card = document.createElement('div');
    card.className = 'db-card';
    card.style.cssText = 'margin-bottom:10px;padding:16px 20px;';
    const enabled = j.enabled !== false;
    const sched = typeof j.schedule === 'object' && j.schedule
      ? (j.schedule.cron_expr || (j.schedule.every_seconds ? `every ${j.schedule.every_seconds}s` : j.schedule.kind || ''))
      : (j.schedule || j.cron || j.interval || '');
    const nextRun = j.next_run ? new Date(typeof j.next_run === 'number' ? j.next_run * 1000 : j.next_run) : null;
    const nextRunStr = nextRun ? formatCountdown(nextRun) : '';
    const channel = j.channel || j.target_channel || '';

    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;font-size:14px">${j.name || j.job_id || j.id || 'Unnamed'}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:10px;${enabled ? 'background:rgba(34,197,94,.15);color:#22c55e' : 'background:rgba(239,68,68,.15);color:#ef4444'}">${enabled ? '● Active' : '○ Disabled'}</span>
          </div>
          <div style="font-size:12px;color:var(--db-text-dim);margin-top:6px">
            <span style="margin-right:12px">📅 ${sched}</span>
            ${j.message || j.action || j.task ? `<span style="margin-right:12px">📝 ${j.message || j.action || j.task}</span>` : ''}
            ${channel ? `<span style="margin-right:12px">📢 ${channel}</span>` : ''}
          </div>
          ${nextRunStr ? `<div style="font-size:11px;color:var(--db-accent);margin-top:4px">⏱ Next: ${nextRunStr}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <button class="sched-toggle" data-id="${j.job_id||j.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">${enabled ? 'Disable' : 'Enable'}</button>
          <button class="sched-run" data-id="${j.job_id||j.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">▶ Run Now</button>
          <button class="sched-del" data-id="${j.job_id||j.id}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">✕</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  if (jobs.length === 0) list.innerHTML = '<div class="db-viewer"><pre>No schedules configured</pre></div>';

  // Event listeners
  container.querySelectorAll('.sched-toggle').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/schedules/${b.dataset.id}/toggle`, {method:'POST'}); render(container); } catch(e){} }));
  container.querySelectorAll('.sched-run').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/schedules/${b.dataset.id}/run`, {method:'POST'}); setTimeout(() => render(container), 1000); } catch(e){} }));
  container.querySelectorAll('.sched-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this schedule?')) return; try { await fetch(`/api/schedules/${b.dataset.id}`, {method:'DELETE'}); render(container); } catch(e){} }));

  // Add Schedule Modal
  container.querySelector('#sched-add')?.addEventListener('click', () => {
    const m = container.querySelector('#sched-modal'); m.style.display = 'flex';
    m.innerHTML = `<div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;padding:28px;width:460px">
      <h3 style="margin:0 0 20px;font-size:18px">New Schedule</h3>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Name</span><input id="sf-name" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <div style="display:flex;gap:12px;margin-bottom:14px">
        <label style="flex:1"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Type</span>
          <select id="sf-type" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box">
            <option value="cron">Cron Expression</option>
            <option value="interval">Interval (seconds)</option>
          </select>
        </label>
        <label style="flex:2"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px" id="sf-schedule-label">Cron Expression</span><input id="sf-schedule" placeholder="*/5 * * * *" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      </div>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Action / Message</span><input id="sf-action" placeholder="Send daily report" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <label style="display:block;margin-bottom:20px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Target Channel (optional)</span><input id="sf-channel" placeholder="slack, discord, etc." style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="sf-cancel" style="padding:8px 16px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="sf-save" style="padding:8px 16px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500">Create</button>
      </div>
    </div>`;

    // Toggle label based on type
    m.querySelector('#sf-type').addEventListener('change', (e) => {
      const label = m.querySelector('#sf-schedule-label');
      const input = m.querySelector('#sf-schedule');
      if (e.target.value === 'interval') {
        label.textContent = 'Interval (seconds)';
        input.placeholder = '300';
        input.type = 'number';
      } else {
        label.textContent = 'Cron Expression';
        input.placeholder = '*/5 * * * *';
        input.type = 'text';
      }
    });

    m.querySelector('#sf-cancel').addEventListener('click', () => m.style.display = 'none');
    m.querySelector('#sf-save').addEventListener('click', async () => {
      const type = m.querySelector('#sf-type').value;
      const schedVal = m.querySelector('#sf-schedule').value;
      const body = {
        name: m.querySelector('#sf-name').value,
        schedule: type === 'interval' ? { every_seconds: parseInt(schedVal) || 60 } : schedVal,
        action: m.querySelector('#sf-action').value,
        channel: m.querySelector('#sf-channel').value || undefined,
      };
      try { await fetch('/api/schedules', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); m.style.display='none'; render(container); } catch(e){}
    });
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });
}

function formatCountdown(date) {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `in ${hours}h ${mins % 60}m`;
  return `in ${mins}m`;
}
