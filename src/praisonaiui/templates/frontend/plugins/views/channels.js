/**
 * Channels View — Multi-platform messaging channel management.
 *
 * Enhanced with: per-platform configuration forms (Slack, Discord, Telegram,
 *                WhatsApp, Signal, Google Chat, Nostr), connection testing,
 *                platform-specific setup steps, status details.
 *
 * API: /api/channels, /api/channels/platforms
 */
export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let channels = [], platforms = [];
  try { const r = await fetch('/api/channels'); const d = await r.json(); channels = d.channels || d || []; if (!Array.isArray(channels)) channels = Object.entries(channels).map(([id,c]) => ({id,...(typeof c==='object'?c:{platform:c})})); } catch(e) {}
  try { const r = await fetch('/api/channels/platforms'); const d = await r.json(); platforms = d.platforms || d || []; } catch(e) {}

  // envKey: env var name to auto-fill from .env
  const platformMeta = {
    discord:    { icon: '🎮', color: '#5865F2', fields: ['Bot Token'], envKey: 'DISCORD_BOT_TOKEN' },
    slack:      { icon: '💬', color: '#4A154B', fields: ['Bot Token', 'Signing Secret'], envKey: 'SLACK_BOT_TOKEN' },
    telegram:   { icon: '✈️', color: '#229ED9', fields: ['Bot Token'], envKey: 'TELEGRAM_BOT_TOKEN' },
    whatsapp:   { icon: '📱', color: '#25D366', fields: ['Phone Number ID', 'Access Token', 'Verify Token'] },
    imessage:   { icon: '🍎', color: '#007AFF', fields: ['Apple ID', 'Handler Path'] },
    signal:     { icon: '🔒', color: '#3A76F0', fields: ['Phone Number', 'API URL'] },
    googlechat: { icon: '💼', color: '#00AC47', fields: ['Service Account', 'Space Name'] },
    nostr:      { icon: '🟣', color: '#9B59B6', fields: ['Private Key (nsec)', 'Relay URL'] },
  };

  // Try to load env token availability for auto-fill
  let envTokens = {};
  try { const r = await fetch('/api/channels/env-tokens'); const d = await r.json(); envTokens = d.env_tokens || {}; } catch(e) {}

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <span style="color:var(--db-text-dim);font-size:13px">${channels.length} channel(s)</span>
        <span style="margin-left:8px;font-size:11px;color:var(--db-text-dim)">${platforms.length || Object.keys(platformMeta).length} platforms supported</span>
      </div>
      <button id="ch-add" style="background:var(--db-accent);color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500">+ Add Channel</button>
    </div>
    <div id="ch-grid" class="db-columns" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))"></div>
    <div id="ch-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;align-items:center;justify-content:center"></div>
  `;

  const grid = container.querySelector('#ch-grid');
  channels.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'db-card';
    const platform = (ch.platform || ch.type || ch.id || '').toLowerCase();
    const meta = platformMeta[platform] || { icon: '📡', color: 'var(--db-accent)', fields: [] };
    const enabled = ch.enabled !== false;
    const status = ch.status || (enabled ? 'connected' : 'disconnected');
    const isConnected = status === 'connected' || status === 'running';

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;background:${meta.color}22">${meta.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px">${ch.name || ch.id || platform}</div>
          <div style="font-size:12px;color:var(--db-text-dim);margin-top:1px">${platform.charAt(0).toUpperCase() + platform.slice(1)}</div>
        </div>
        <span style="font-size:11px;padding:3px 10px;border-radius:12px;${isConnected ? 'background:rgba(34,197,94,.15);color:#22c55e' : 'background:rgba(239,68,68,.15);color:#ef4444'}">${isConnected ? '● Connected' : '○ ' + status}</span>
      </div>
      ${ch.last_message ? `<div style="font-size:11px;color:var(--db-text-dim);margin-bottom:8px;padding:6px 10px;background:rgba(0,0,0,.03);border-radius:6px">Last: ${ch.last_message}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="ch-toggle" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">${enabled ? 'Disable' : 'Enable'}</button>
        <button class="ch-restart" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">⟳ Restart</button>
        <button class="ch-test" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:6px;cursor:pointer">🔍 Test</button>
        <button class="ch-del" data-id="${ch.id}" style="font-size:11px;padding:4px 12px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#ef4444;border-radius:6px;cursor:pointer">Delete</button>
      </div>
    `;
    grid.appendChild(card);
  });

  if (channels.length === 0) grid.innerHTML = '<div class="db-viewer"><pre>No channels configured. Click "+ Add Channel" to connect a platform.</pre></div>';

  // Event listeners
  container.querySelectorAll('.ch-toggle').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/channels/${b.dataset.id}/toggle`, {method:'POST'}); render(container); } catch(e){} }));
  container.querySelectorAll('.ch-restart').forEach(b => b.addEventListener('click', async () => { try { await fetch(`/api/channels/${b.dataset.id}/restart`, {method:'POST'}); } catch(e){} }));
  container.querySelectorAll('.ch-test').forEach(b => b.addEventListener('click', async () => {
    try {
      const r = await fetch(`/api/channels/${b.dataset.id}/test`, {method:'POST'});
      const d = await r.json();
      alert(d.success ? '✓ Connection test passed!' : '✗ Test failed: ' + (d.error || 'Unknown error'));
    } catch(e) { alert('✗ Test failed'); }
  }));
  container.querySelectorAll('.ch-del').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete this channel?')) return; try { await fetch(`/api/channels/${b.dataset.id}`, {method:'DELETE'}); render(container); } catch(e){} }));

  // Add Channel Modal with platform-specific forms
  container.querySelector('#ch-add')?.addEventListener('click', () => {
    const m = container.querySelector('#ch-modal'); m.style.display = 'flex';
    const platformList = Array.isArray(platforms) && platforms.length > 0 ? platforms : Object.keys(platformMeta);

    m.innerHTML = `<div style="background:var(--db-sidebar-bg);border:1px solid var(--db-border);border-radius:12px;padding:28px;width:480px;max-height:80vh;overflow-y:auto">
      <h3 style="margin:0 0 20px;font-size:18px">Add Channel</h3>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Platform</span>
        <select id="chf-platform" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box">
          ${platformList.map(p => {
            const pm = platformMeta[p] || { icon: '📡' };
            return `<option value="${p}">${pm.icon} ${p.charAt(0).toUpperCase() + p.slice(1)}</option>`;
          }).join('')}
        </select>
      </label>
      <label style="display:block;margin-bottom:14px"><span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">Channel Name</span><input id="chf-name" placeholder="my-bot" style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box"></label>
      <div id="chf-fields" style="margin-bottom:14px"></div>
      <div id="chf-setup-hint" style="margin-bottom:20px;padding:10px 14px;background:rgba(var(--db-accent-rgb,100,100,255),.06);border-radius:8px;font-size:12px;color:var(--db-text-dim)"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button id="chf-cancel" style="padding:8px 16px;border:1px solid var(--db-border);background:transparent;color:var(--db-text);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="chf-save" style="padding:8px 16px;background:var(--db-accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500">Add Channel</button>
      </div>
    </div>`;

    function updatePlatformFields() {
      const platform = m.querySelector('#chf-platform').value;
      const pm = platformMeta[platform] || { fields: [], icon: '📡' };
      const fieldsDiv = m.querySelector('#chf-fields');
      const hintDiv = m.querySelector('#chf-setup-hint');

      // Check if env var has a token for this platform
      const envInfo = envTokens[platform] || {};
      const hasEnv = envInfo.available === true;
      const envKey = envInfo.env_var || '';

      fieldsDiv.innerHTML = pm.fields.map((f, i) => {
        const fieldKey = f.toLowerCase().replace(/\s+/g, '_');
        const isToken = f.toLowerCase().includes('token') || f.toLowerCase().includes('secret') || f.toLowerCase().includes('key');
        // Auto-fill bot_token from .env if available
        const autoVal = (fieldKey === 'bot_token' && hasEnv) ? 'from .env' : '';
        const autoAttr = (fieldKey === 'bot_token' && hasEnv) ? `value="env:${envKey}" disabled` : '';
        return `<label style="display:block;margin-bottom:10px">
          <span style="font-size:12px;color:var(--db-text-dim);display:block;margin-bottom:4px">${f}${autoVal ? ' <span style="color:#22c55e;font-size:11px">(✓ loaded from .env)</span>' : ''}</span>
          <input class="chf-field" data-field="${fieldKey}" type="${isToken ? 'password' : 'text'}" placeholder="${f}" ${autoAttr} style="width:100%;padding:8px 12px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:14px;box-sizing:border-box">
        </label>`;
      }).join('');

      const hints = {
        discord: '1. Create a Bot at discord.com/developers\n2. Enable Message Content Intent\n3. Copy the Bot Token\n4. Invite bot to your server\n\nServer ID and Channel ID are auto-discovered.',
        slack: '1. Create a Slack App at api.slack.com\n2. Add Bot Token Scopes (chat:write, app_mentions:read)\n3. Install to workspace\n4. Copy Bot Token and Signing Secret',
        telegram: '1. Message @BotFather on Telegram\n2. Create a new bot with /newbot\n3. Copy the Bot Token\n\nChat ID is auto-detected when users message the bot.',
        whatsapp: '1. Create a Meta Business App\n2. Set up WhatsApp Business API\n3. Copy Phone Number ID and Access Token',
      };
      hintDiv.innerHTML = hints[platform] ? '<strong>Setup Steps:</strong><pre style="margin:6px 0 0;white-space:pre-wrap">' + hints[platform] + '</pre>' : `Configure your ${platform} integration above.`;
    }

    updatePlatformFields();
    m.querySelector('#chf-platform').addEventListener('change', updatePlatformFields);
    m.querySelector('#chf-cancel').addEventListener('click', () => m.style.display = 'none');
    m.querySelector('#chf-save').addEventListener('click', async () => {
      const platform = m.querySelector('#chf-platform').value;
      const pm = platformMeta[platform] || {};
      const config = {};
      m.querySelectorAll('.chf-field').forEach(f => {
        const val = f.value;
        // For env: references, resolve to actual env var name for backend
        config[f.dataset.field] = val.startsWith('env:') ? val : val;
      });
      const body = { platform, name: m.querySelector('#chf-name').value || platform + '-bot', config };
      try { await fetch('/api/channels', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); m.style.display='none'; render(container); } catch(e){}
    });
    m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });
}
