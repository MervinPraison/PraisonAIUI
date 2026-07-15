/**
 * Channels View — Multi-platform messaging channel management with CRUD.
 *
 * Restores the Add Channel modal, per-platform credential fields, setup hints,
 * and card actions (Enable/Disable, Restart, Test, Delete) removed in the
 * 3961508 refactor. Aligned with #176 secret policy: credential inputs default
 * to env references (env:VAR_NAME), stored secrets are never re-displayed
 * (uses *_set flags from the redacted GET), and API 400 validation errors are
 * surfaced inline in the modal.
 *
 * API: /api/channels, /api/channels/platforms, /api/channels/{id}/{toggle,restart,test}
 */
import { showToast, showConfirm } from '../toast.js';

const PLATFORM_META = {
  discord: { icon: '🎮', color: '#5865F2', fields: [{ key: 'bot_token', label: 'Bot Token', secret: true }] },
  slack: { icon: '💬', color: '#4A154B', fields: [
    { key: 'bot_token', label: 'Bot Token', secret: true },
    { key: 'app_token', label: 'App Token', secret: true },
    { key: 'signing_secret', label: 'Signing Secret', secret: true, optional: true },
  ] },
  telegram: { icon: '✈️', color: '#229ED9', fields: [{ key: 'bot_token', label: 'Bot Token', secret: true }] },
  whatsapp: { icon: '📱', color: '#25D366', fields: [
    { key: 'access_token', label: 'Access Token', secret: true },
    { key: 'phone_number_id', label: 'Phone Number ID' },
    { key: 'verify_token', label: 'Verify Token', secret: true, optional: true },
  ] },
  imessage: { icon: '🍎', color: '#007AFF', fields: [
    { key: 'apple_id', label: 'Apple ID' },
    { key: 'handler_path', label: 'Handler Path' },
  ] },
  signal: { icon: '🔒', color: '#3A76F0', fields: [
    { key: 'phone_number', label: 'Phone Number' },
    { key: 'api_url', label: 'API URL' },
  ] },
  googlechat: { icon: '💼', color: '#00AC47', fields: [
    { key: 'service_account', label: 'Service Account', secret: true },
    { key: 'space_name', label: 'Space Name' },
  ] },
  nostr: { icon: '🟣', color: '#9B59B6', fields: [
    { key: 'private_key', label: 'Private Key (nsec)', secret: true },
    { key: 'relay_url', label: 'Relay URL' },
  ] },
};

const SETUP_HINTS = {
  discord: '1. Create a Bot at discord.com/developers\n2. Enable Message Content Intent\n3. Copy the Bot Token\n4. Invite bot to your server',
  slack: '1. Create a Slack App at api.slack.com\n2. Add Bot Token Scopes (chat:write, app_mentions:read)\n3. Enable Socket Mode → copy App Token (xapp-...)\n4. Install to workspace → copy Bot Token (xoxb-...)',
  telegram: '1. Message @BotFather on Telegram\n2. Create a new bot with /newbot\n3. Copy the Bot Token',
  whatsapp: '1. Create a Meta Business App\n2. Set up WhatsApp Business API\n3. Copy Phone Number ID and Access Token',
};

function metaFor(platform) {
  return PLATFORM_META[platform] || { icon: '📡', color: 'var(--db-accent)', fields: [] };
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

export async function render(container) {
  container.setAttribute('data-page', 'channels');
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let channels = [];
  let platforms = [];
  try {
    const r = await fetch('/api/channels');
    const d = await r.json();
    channels = d.channels || d || [];
    if (!Array.isArray(channels)) {
      channels = Object.entries(channels).map(([id, c]) => ({ id, ...(typeof c === 'object' ? c : { platform: c }) }));
    }
  } catch (e) {}
  try {
    const r = await fetch('/api/channels/platforms');
    const d = await r.json();
    platforms = d.platforms || d || [];
  } catch (e) {}
  if (!Array.isArray(platforms) || platforms.length === 0) platforms = Object.keys(PLATFORM_META);

  const online = channels.filter(c => c.running === true).length;

  container.innerHTML = `
    <div style="padding:24px;max-width:1200px;margin:0 auto">
      <div class="aiui-channels-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <h2 style="margin:0;font-size:1.5rem">Messaging Channels</h2>
          <div style="margin-top:4px;font-size:13px;color:var(--db-text-dim)">${online} Online · ${channels.length} Total</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <a href="/inbox" style="font-size:.85rem;color:var(--db-accent,#6366f1);text-decoration:none">Open Inbox →</a>
          <button id="ch-add" style="padding:8px 18px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem">+ Add Channel</button>
        </div>
      </div>
      <div id="ch-grid" class="db-columns" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px"></div>
      <div id="ch-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center"></div>
    </div>`;

  const grid = container.querySelector('#ch-grid');

  if (channels.length === 0) {
    grid.innerHTML = `
      <div class="aiui-channels-empty" style="grid-column:1/-1;text-align:center;padding:3rem 2rem;color:var(--db-text-dim)">
        <div style="font-size:3rem;opacity:.5;margin-bottom:1rem">📡</div>
        <h3 style="color:var(--db-text);margin:0 0 .5rem">No Channels Configured</h3>
        <p style="margin:.5rem 0">Click <strong>+ Add Channel</strong> to connect Discord, Slack, Telegram, or WhatsApp.</p>
      </div>`;
  } else {
    channels.forEach(ch => {
      const platform = (ch.platform || ch.type || ch.id || '').toLowerCase();
      const meta = metaFor(platform);
      const enabled = ch.enabled !== false;
      const isRunning = ch.running === true;
      const hasError = !!(ch.start_error && ch.start_error !== '');
      const statusLabel = !enabled ? 'Disabled' : isRunning ? 'Connected' : hasError ? 'Error' : 'Stopped';
      const card = document.createElement('div');
      card.className = 'db-card';
      card.style.cssText = 'padding:16px;border-radius:12px';
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;background:${meta.color}22">${meta.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:15px">${esc(ch.name || ch.id || platform)}</div>
            <div style="font-size:12px;color:var(--db-text-dim);margin-top:1px;text-transform:capitalize">${esc(platform)}</div>
          </div>
          <span style="font-size:11px;padding:3px 10px;border-radius:12px;${isRunning ? 'background:rgba(34,197,94,.15);color:#22c55e' : hasError ? 'background:rgba(234,179,8,.15);color:#eab308' : 'background:rgba(239,68,68,.15);color:#ef4444'}">${isRunning ? '●' : hasError ? '⚠' : '○'} ${statusLabel}</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="ch-toggle" data-id="${esc(ch.id)}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">${enabled ? 'Disable' : 'Enable'}</button>
          <button class="ch-restart" data-id="${esc(ch.id)}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">⟳ Restart</button>
          <button class="ch-test" data-id="${esc(ch.id)}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">🔍 Test</button>
          <button class="ch-del" data-id="${esc(ch.id)}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">Delete</button>
        </div>`;
      grid.appendChild(card);
    });
  }

  container.querySelectorAll('.ch-toggle').forEach(b => b.addEventListener('click', async () => {
    try {
      const r = await fetch(`/api/channels/${b.dataset.id}/toggle`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      render(container);
    } catch (e) { showToast('Toggle failed: ' + e.message, 'error'); }
  }));

  container.querySelectorAll('.ch-restart').forEach(b => b.addEventListener('click', async () => {
    try {
      const r = await fetch(`/api/channels/${b.dataset.id}/restart`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast('Channel restart initiated', 'success');
    } catch (e) { showToast('Restart failed: ' + e.message, 'error'); }
  }));

  container.querySelectorAll('.ch-test').forEach(b => b.addEventListener('click', async () => {
    try {
      const r = await fetch(`/api/channels/${b.dataset.id}/test`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      const ok = r.ok && d.success !== false;
      showToast(ok ? 'Connection test passed!' : 'Test failed: ' + (d.error || `HTTP ${r.status}`), ok ? 'success' : 'error');
      if (ok) render(container);
    } catch (e) { showToast('Test failed: ' + e.message, 'error'); }
  }));

  container.querySelectorAll('.ch-del').forEach(b => b.addEventListener('click', async () => {
    if (!await showConfirm('Delete channel?', 'This action cannot be undone.')) return;
    try {
      const r = await fetch(`/api/channels/${b.dataset.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      render(container);
    } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
  }));

  container.querySelector('#ch-add')?.addEventListener('click', () => openAddModal(container, platforms));
}

function openAddModal(container, platforms) {
  const m = container.querySelector('#ch-modal');
  m.style.display = 'flex';
  m.innerHTML = `
    <div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;padding:28px;width:480px;max-width:92vw;max-height:80vh;overflow-y:auto">
      <h3 style="margin:0 0 20px;font-size:18px">Add Channel</h3>
      <label style="display:block;margin-bottom:14px">
        <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Platform</span>
        <select id="chf-platform" class="db-form-select">
          ${platforms.map(p => `<option value="${esc(p)}">${metaFor(p).icon} ${esc(p.charAt(0).toUpperCase() + p.slice(1))}</option>`).join('')}
        </select>
      </label>
      <label style="display:block;margin-bottom:14px">
        <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Channel Name <span style="opacity:.5">(Optional)</span></span>
        <input id="chf-name" class="db-form-input" placeholder="my-bot">
      </label>
      <div id="chf-fields" style="margin-bottom:14px"></div>
      <div id="chf-error" style="display:none;margin-bottom:14px;padding:10px 14px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:8px;font-size:12px;color:#ef4444"></div>
      <div id="chf-setup-hint" style="margin-bottom:20px;padding:10px 14px;background:rgba(99,102,241,.08);border-radius:8px;font-size:12px;color:var(--db-text-dim)"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="chf-cancel" style="padding:8px 16px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="chf-save" style="padding:8px 16px;background:var(--db-accent,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500">Add Channel</button>
      </div>
    </div>`;

  const selectEl = m.querySelector('#chf-platform');
  const fieldsDiv = m.querySelector('#chf-fields');
  const hintDiv = m.querySelector('#chf-setup-hint');
  const errDiv = m.querySelector('#chf-error');

  function updateFields() {
    const platform = selectEl.value;
    const meta = metaFor(platform);
    fieldsDiv.innerHTML = meta.fields.map(f => {
      const optTag = f.optional ? ' <span style="opacity:.5">(Optional)</span>' : '';
      const placeholder = f.secret ? `env:${platform.toUpperCase()}_${f.key.toUpperCase()}` : f.label;
      const helper = f.secret
        ? '<span style="font-size:11px;color:var(--db-text-dim);display:block;margin-top:3px">Use an env reference — inline secrets are rejected.</span>'
        : '';
      return `<label style="display:block;margin-bottom:10px">
        <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">${esc(f.label)}${optTag}</span>
        <input class="chf-field db-form-input" data-field="${esc(f.key)}" data-optional="${f.optional ? '1' : '0'}" type="text" placeholder="${esc(placeholder)}">
        ${helper}
      </label>`;
    }).join('');
    hintDiv.innerHTML = SETUP_HINTS[platform]
      ? '<strong>Setup Steps:</strong><pre style="margin:6px 0 0;white-space:pre-wrap;font-family:inherit">' + esc(SETUP_HINTS[platform]) + '</pre>'
      : `Configure your ${esc(platform)} integration above.`;
    errDiv.style.display = 'none';
  }

  updateFields();
  selectEl.addEventListener('change', updateFields);
  m.querySelector('#chf-cancel').addEventListener('click', () => { m.style.display = 'none'; });
  m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });

  m.querySelector('#chf-save').addEventListener('click', async () => {
    const platform = selectEl.value;
    const config = {};
    m.querySelectorAll('.chf-field').forEach(f => {
      const v = f.value.trim();
      if (v) config[f.dataset.field] = v;
    });
    const body = {
      platform,
      name: m.querySelector('#chf-name').value.trim() || platform + '-bot',
      enabled: true,
      config,
    };
    errDiv.style.display = 'none';
    try {
      const r = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        errDiv.textContent = d.error || d.detail || `Request failed (HTTP ${r.status})`;
        errDiv.style.display = 'block';
        return;
      }
      m.style.display = 'none';
      showToast('Channel added', 'success');
      render(container);
    } catch (e) {
      errDiv.textContent = e.message;
      errDiv.style.display = 'block';
    }
  });
}
