/**
 * Video Studio dashboard plugin — YAML editor, lint, render jobs, MP4 player.
 */
(function () {
  'use strict';

  const pageId = 'video-studio';
  const LINT_DEBOUNCE_MS = 300;
  const SHOW_COMPOSITION_PREVIEW = false;
  const REFRESH_POLL_MS = 3000;

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
    let saveTimer = null;
    let activeJobId = null;
    let jobPollTimer = null;
    let refreshPollTimer = null;

    const bar = el('div', { className: 'vs-bar' });
    const projectSelect = el('select', { id: 'vs-project-select' });
    const btnNew = el('button', { text: 'New project' });
    const btnLint = el('button', { text: 'Lint' });
    const btnTest = el('button', { text: 'Visual test' });
    const btnRender = el('button', { text: 'Render MP4' });
    const btnReset = el('button', { text: 'Reset scene' });
    const pathLabel = el('span', { className: 'vs-hint', text: '' });
    const barChildren = [projectSelect, btnNew, btnLint, btnTest, btnRender, btnReset, pathLabel];

    let btnPreview = null;
    let compositionDetails = null;
    let iframe = null;
    let frameSlider = null;
    let frameLabel = null;
    let previewHint = null;
    let durationFrames = 90;
    let previewUrl = null;

    if (SHOW_COMPOSITION_PREVIEW) {
      btnPreview = el('button', { text: 'Start preview' });
      barChildren.splice(4, 0, btnPreview);
    }
    barChildren.forEach(function (c) {
      bar.append(c);
    });

    const main = el('div', { className: 'vs-main' });
    const editorCol = el('div', { className: 'vs-editor' });
    const textarea = el('textarea', { spellcheck: 'false' });
    const issuesList = el('ul', { className: 'vs-issues' });
    editorCol.append(textarea, issuesList);

    const previewCol = el('div', { className: 'vs-preview' });
    previewCol.append(el('p', { className: 'vs-section-label', text: 'Your video' }));
    const outputHint = el('p', {
      className: 'vs-hint',
      text: 'Render MP4 to generate a video. It will appear here with playback controls.',
    });
    const outputWrap = el('div', { className: 'vs-output-wrap' });
    const videoEl = el('video', {
      className: 'vs-output-video',
      controls: 'controls',
      playsinline: 'playsinline',
      preload: 'metadata',
    });
    videoEl.setAttribute('controls', '');
    const outputActions = el('div', { className: 'vs-output-actions' });
    const btnPlay = el('button', { type: 'button', text: 'Play' });
    const btnDownload = el('a', { className: 'vs-download-link', text: 'Download' });
    btnDownload.style.display = 'none';
    outputActions.append(btnPlay, btnDownload);
    outputWrap.append(videoEl, outputActions);
    previewCol.append(outputHint, outputWrap);

    if (SHOW_COMPOSITION_PREVIEW) {
      compositionDetails = el('details', { className: 'vs-composition-details' });
      const compositionSummary = el('summary', {
        text: 'Optional: frame-by-frame preview (while editing YAML)',
      });
      previewHint = el('p', {
        className: 'vs-hint',
        text: 'Not the final MP4. Click Start preview in the toolbar (video engine must be running). First load may take ~30s.',
      });
      iframe = el('iframe', { title: 'Scene preview', sandbox: 'allow-scripts allow-same-origin' });
      const transport = el('div', { className: 'vs-transport' });
      frameLabel = el('span', { text: 'Frame 45 / 90' });
      frameSlider = el('input', { type: 'range', min: '0', max: '89', value: '45' });
      transport.append(frameLabel, frameSlider);
      compositionDetails.append(compositionSummary, previewHint, iframe, transport);
      previewCol.append(compositionDetails);
    }

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

    async function openProject(id, opts) {
      if (!id) return;
      const reloadYaml = !opts || opts.reloadYaml !== false;
      currentId = id;
      const data = await api('/api/video/projects/' + encodeURIComponent(id));
      if (reloadYaml) textarea.value = data.sceneYaml || '';
      pathLabel.textContent = data.path || '';
      await runLint();
      await loadRenderedMp4();
      if (SHOW_COMPOSITION_PREVIEW) {
        try {
          const compiled = await api('/api/video/compile', {
            method: 'POST',
            body: JSON.stringify({ projectId: id }),
          });
          if (compiled.ir && compiled.ir.videoConfig) {
            durationFrames = compiled.ir.videoConfig.durationInFrames || 90;
            frameSlider.max = String(Math.max(0, durationFrames - 1));
            const start = defaultPreviewFrame();
            frameSlider.value = String(start);
            frameLabel.textContent = 'Frame ' + start + ' / ' + durationFrames;
          }
        } catch (_) {
          /* compile may fail if engine down */
        }
      }
    }

    async function refreshFromAgent() {
      if (!currentId) return;
      await openProject(currentId, { reloadYaml: true });
    }

    function onStudioRefresh() {
      refreshFromAgent().catch(function () {});
    }

    window.addEventListener('video-studio:refresh', onStudioRefresh);

    async function pollStudioRefresh() {
      if (!currentId || document.hidden) return;
      try {
        const data = await api(
          '/api/video/projects/' + encodeURIComponent(currentId) + '/studio-refresh'
        );
        if (data.refresh) await refreshFromAgent();
      } catch (_) {
        /* ignore */
      }
    }

    refreshPollTimer = setInterval(pollStudioRefresh, REFRESH_POLL_MS);

    async function runLint() {
      if (!currentId) return;
      try {
        const data = await api('/api/video/lint', {
          method: 'POST',
          body: JSON.stringify({ projectId: currentId, yaml: textarea.value }),
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

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveScene().catch(() => {}), 800);
    }

    async function saveScene() {
      if (!currentId) return;
      await api('/api/video/projects/' + encodeURIComponent(currentId) + '/scene', {
        method: 'PUT',
        body: JSON.stringify({ yaml: textarea.value }),
      });
    }

    function artifactUrl(filename) {
      if (!currentId) return '';
      return (
        '/api/video/projects/' +
        encodeURIComponent(currentId) +
        '/artifacts/' +
        encodeURIComponent(filename || 'out.mp4')
      );
    }

    function showRenderedMp4(url) {
      if (!url) return;
      const src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
      videoEl.src = src;
      btnDownload.href = url;
      btnDownload.style.display = 'inline-block';
      outputHint.textContent = 'Rendered video — use Play or the player controls below.';
    }

    function clearRenderedMp4() {
      videoEl.removeAttribute('src');
      videoEl.load();
      btnDownload.style.display = 'none';
      btnDownload.removeAttribute('href');
      outputHint.textContent =
        'Render MP4 to generate a video. It will appear here with playback controls.';
    }

    async function loadRenderedMp4() {
      if (!currentId) {
        clearRenderedMp4();
        return;
      }
      const url = artifactUrl('out.mp4');
      videoEl.onloadeddata = function () {
        outputHint.textContent = 'Rendered video — use Play or the player controls below.';
      };
      videoEl.onerror = function () {
        clearRenderedMp4();
      };
      videoEl.src = url + '?t=' + Date.now();
    }

    btnPlay.addEventListener('click', () => {
      if (!videoEl.src) {
        alert('No rendered MP4 yet. Click Render MP4 first.');
        return;
      }
      videoEl.play().catch(function (err) {
        alert(err.message || 'Could not play video');
      });
    });

    if (SHOW_COMPOSITION_PREVIEW) {
      async function startCompositionPreview() {
        if (!currentId) return alert('Select a project first.');
        compositionDetails.open = true;
        previewHint.textContent = 'Building preview… (may take up to a minute the first time).';
        btnPreview.disabled = true;
        try {
          const data = await api('/api/video/preview/start', {
            method: 'POST',
            body: JSON.stringify({ projectId: currentId }),
          });
          if (data.url) {
            previewUrl = data.url;
            attachPreviewIframe(data.url);
            previewHint.textContent = 'Frame preview ready — scrub below (hello text is clearest around frame 45).';
          } else {
            iframe.removeAttribute('src');
            previewHint.textContent =
              data.message || 'Preview failed. Start: praisonai-video serve --port 3921';
          }
        } catch (err) {
          previewHint.textContent = 'Preview error: ' + (err.message || err);
        } finally {
          btnPreview.disabled = false;
        }
      }

      function defaultPreviewFrame() {
        return Math.min(45, Math.max(0, durationFrames - 1));
      }

      function seekFrame(n) {
        frameLabel.textContent = 'Frame ' + n + ' / ' + durationFrames;
        if (!iframe.contentWindow) return;
        iframe.contentWindow.postMessage({ type: 'pav-seek', frame: n }, '*');
      }

      function attachPreviewIframe(url) {
        const src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
        iframe.onload = function () {
          const start = defaultPreviewFrame();
          frameSlider.value = String(start);
          seekFrame(start);
        };
        iframe.src = src;
      }

      frameSlider.addEventListener('input', () => {
        seekFrame(Number(frameSlider.value));
      });

      btnPreview.addEventListener('click', () => startCompositionPreview());
    }

    textarea.addEventListener('input', () => {
      scheduleLint();
      scheduleSave();
    });

    btnReset.addEventListener('click', async () => {
      if (!currentId) return alert('Select a project first.');
      if (!confirm('Restore the default hello scene? Unsaved edits will be lost.')) return;
      const data = await api(
        '/api/video/projects/' + encodeURIComponent(currentId) + '/reset',
        { method: 'POST', body: '{}' }
      );
      textarea.value = data.sceneYaml || '';
      await runLint();
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
        showRenderedMp4(data.downloadUrl);
        jobsStrip.innerHTML = '';
        jobsStrip.append('Render complete — play the video on the right.');
        videoEl.play().catch(function () {});
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
      clearTimeout(saveTimer);
      clearInterval(jobPollTimer);
      clearInterval(refreshPollTimer);
      window.removeEventListener('video-studio:refresh', onStudioRefresh);
    };
  });
})();
