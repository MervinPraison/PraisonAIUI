/**
 * Interactive kanban board engine — DRY composable layer for PraisonAIUI.
 *
 * Used by built-in views (kanban, jobs-board) and dashboard-plugins/kanban.
 * Reuses existing card/column CSS classes from dashboard.js (.aiui-board-*).
 */

const STATUS_COLOURS = {
  triage: '#71717a',
  todo: '#3b82f6',
  ready: '#8b5cf6',
  running: '#f59e0b',
  blocked: '#ef4444',
  review: '#06b6d4',
  done: '#22c55e',
  queued: '#3b82f6',
  succeeded: '#22c55e',
  failed: '#ef4444',
  cancelled: '#71717a',
};

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) node.setAttribute(k, v);
    });
  }
  (children || []).forEach((c) => {
    if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

function relativeTime(value) {
  if (!value) return '';
  const then = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!then || Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text) {
  const safe = escapeHtml(text);
  const lines = safe.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let listOpen = false;
  const closeList = () => { if (listOpen) { html.push('</ul>'); listOpen = false; } };
  lines.forEach((raw) => {
    if (/^```/.test(raw.trim())) {
      if (inCode) { html.push('</code></pre>'); inCode = false; }
      else { closeList(); html.push('<pre><code>'); inCode = true; }
      return;
    }
    if (inCode) { html.push(raw + '\n'); return; }
    let line = raw;
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
    line = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { closeList(); html.push(`<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`); return; }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) { if (!listOpen) { html.push('<ul>'); listOpen = true; } html.push(`<li>${bullet[1]}</li>`); return; }
    closeList();
    if (line.trim() === '') html.push('<br/>');
    else html.push(`<p>${line}</p>`);
  });
  closeList();
  if (inCode) html.push('</code></pre>');
  return html.join('');
}

function cardElement(card, { selectable, selected, onSelect, onOpen }) {
  const wrap = el('div', {
    className: `aiui-board-card${selected ? ' aiui-board-card-selected' : ''}`,
    draggable: selectable ? 'true' : 'false',
    'data-task-id': card.id || '',
    'data-status': card.status || '',
  });
  const inner = el('div', { className: 'db-card aiui-board-card-dense' });

  const head = el('div', { className: 'aiui-board-card-head' });
  if (selectable && onSelect) {
    const box = el('input', {
      type: 'checkbox',
      className: 'aiui-board-card-check',
      'aria-label': 'Select task',
    });
    box.checked = !!selected;
    box.addEventListener('click', (e) => { e.stopPropagation(); onSelect(card.id, true); });
    head.appendChild(box);
  }
  if (card.id) head.appendChild(el('span', { className: 'aiui-board-card-id', text: card.id }));
  const colour = STATUS_COLOURS[card.status];
  if (card.status) {
    const dot = el('span', { className: 'aiui-board-status-dot', text: '●', title: card.status });
    if (colour) dot.style.color = colour;
    head.appendChild(dot);
  }
  if (card.priority) {
    head.appendChild(el('span', { className: 'aiui-board-badge aiui-board-priority', text: String(card.priority) }));
  }
  inner.appendChild(head);

  if (card.title) inner.appendChild(el('div', { className: 'db-card-title aiui-board-card-name', text: card.title }));
  if (card.value != null) inner.appendChild(el('div', { className: 'db-card-value', text: String(card.value) }));

  const foot = el('div', { className: 'aiui-board-card-foot' });
  if (card.tenant) foot.appendChild(el('span', { className: 'aiui-board-chip aiui-board-tenant', text: String(card.tenant) }));
  if (card.assignee) foot.appendChild(el('span', { className: 'aiui-board-chip', text: String(card.assignee) }));
  const age = relativeTime(card.created_at);
  if (age) foot.appendChild(el('span', { className: 'aiui-board-card-age', text: age }));
  if (card.comment_count) foot.appendChild(el('span', { className: 'aiui-board-card-count', text: `\uD83D\uDCAC ${card.comment_count}` }));
  if (card.progress && card.progress.total) {
    foot.appendChild(el('span', {
      className: 'aiui-board-progress',
      text: `${card.progress.done}/${card.progress.total}`,
    }));
  }
  if (foot.childNodes.length) inner.appendChild(foot);

  wrap.appendChild(inner);
  wrap.addEventListener('click', (e) => {
    if (e.shiftKey && onSelect) onSelect(card.id, true);
    else if (onOpen) onOpen(card);
  });
  if (selectable) {
    wrap.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.id || '');
      e.dataTransfer.effectAllowed = 'move';
      wrap.classList.add('aiui-board-dragging');
    });
    wrap.addEventListener('dragend', () => wrap.classList.remove('aiui-board-dragging'));
  }
  return wrap;
}

function columnElement(col, cards, opts) {
  const colEl = el('div', {
    className: 'aiui-board-column',
    'data-column-id': col.id,
  });
  const dot = STATUS_COLOURS[col.id] ? `color:${STATUS_COLOURS[col.id]}` : '';
  const title = el('div', { className: 'aiui-board-column-title' });
  title.innerHTML = `<span style="${dot}">●</span> ${col.title || col.id} (${cards.length})`;
  colEl.appendChild(title);

  const cardsWrap = el('div', { className: 'aiui-board-column-cards' });
  if (opts.laneByProfile && col.id === 'running') {
    const lanes = {};
    cards.forEach((c) => {
      const lane = c.assignee || c.meta?.assignee || 'unassigned';
      (lanes[lane] ||= []).push(c);
    });
    Object.entries(lanes).forEach(([lane, laneCards]) => {
      const laneEl = el('div', { className: 'aiui-board-lane' });
      laneEl.appendChild(el('div', { className: 'aiui-board-lane-title', text: lane }));
      const laneCardsWrap = el('div', { className: 'aiui-board-column-cards' });
      laneCards.forEach((c) => laneCardsWrap.appendChild(
        cardElement(c, {
          selectable: opts.interactive,
          selected: opts.selected?.has(c.id),
          onSelect: opts.onSelect,
          onOpen: opts.onOpen,
        }),
      ));
      laneEl.appendChild(laneCardsWrap);
      cardsWrap.appendChild(laneEl);
    });
  } else {
    cards.forEach((c) => cardsWrap.appendChild(
      cardElement(c, {
        selectable: opts.interactive,
        selected: opts.selected?.has(c.id),
        onSelect: opts.onSelect,
        onOpen: opts.onOpen,
      }),
    ));
  }

  if (opts.interactive) {
    cardsWrap.addEventListener('dragover', (e) => { e.preventDefault(); cardsWrap.classList.add('aiui-board-drop-target'); });
    cardsWrap.addEventListener('dragleave', () => cardsWrap.classList.remove('aiui-board-drop-target'));
    cardsWrap.addEventListener('drop', async (e) => {
      e.preventDefault();
      cardsWrap.classList.remove('aiui-board-drop-target');
      const taskId = e.dataTransfer.getData('text/plain');
      if (taskId && opts.onMove) await opts.onMove(taskId, col.id);
    });
  }

  colEl.appendChild(cardsWrap);
  return colEl;
}

function renderBoardDOM(container, data, opts) {
  container.innerHTML = '';
  const wrap = el('div', { className: 'aiui-board' });
  const row = el('div', { className: 'aiui-board-columns' });
  (data.columns || []).forEach((col) => {
    row.appendChild(columnElement(col, col.cards || [], opts));
  });
  wrap.appendChild(row);

  if (opts.showTrash && opts.interactive) {
    const trash = el('div', {
      className: 'aiui-board-trash',
      text: '🗑 Drop to delete',
    });
    trash.addEventListener('dragover', (e) => { e.preventDefault(); trash.classList.add('aiui-board-drop-target'); });
    trash.addEventListener('dragleave', () => trash.classList.remove('aiui-board-drop-target'));
    trash.addEventListener('drop', async (e) => {
      e.preventDefault();
      trash.classList.remove('aiui-board-drop-target');
      const taskId = e.dataTransfer.getData('text/plain');
      if (!taskId || !opts.onDelete) return;
      if (typeof confirm === 'function' && !confirm('Permanently delete this task?')) return;
      await opts.onDelete(taskId);
    });
    wrap.appendChild(trash);
  }
  container.appendChild(wrap);
  return wrap;
}

function historyRows(card) {
  const meta = card.meta || {};
  const rows = [];
  const events = meta.events || meta.history;
  if (Array.isArray(events)) {
    events.forEach((ev) => {
      if (typeof ev === 'string') rows.push({ text: ev });
      else if (ev && typeof ev === 'object') {
        const label = ev.type || ev.event || ev.status || 'event';
        const when = relativeTime(ev.ts || ev.created_at || ev.time);
        rows.push({ text: ev.text || ev.message || label, when });
      }
    });
  }
  return rows;
}

function openTaskDrawer(card, { apiBase, onClose, onRefresh, fetchTask }) {
  const overlay = el('div', { className: 'aiui-board-drawer-overlay' });
  const drawer = el('div', { className: 'aiui-board-drawer' });
  let current = card;
  let closed = false;
  const close = () => { closed = true; overlay.remove(); if (onClose) onClose(); };

  const editable = !!(apiBase && card.id);

  async function patch(data) {
    if (!editable) return;
    await fetch(`${apiBase}/tasks/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (onRefresh) await onRefresh();
    await reload();
  }

  async function reload() {
    if (closed) return;
    if (fetchTask && current.id) {
      try {
        const fresh = await fetchTask(current.id);
        if (fresh) current = { ...current, ...fresh };
      } catch (_) { /* keep stale */ }
    }
    render();
  }

  function field(label, value, onSave) {
    const row = el('div', { className: 'aiui-board-drawer-field' });
    row.appendChild(el('label', { className: 'aiui-board-drawer-label', text: label }));
    const input = el('input', { className: 'aiui-board-drawer-input', value: value == null ? '' : String(value) });
    if (!editable) input.disabled = true;
    input.addEventListener('change', () => onSave(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(input.value); } });
    row.appendChild(input);
    return row;
  }

  function render() {
    drawer.innerHTML = '';
    drawer.appendChild(el('button', { className: 'aiui-board-drawer-close', text: '×', onclick: close }));

    drawer.appendChild(field('Title', current.title, (v) => patch({ title: v })));

    if (current.body != null) {
      const bodyEl = el('div', { className: 'aiui-board-drawer-body aiui-board-markdown' });
      bodyEl.innerHTML = renderMarkdown(current.body);
      drawer.appendChild(bodyEl);
    }

    const grid = el('div', { className: 'aiui-board-drawer-grid' });
    grid.appendChild(field('Assignee', current.assignee, (v) => patch({ assignee: v })));
    grid.appendChild(field('Priority', current.priority, (v) => patch({ priority: v })));
    drawer.appendChild(grid);

    const meta = el('div', { className: 'aiui-board-drawer-meta' });
    meta.textContent = [current.status, current.tenant, relativeTime(current.created_at)].filter(Boolean).join(' · ');
    drawer.appendChild(meta);

    const hist = historyRows(current);
    if (hist.length) {
      drawer.appendChild(el('h4', { className: 'aiui-board-drawer-h', text: 'History' }));
      const histWrap = el('div', { className: 'aiui-board-history' });
      hist.forEach((r) => {
        const row = el('div', { className: 'aiui-board-history-row' });
        row.appendChild(el('span', { className: 'aiui-board-history-text', text: r.text }));
        if (r.when) row.appendChild(el('span', { className: 'aiui-board-history-when', text: r.when }));
        histWrap.appendChild(row);
      });
      drawer.appendChild(histWrap);
    }

    drawer.appendChild(el('h4', { className: 'aiui-board-drawer-h', text: 'Comments' }));
    const thread = el('div', { className: 'aiui-board-comments' });
    (current.comments || []).forEach((c) => {
      const item = el('div', { className: 'aiui-board-comment' });
      const head = el('div', { className: 'aiui-board-comment-head' });
      head.appendChild(el('span', { className: 'aiui-board-comment-author', text: c.author || 'human' }));
      const when = relativeTime(c.created_at);
      if (when) head.appendChild(el('span', { className: 'aiui-board-comment-when', text: when }));
      item.appendChild(head);
      const text = el('div', { className: 'aiui-board-comment-text aiui-board-markdown' });
      text.innerHTML = renderMarkdown(typeof c === 'string' ? c : (c.text || ''));
      item.appendChild(text);
      thread.appendChild(item);
    });
    drawer.appendChild(thread);

    if (editable) {
      const box = el('textarea', {
        className: 'aiui-board-comment-input',
        placeholder: 'Add a comment… (Enter to submit, Shift+Enter for newline)',
        rows: '2',
      });
      const submit = async () => {
        const value = box.value.trim();
        if (!value) return;
        box.value = '';
        await fetch(`${apiBase}/tasks/${current.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: value }),
        });
        if (onRefresh) await onRefresh();
        await reload();
      };
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      });
      drawer.appendChild(box);

      const actions = el('div', { className: 'aiui-board-drawer-actions' });
      ['blocked', 'ready', 'done'].forEach((st) => {
        actions.appendChild(el('button', {
          className: 'db-btn db-btn-sm',
          text: st,
          onclick: async () => {
            if ((st === 'done' || st === 'blocked') && !confirm(`Move task to "${st}"?`)) return;
            await fetch(`${apiBase}/tasks/${current.id}/move`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: st }),
            });
            if (onRefresh) await onRefresh();
            close();
          },
        }));
      });
      drawer.appendChild(actions);
    }
  }

  render();
  overlay.appendChild(drawer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  return {
    id: card.id,
    isOpen: () => !closed,
    refresh: reload,
    close,
  };
}

/**
 * Interactive board with DnD, bulk toolbar, drawer, optional SSE refresh.
 */
export function createInteractiveBoard(root, opts = {}) {
  let destroyed = false;
  let pollTimer = null;
  let eventSource = null;
  let debounceTimer = null;
  let openDrawer = null;
  const selected = new Set();
  let lastData = null;
  const debounceMs = opts.debounceMs != null ? opts.debounceMs : 300;

  const toolbar = el('div', { className: 'aiui-board-toolbar' });
  root.appendChild(toolbar);

  const boardHost = el('div', { className: 'aiui-board-host' });
  root.appendChild(boardHost);

  const apiBase = (opts.apiBase || '/api/kanban').replace(/\/$/, '');

  async function defaultMove(taskId, toStatus) {
    const res = await fetch(`${apiBase}/tasks/${taskId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: toStatus }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function defaultDelete(taskId) {
    const res = await fetch(`${apiBase}/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
  }

  const drawerApiBase = (opts.drawerApiBase || apiBase).replace(/\/$/, '');

  async function fetchTask(taskId) {
    const res = await fetch(`${drawerApiBase}/tasks/${taskId}`);
    if (!res.ok) return null;
    return res.json();
  }

  async function defaultBulk(status) {
    if (!selected.size) return;
    const res = await fetch(`${apiBase}/tasks/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: [...selected], status }),
    });
    if (!res.ok) throw new Error(await res.text());
    selected.clear();
    updateToolbar();
  }

  function updateToolbar() {
    toolbar.innerHTML = '';
    if (!opts.interactive) return;
    if (selected.size) {
      toolbar.appendChild(el('span', { text: `${selected.size} selected`, className: 'aiui-board-toolbar-label' }));
      ['ready', 'done', 'archived'].forEach((st) => {
        toolbar.appendChild(el('button', {
          className: 'db-btn db-btn-sm',
          text: `Move → ${st}`,
          onclick: async () => { try { await defaultBulk(st); await refresh(); } catch (e) { alert(e.message); } },
        }));
      });
      toolbar.appendChild(el('button', {
        className: 'db-btn db-btn-sm',
        text: 'Clear',
        onclick: () => { selected.clear(); updateToolbar(); refresh(); },
      }));
    }
    if (opts.boardSwitcher && lastData?.boards) {
      const sel = el('select', { className: 'aiui-board-board-select' });
      const activeBoard = opts.boardState?.id || opts.currentBoard || 'default';
      (lastData.boards || []).forEach((b) => {
        const opt = el('option', { value: b.id, text: b.title || b.id });
        if (b.id === activeBoard) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        if (opts.boardState) opts.boardState.id = sel.value;
        else opts.currentBoard = sel.value;
        refresh();
      });
      toolbar.appendChild(sel);
    }
  }

  function onSelect(taskId, shift) {
    if (!taskId) return;
    if (shift) {
      if (selected.has(taskId)) selected.delete(taskId);
      else selected.add(taskId);
    } else {
      selected.clear();
      selected.add(taskId);
    }
    updateToolbar();
    refresh();
  }

  async function refresh() {
    if (destroyed || !opts.fetch) return;
    try {
      const data = await opts.fetch();
      lastData = data;
      boardHost.innerHTML = '';
      renderBoardDOM(boardHost, data, {
        interactive: opts.interactive !== false,
        laneByProfile: !!opts.laneByProfile,
        showTrash: opts.showTrash !== false,
        selected,
        onSelect: opts.interactive !== false ? onSelect : null,
        onOpen: (card) => {
          if (openDrawer && openDrawer.isOpen()) openDrawer.close();
          openDrawer = openTaskDrawer(card, {
            apiBase: drawerApiBase,
            onRefresh: refresh,
            fetchTask,
            onClose: () => { openDrawer = null; },
          });
        },
        onMove: async (taskId, status) => {
          await (opts.onMove || defaultMove)(taskId, status);
          await refresh();
        },
        onDelete: async (taskId) => {
          await (opts.onDelete || defaultDelete)(taskId);
          await refresh();
        },
      });
      updateToolbar();
    } catch (e) {
      boardHost.innerHTML = `<div class="db-alert db-alert-error">${e.message}</div>`;
    }
  }

  function debouncedRefresh() {
    if (!debounceMs) { refresh(); return; }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; refresh(); }, debounceMs);
  }

  function handleEvent(raw) {
    let ev = null;
    try { ev = raw ? JSON.parse(raw) : null; } catch (_) { ev = null; }
    if (openDrawer && openDrawer.isOpen() && ev && ev.task_id && ev.task_id === openDrawer.id) {
      openDrawer.refresh();
    }
    debouncedRefresh();
  }

  function connectEvents() {
    if (!opts.eventsUrl || typeof EventSource === 'undefined') return;
    const activeBoard = opts.boardState?.id || opts.currentBoard || 'default';
    const url = opts.eventsUrl + (opts.eventsUrl.includes('?') ? '&' : '?') + `board=${encodeURIComponent(activeBoard)}`;
    try {
      eventSource = new EventSource(url);
      eventSource.onmessage = (e) => handleEvent(e && e.data);
    } catch (_) { /* polling fallback */ }
  }

  refresh();
  if (opts.pollMs) pollTimer = setInterval(refresh, opts.pollMs);
  connectEvents();

  return {
    refresh,
    destroy() {
      destroyed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (eventSource) eventSource.close();
      if (openDrawer && openDrawer.isOpen()) openDrawer.close();
      root.innerHTML = '';
    },
  };
}

/** Read-only polling board — backward-compatible with sdk.createBoard. */
export function createBoard(root, opts = {}) {
  return createInteractiveBoard(root, { ...opts, interactive: false, showTrash: false });
}

export { renderBoardDOM, el, renderMarkdown, relativeTime, escapeHtml };
