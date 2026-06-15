/**
 * Jobs board view — read-only columns from /api/jobs/board.
 */
import { createInteractiveBoard } from '../board.js';

export async function render(container) {
  container.setAttribute('data-page', 'jobs-board');
  container.classList.add('jobs-board-page');
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'aiui-board-page-header';
  header.innerHTML = '<h2 style="margin:0 0 12px">Jobs Board</h2><p class="db-text-dim" style="font-size:13px;margin:0 0 12px">Async agent jobs by status (read-only)</p>';
  container.appendChild(header);

  const root = document.createElement('div');
  container.appendChild(root);

  const board = createInteractiveBoard(root, {
    pollMs: 5000,
    interactive: false,
    showTrash: false,
    fetch: async () => {
      const res = await fetch('/api/jobs/board');
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  return () => board.destroy();
}
