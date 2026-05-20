/**
 * Video Studio dashboard plugin — YAML editor, lint, preview iframe, render jobs.
 */
(function () {
  'use strict';

  const pageId = 'video-studio';
  const LINT_DEBOUNCE_MS = 300;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  async function api(path, opts) {
    return window.aiui.sdk.fetchJSON(path, opts || {});
  }

  window.aiui.registerView(pageId, async (container) => {
    container.innerHTML = '';
    const root = el('div', { id: 'video-studio-root' });
    container.appendChild(root);

    let projects = [];
    let currentId = null;
    let lintTimer = null;
    let activeJobId = null;
    let jobPollTimer = null;
    let durationFrames = 90;
    let previewUrl = null;

    const bar = el('div', { className: 'vs-bar' });
    const projectSelect = el('select', { id: 'vs-project-select' });
    const btnNew = el('button', { text: 'New project' });
    const btnLint = el('button', { text: 'Lint' });
    const btnTest = el('button', { text: 'Visual test' });
    const btnPreview = el('button', { text: 'Start preview' });
    const btnRender = el('button', { text: 'Render MP4' });
    const pathLabel = el('span', { className: 'vs-hint', text: '' });
    bar.append(projectSelect, btnNew, btnLint, btnTest, btnPreview, btnRender, pathLabel);

    const main = el('div', { className: 'vs-main' });
    const editorCol = el('div', { className: 'vs-editor' });
    const textarea = el('textarea', { spellcheck: 'false' });
    const issuesList = el('ul', { className: 'vs-issues' });
    editorCol.append(textarea, issuesList);

    const previewCol = el('div', { className: 'vs-preview' });
    const iframe = el('iframe', { title: 'Scene preview', sandbox: 'allow-scripts allow-same-origin' });
    const transport = el('div', { className: 'vs-transport' });
    const frameLabel = el('span', { text: 'Frame 0 / 90' });
    const frameSlider = el('input', { type: 'range', min: '0', max: '89', value: '0' });
    transport.append(frameLabel, frameSlider);
    const previewHint = el('p', { className: 'vs-hint', text: 'Start preview to load the composition.' });
    previewCol.append(previewHint, iframe, transport);

    main.append(editorCol, previewCol);

    const jobsStrip = el('div', { className: 'vs-jobs', text: 'No render job yet.' });
    root.append(bar, main, jobsStrip);

    async function loadProjects() {
      const data = await api('/api/video/projects');
      projects = data.projects || [];
      projectSelect.innerHTML = '';
      const placeholder = el('option', { value: '', text: '— Select project —' });
      projectSelect.append(placeholder);
      projects.forEach((p) => {
        projectSelect.append(el('option', { value: p.id, text: p.name || p.id }));
      });
    }

    async function openProject(id) {
      if (!id) return;
      currentId = id;
      const data = await api('/api/video/projects/' + encodeURIComponent(id));
      textarea.value = data.sceneYaml || '';
      pathLabel.textContent = data.path || '';
      await runLint();
      await loadPreviewUrl();
      try {
        const compiled = await api('/api/video/compile', {
          method: 'POST',
          body: JSON.stringify({ projectId: id }),
        });
        if (compiled.ir && compiled.ir.videoConfig) {
          durationFrames = compiled.ir.videoConfig.durationInFrames || 90;
          frameSlider.max = String(Math.max(0, durationFrames - 1));
          frameLabel.textContent = 'Frame 0 / ' + durationFrames;
        }
      } catch (_) {
        /* compile may fail if engine down */
      }
    }

    async function runLint() {
      if (!currentId) return;
      try {
        const data = await api('/api/video/lint', {
          method: 'POST',
          body: JSON.stringify({ projectId: currentId }),
        });
        issuesList.innerHTML = '';
        (data.issues || []).forEach((issue) => {
          issuesList.append(
            el('li', {
              text: (issue.severity || 'error') + ': ' + (issue.path || '') + ' — ' + (issue.message || ''),
            })
          );
        });
        if (!(data.issues || []).length) {
          issuesList.append(el('li', { text: 'No issues.', style: 'color:#86efac;list-style:none' }));
        }
      } catch (err) {
        issuesList.innerHTML = '';
        issuesList.append(el('li', { text: String(err.message || err) }));
      }
    }

    function scheduleLint() {
      clearTimeout(lintTimer);
      lintTimer = setTimeout(runLint, LINT_DEBOUNCE_MS);
    }

    async function saveScene() {
      if (!currentId) return;
      await api('/api/video/projects/' + encodeURIComponent(currentId) + '/scene', {
        method: 'PUT',
        body: JSON.stringify({ yaml: textarea.value }),
      });
    }

    async function loadPreviewUrl() {
      if (!currentId) return;
      const data = await api('/api/video/preview-url?projectId=' + encodeURIComponent(currentId));
      previewUrl = data.url;
      if (previewUrl) {
        iframe.src = previewUrl;
        previewHint.textContent = '';
      } else {
        iframe.removeAttribute('src');
        previewHint.textContent = data.message || 'Start preview to load the composition.';
      }
    }

    function seekFrame(n) {
      frameLabel.textContent = 'Frame ' + n + ' / ' + durationFrames;
      if (!iframe.contentWindow) return;
      try {
        iframe.contentWindow.postMessage({ type: 'pav-seek', frame: n }, '*');
      } catch (_) {
        /* cross-origin until preview same host */
      }
      try {
        if (iframe.contentWindow.__pavSeek) {
          iframe.contentWindow.__pavSeek(n);
        }
      } catch (_) {
        /* ignore */
      }
    }

    frameSlider.addEventListener('input', () => {
      seekFrame(Number(frameSlider.value));
    });

    textarea.addEventListener('input', () => {
      scheduleLint();
      saveScene().catch(() => {});
    });

    projectSelect.addEventListener('change', () => {
      openProject(projectSelect.value).catch((e) => alert(e.message || e));
    });

    btnNew.addEventListener('click', async () => {
      const name = prompt('Project name', 'My video') || 'My video';
      const created = await api('/api/video/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await loadProjects();
      projectSelect.value = created.id;
      await openProject(created.id);
    });

    btnLint.addEventListener('click', () => runLint());
    btnTest.addEventListener('click', async () => {
      if (!currentId) return alert('Select a project first.');
      btnTest.disabled = true;
      try {
        const result = await api('/api/video/test', {
          method: 'POST',
          body: JSON.stringify({ projectId: currentId }),
        });
        alert(result.passed ? 'Visual test passed.' : 'Visual test failed.\n' + (result.output || ''));
      } finally {
        btnTest.disabled = false;
      }
    });

    btnPreview.addEventListener('click', async () => {
      if (!currentId) return alert('Select a project first.');
      const data = await api('/api/video/preview/start', {
        method: 'POST',
        body: JSON.stringify({ projectId: currentId }),
      });
      if (data.url) {
        previewUrl = data.url;
        iframe.src = data.url;
        previewHint.textContent = '';
      } else {
        alert(data.message || 'Could not start preview.');
      }
    });

    async function pollJob(jobId) {
      const data = await api('/api/video/jobs/' + encodeURIComponent(jobId));
      const prog = data.progress;
      const progText = prog ? ' (' + prog.frame + '/' + prog.totalFrames + ')' : '';
      jobsStrip.textContent = 'Job ' + jobId + ': ' + data.status + progText;
      if (data.status === 'running' || data.status === 'queued') {
        btnRender.disabled = true;
        return;
      }
      clearInterval(jobPollTimer);
      jobPollTimer = null;
      btnRender.disabled = false;
      if (data.status === 'succeeded' && data.downloadUrl) {
        jobsStrip.innerHTML = '';
        jobsStrip.append(
          'Render complete. ',
          el('a', { href: data.downloadUrl, text: 'Download MP4' })
        );
      } else if (data.error) {
        jobsStrip.textContent = 'Render failed: ' + data.error;
      }
    }

    btnRender.addEventListener('click', async () => {
      if (!currentId) return alert('Select a project first.');
      await saveScene();
      btnRender.disabled = true;
      const data = await api('/api/video/render', {
        method: 'POST',
        body: JSON.stringify({ projectId: currentId }),
      });
      activeJobId = data.jobId;
      jobsStrip.textContent = 'Render queued…';
      jobPollTimer = setInterval(() => pollJob(activeJobId), 1500);
      pollJob(activeJobId);
    });

    await loadProjects();
    const health = await api('/api/video/health').catch(() => ({}));
    if (health.engine && health.engine.status === 'unavailable') {
      pathLabel.textContent =
        'Video engine not running. Start with: praisonai-video serve';
    }

    return () => {
      clearTimeout(lintTimer);
      clearInterval(jobPollTimer);
    };
  });
})();
