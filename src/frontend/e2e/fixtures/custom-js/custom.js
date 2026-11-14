// set_custom_js() fixture for the app-shell e2e server (mock_server.py --custom-js).
// 'client-view' also has a server handler (a blocks fallback); a client view
// registered here must win over it, as in the legacy dashboard.
window.aiui = window.aiui || {};
window.aiui.registerView('client-view', function (container) {
  const box = document.createElement('div');
  box.setAttribute('data-testid', 'client-view');
  box.textContent = 'Rendered by custom.js registerView';
  container.appendChild(box);
});
