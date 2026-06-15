/**
 * Kanban dashboard plugin — registers view using shared board.js engine.
 */
(function () {
  'use strict';

  window.aiui.registerView('kanban', async function (container) {
    const mod = await import('/plugins/views/kanban.js');
    const cleanup = await mod.render(container);
    return cleanup;
  });
})();
