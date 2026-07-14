/**
 * Kanban view — full interactive board backed by /api/kanban.
 */
import { createInteractiveBoard } from '../board.js';

export async function render(container) {
  container.setAttribute('data-page', 'kanban');
  container.classList.add('kanban-page');
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'aiui-board-page-header';
  header.innerHTML = '<h2 style="margin:0 0 12px">Kanban</h2>'
    + '<div style="margin:0 0 12px;padding:8px 12px;border:1px solid rgba(99,102,241,.3);'
    + 'border-radius:8px;background:rgba(99,102,241,.06);font-size:13px">'
    + 'Try the new <a href="/work" style="color:var(--db-accent,#6366f1);font-weight:600">Work Hub</a>'
    + ' — kanban, card detail, chat and job logs on one screen.</div>';
  container.appendChild(header);

  const root = document.createElement('div');
  root.className = 'aiui-board-page-root';
  container.appendChild(root);

  const boardState = { id: 'default' };

  const board = createInteractiveBoard(root, {
    apiBase: '/api/kanban',
    eventsUrl: '/api/kanban/events',
    pollMs: 8000,
    interactive: true,
    laneByProfile: true,
    showTrash: true,
    boardSwitcher: true,
    boardState,
    fetch: async () => {
      const [boardRes, boardsRes] = await Promise.all([
        fetch(`/api/kanban/board?board=${encodeURIComponent(boardState.id)}`),
        fetch('/api/kanban/boards'),
      ]);
      if (!boardRes.ok) throw new Error(await boardRes.text());
      const data = await boardRes.json();
      if (boardsRes.ok) {
        const b = await boardsRes.json();
        data.boards = b.boards || [{ id: 'default', title: 'Default' }];
      }
      return data;
    },
  });

  return () => board.destroy();
}
