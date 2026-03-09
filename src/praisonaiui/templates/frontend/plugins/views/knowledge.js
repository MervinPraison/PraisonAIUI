/**
 * Knowledge View — manage knowledge base entries with search, upload, and RAG.
 *
 * API endpoints:
 *   GET    /api/knowledge          — list all
 *   POST   /api/knowledge          — store text
 *   POST   /api/knowledge/search   — search
 *   POST   /api/knowledge/add-file — file ingest
 *   GET    /api/knowledge/status   — stats
 *   DELETE /api/knowledge          — clear all
 *   DELETE /api/knowledge/{id}     — delete entry
 */

// ── Styles ──────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('knowledge-view-styles')) return;
  const style = document.createElement('style');
  style.id = 'knowledge-view-styles';
  style.textContent = `
    .kb-root { display:flex; flex-direction:column; gap:20px; }
    .kb-stats { display:flex; gap:12px; flex-wrap:wrap; }
    .kb-stat { background:var(--db-card-bg); border:1px solid var(--db-border); border-radius:var(--db-radius); padding:16px 20px; flex:1; min-width:140px; }
    .kb-stat-label { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--db-text-dim); margin-bottom:6px; }
    .kb-stat-value { font-size:24px; font-weight:700; }

    .kb-actions { display:flex; gap:10px; flex-wrap:wrap; }
    .kb-btn { padding:8px 16px; border-radius:8px; border:1px solid var(--db-border); background:var(--db-card-bg); color:var(--db-text); cursor:pointer; font-size:13px; transition:all .15s; display:flex; align-items:center; gap:6px; }
    .kb-btn:hover { border-color:var(--db-accent); background:rgba(99,102,241,.1); }
    .kb-btn-primary { background:var(--db-accent); color:#fff; border-color:var(--db-accent); }
    .kb-btn-primary:hover { filter:brightness(1.1); }
    .kb-btn-danger { color:#ef4444; border-color:rgba(239,68,68,.3); }
    .kb-btn-danger:hover { background:rgba(239,68,68,.1); }

    .kb-search-row { display:flex; gap:8px; }
    .kb-search-input { flex:1; padding:10px 14px; background:var(--db-card-bg); border:1px solid var(--db-border); border-radius:8px; color:var(--db-text); font-size:14px; outline:none; }
    .kb-search-input:focus { border-color:var(--db-accent); }

    .kb-entries { display:flex; flex-direction:column; gap:8px; }
    .kb-entry { background:var(--db-card-bg); border:1px solid var(--db-border); border-radius:var(--db-radius); padding:14px 18px; transition:border-color .15s; }
    .kb-entry:hover { border-color:rgba(255,255,255,.12); }
    .kb-entry-head { display:flex; justify-content:space-between; align-items:start; margin-bottom:8px; }
    .kb-entry-id { font-size:11px; color:var(--db-text-dim); font-family:monospace; }
    .kb-entry-meta { font-size:11px; color:var(--db-text-dim); display:flex; gap:10px; }
    .kb-entry-text { font-size:13px; line-height:1.6; color:var(--db-text); white-space:pre-wrap; word-break:break-word; }
    .kb-entry-actions { display:flex; gap:6px; margin-top:8px; }
    .kb-entry-del { font-size:11px; padding:3px 8px; border:1px solid rgba(239,68,68,.3); border-radius:6px; background:transparent; color:#ef4444; cursor:pointer; }
    .kb-entry-del:hover { background:rgba(239,68,68,.1); }

    .kb-empty { text-align:center; padding:40px; color:var(--db-text-dim); font-size:14px; }

    .kb-add-panel { background:var(--db-card-bg); border:1px solid var(--db-border); border-radius:var(--db-radius); padding:16px 20px; display:none; }
    .kb-add-panel.open { display:block; }
    .kb-add-textarea { width:100%; min-height:80px; padding:10px; background:rgba(0,0,0,.2); border:1px solid var(--db-border); border-radius:8px; color:var(--db-text); font-size:13px; font-family:inherit; resize:vertical; outline:none; box-sizing:border-box; }
    .kb-add-textarea:focus { border-color:var(--db-accent); }
    .kb-add-actions { display:flex; gap:8px; margin-top:10px; justify-content:flex-end; }

    .kb-upload-zone { border:2px dashed var(--db-border); border-radius:var(--db-radius); padding:30px; text-align:center; color:var(--db-text-dim); cursor:pointer; transition:all .2s; display:none; }
    .kb-upload-zone.open { display:block; }
    .kb-upload-zone:hover, .kb-upload-zone.dragover { border-color:var(--db-accent); background:rgba(99,102,241,.05); color:var(--db-text); }
    .kb-upload-zone input { display:none; }
  `;
  document.head.appendChild(style);
}

// ── Main render ─────────────────────────────────────────────────
export async function render(container) {
  injectStyles();

  container.innerHTML = `
    <div class="kb-root">
      <div class="kb-stats" id="kb-stats"></div>

      <div class="kb-actions">
        <button class="kb-btn kb-btn-primary" id="kb-add-btn">➕ Add Knowledge</button>
        <button class="kb-btn" id="kb-upload-btn">📄 Upload File</button>
        <button class="kb-btn kb-btn-danger" id="kb-clear-btn">🗑️ Clear All</button>
      </div>

      <div class="kb-add-panel" id="kb-add-panel">
        <textarea class="kb-add-textarea" id="kb-add-text" placeholder="Enter knowledge text…"></textarea>
        <div class="kb-add-actions">
          <button class="kb-btn" id="kb-add-cancel">Cancel</button>
          <button class="kb-btn kb-btn-primary" id="kb-add-save">Save</button>
        </div>
      </div>

      <div class="kb-upload-zone" id="kb-upload-zone">
        <div style="font-size:32px;margin-bottom:8px">📄</div>
        <div>Drop a file here or <strong>click to browse</strong></div>
        <div style="font-size:12px;margin-top:6px">Supports: TXT, CSV, JSON, Markdown, PDF (with SDK)</div>
        <input type="file" id="kb-file-input" accept=".txt,.csv,.json,.md,.pdf,.docx">
      </div>

      <div class="kb-search-row">
        <input class="kb-search-input" id="kb-search" type="text" placeholder="🔍 Search knowledge base…">
        <button class="kb-btn" id="kb-search-btn">Search</button>
      </div>

      <div id="kb-entries-label" style="font-size:13px;color:var(--db-text-dim);font-weight:600"></div>
      <div class="kb-entries" id="kb-entries"></div>
    </div>
  `;

  // Wire events
  document.getElementById('kb-add-btn').addEventListener('click', () => {
    document.getElementById('kb-add-panel').classList.toggle('open');
    document.getElementById('kb-upload-zone').classList.remove('open');
  });
  document.getElementById('kb-upload-btn').addEventListener('click', () => {
    document.getElementById('kb-upload-zone').classList.toggle('open');
    document.getElementById('kb-add-panel').classList.remove('open');
  });
  document.getElementById('kb-add-cancel').addEventListener('click', () => {
    document.getElementById('kb-add-panel').classList.remove('open');
  });
  document.getElementById('kb-add-save').addEventListener('click', addKnowledge);
  document.getElementById('kb-clear-btn').addEventListener('click', clearAll);
  document.getElementById('kb-search-btn').addEventListener('click', searchKnowledge);
  document.getElementById('kb-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchKnowledge();
  });

  // File upload
  const uploadZone = document.getElementById('kb-upload-zone');
  const fileInput = document.getElementById('kb-file-input');
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFile(fileInput.files[0]);
  });

  await loadStatus();
  await loadEntries();
}

// ── API functions ───────────────────────────────────────────────

async function loadStatus() {
  try {
    const res = await fetch('/api/knowledge/status');
    const data = await res.json();
    const el = document.getElementById('kb-stats');
    el.innerHTML = `
      <div class="kb-stat"><div class="kb-stat-label">Entries</div><div class="kb-stat-value">${data.total || 0}</div></div>
      <div class="kb-stat"><div class="kb-stat-label">Files</div><div class="kb-stat-value">${data.files || 0}</div></div>
      <div class="kb-stat"><div class="kb-stat-label">Backend</div><div class="kb-stat-value" style="font-size:14px">${data.backend || 'unknown'}</div></div>
      <div class="kb-stat"><div class="kb-stat-label">Status</div><div class="kb-stat-value" style="font-size:14px;color:${data.status === 'ok' ? '#22c55e' : '#eab308'}">${data.status || '?'}</div></div>
    `;
  } catch (e) {
    console.warn('[Knowledge] Status load failed:', e);
  }
}

async function loadEntries() {
  try {
    const res = await fetch('/api/knowledge');
    const data = await res.json();
    const entries = data.entries || [];
    const label = document.getElementById('kb-entries-label');
    label.textContent = `All entries (${entries.length})`;
    renderEntries(entries);
  } catch (e) {
    console.warn('[Knowledge] Entries load failed:', e);
  }
}

function renderEntries(entries) {
  const el = document.getElementById('kb-entries');
  if (entries.length === 0) {
    el.innerHTML = '<div class="kb-empty">No knowledge entries yet. Add text or upload a file to get started.</div>';
    return;
  }
  el.innerHTML = '';
  entries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'kb-entry';
    const meta = entry.metadata || {};
    const source = meta.source ? ` · source: ${meta.source}` : '';
    const filename = meta.filename ? ` · 📄 ${meta.filename}` : '';
    div.innerHTML = `
      <div class="kb-entry-head">
        <span class="kb-entry-id">${entry.id || '?'}</span>
        <div class="kb-entry-meta">
          ${entry.created_at ? '<span>' + new Date(entry.created_at * 1000).toLocaleString() + '</span>' : ''}
          <span>${source}${filename}</span>
        </div>
      </div>
      <div class="kb-entry-text">${escapeHtml(entry.text || '').substring(0, 500)}${(entry.text || '').length > 500 ? '…' : ''}</div>
      <div class="kb-entry-actions">
        <button class="kb-entry-del" data-id="${entry.id}">🗑️ Delete</button>
      </div>
    `;
    div.querySelector('.kb-entry-del').addEventListener('click', () => deleteEntry(entry.id));
    el.appendChild(div);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function addKnowledge() {
  const textarea = document.getElementById('kb-add-text');
  const text = textarea.value.trim();
  if (!text) return;
  try {
    await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    textarea.value = '';
    document.getElementById('kb-add-panel').classList.remove('open');
    await loadStatus();
    await loadEntries();
  } catch (e) {
    console.warn('[Knowledge] Add failed:', e);
  }
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('index_to_knowledge', 'true');
  try {
    const res = await fetch('/api/chat/attachments', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    document.getElementById('kb-upload-zone').classList.remove('open');
    if (data.knowledge_indexed) {
      await loadStatus();
      await loadEntries();
    } else {
      alert('File uploaded but could not be indexed: ' + (data.knowledge_error || 'Unknown error'));
    }
  } catch (e) {
    console.warn('[Knowledge] Upload failed:', e);
    alert('Upload failed: ' + e.message);
  }
}

async function searchKnowledge() {
  const query = document.getElementById('kb-search').value.trim();
  if (!query) { await loadEntries(); return; }
  try {
    const res = await fetch('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 20 }),
    });
    const data = await res.json();
    const results = data.results || [];
    const label = document.getElementById('kb-entries-label');
    label.textContent = `Search results for "${query}" (${results.length})`;
    renderEntries(results);
  } catch (e) {
    console.warn('[Knowledge] Search failed:', e);
  }
}

async function deleteEntry(id) {
  try {
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    await loadStatus();
    await loadEntries();
  } catch (e) {
    console.warn('[Knowledge] Delete failed:', e);
  }
}

async function clearAll() {
  if (!confirm('Clear ALL knowledge entries? This cannot be undone.')) return;
  try {
    await fetch('/api/knowledge', { method: 'DELETE' });
    await loadStatus();
    await loadEntries();
  } catch (e) {
    console.warn('[Knowledge] Clear failed:', e);
  }
}
