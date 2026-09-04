/**
 * Meeting Agent dashboard hooks — auto-refresh live transcript on meeting-detail.
 */
(function () {
  'use strict';

  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function refreshLiveTranscript() {
    const host = document.querySelector('[data-page="meeting-detail"]');
    if (!host) return;

    const code = host.querySelector('.db-code-block code');
    if (!code) return;

    try {
      const meetingsRes = await fetch('/api/meetings');
      if (!meetingsRes.ok) return;
      const meetingsJson = await meetingsRes.json();
      const meetings = meetingsJson.meetings || [];
      const live = meetings.find((m) =>
        ['live', 'joining', 'waiting_room'].includes(String(m.live_status || '').toLowerCase())
      );
      if (!live || !live.id) return;

      const snapRes = await fetch(`/api/meetings/${live.id}/live-transcript`);
      if (!snapRes.ok) return;
      const snap = await snapRes.json();
      const text = snap.transcript || '(empty)';
      if (code.textContent !== text) {
        code.textContent = text;
      }
    } catch (_err) {
      /* ignore transient network errors */
    }
  }

  function startPolling() {
    stopPolling();
    refreshLiveTranscript();
    pollTimer = setInterval(refreshLiveTranscript, 3000);
  }

  window.addEventListener('aiui:page-change', (event) => {
    stopPolling();
    if (event.detail && event.detail.pageId === 'meeting-detail') {
      startPolling();
    }
  });
})();
