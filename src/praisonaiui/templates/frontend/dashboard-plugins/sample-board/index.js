/**
 * Sample dashboard plugin — registers a page view with a static board.
 */
(function () {
  'use strict';
  const pageId = 'sample-board';

  window.aiui.registerView(pageId, async (container) => {
    container.innerHTML = '';
    const board = window.aiui.sdk.createBoard(container, {
      fetch: async () => ({
        columns: [
          {
            id: 'todo',
            title: 'Todo',
            cards: [
              { title: 'Demo task', footer: 'agent-a', badge: 'new' },
            ],
          },
          {
            id: 'done',
            title: 'Done',
            cards: [
              { title: 'Ship modular shell', footer: 'you' },
            ],
          },
        ],
      }),
    });
    return () => board.destroy();
  });
})();
