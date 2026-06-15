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

function cardElement(card, { selectable, selected, onSelect, onOpen }) {
  const wrap = el('div', {
    className: `aiui-board-card${selected ? ' aiui-board-card-selected' : ''}`,
    draggable: selectable ? 'true' : 'false',
    'data-task-id': card.id || '',
    'data-status': card.status || '',
  });
  const inner = el('div', { className: 'db-card' });
  if (card.title) inner.appendChild(el('div', { className: 'db-card-title', text: card.title }));
  if (card.value != null) inner.appendChild(el('div', { className: 'db-card-value', text: String(card.value) }));
  const footer = card.footer || card.assignee || '';
  if (footer) inner.appendChild(el('div', { className: 'db-card-footer', text: footer }));
  if (card.priority) {
    inner.appendChild(el('span', {
      className: 'aiui-board-badge',
      text: String(card.priority),
      style: 'font-size:10px;margin-left:6px;opacity:0.8',
    }));
  }
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
      if (taskId && opts.onDelete) await opts.onDelete(taskId);
    });
    wrap.appendChild(trash);
  }
  container.appendChild(wrap);
  return wrap;
}

function openTaskDrawer(card, { apiBase, onClose, onRefresh }) {
  const overlay = el('div', { className: 'aiui-board-drawer-overlay' });
  const drawer = el('div', { className: 'aiui-board-drawer' });
  const close = () => overlay.remove();
  drawer.appendChild(el('button', {
    className: 'aiui-board-drawer-close',
    text: '×',
    onclick: close,
  }));
  drawer.appendChild(el('h3', { text: card.title || 'Task' }));
  if (card.body) drawer.appendChild(el('pre', { className: 'aiui-board-drawer-body', text: card.body }));
  else drawer.appendChild(el('p', { className: 'aiui-board-drawer-meta', text: `ID: ${card.id || '—'}` }));
  const meta = el('div', { className: 'aiui-board-drawer-meta' });
  meta.textContent = [card.status, card.assignee, card.priority].filter(Boolean).join(' · ');
  drawer.appendChild(meta);

  if (apiBase && card.id) {
    const actions = el('div', { className: 'aiui-board-drawer-actions' });
    ['blocked', 'ready', 'done'].forEach((st) => {
      actions.appendChild(el('button', {
        className: 'db-btn db-btn-sm',
        text: st,
        onclick: async () => {
          await fetch(`${apiBase}/tasks/${card.id}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: st }),
          });
          if (onRefresh) await onRefresh();
          close();
          if (onClose) onClose();
        },
      }));
    });
    drawer.appendChild(actions);
  }

  overlay.appendChild(drawer);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

/**
 * Interactive board with DnD, bulk toolbar, drawer, optional SSE refresh.
 */
export function createInteractiveBoard(root, opts = {}) {
  let destroyed = false;
  let pollTimer = null;
  let eventSource = null;
  const selected = new Set();
  let lastData = null;

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
        onOpen: (card) => openTaskDrawer(card, { apiBase: opts.drawerApiBase || apiBase, onRefresh: refresh }),
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

  function connectEvents() {
    if (!opts.eventsUrl || typeof EventSource === 'undefined') return;
    const url = opts.eventsUrl + (opts.eventsUrl.includes('?') ? '&' : '?') + `board=${encodeURIComponent(opts.currentBoard || 'default')}`;
    try {
      eventSource = new EventSource(url);
      eventSource.onmessage = () => refresh();
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
      if (eventSource) eventSource.close();
      root.innerHTML = '';
    },
  };
}

/** Read-only polling board — backward-compatible with sdk.createBoard. */
export function createBoard(root, opts = {}) {
  return createInteractiveBoard(root, { ...opts, interactive: false, showTrash: false });
}

export { renderBoardDOM, el };
