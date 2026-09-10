/**
 * Voice Agent Phase 2 — live transcript + browser talk widget.
 *
 * custom.js can run before dashboard.js defines window.aiui, so we wait.
 */
(function () {
  function whenReady(fn) {
    if (window.aiui && typeof window.aiui.registerView === 'function') {
      fn();
      return;
    }
    var n = 0;
    var t = setInterval(function () {
      n += 1;
      if (window.aiui && typeof window.aiui.registerView === 'function') {
        clearInterval(t);
        fn();
      } else if (n > 150) {
        clearInterval(t);
        console.warn('[voice plugin] window.aiui never became ready');
      }
    }, 100);
  }

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text != null) node.textContent = text;
    return node;
  }

  function currentCallId() {
    return new URLSearchParams(window.location.search).get('call_id') || '';
  }

  function voiceUserId() {
    var key = 'voice-user-id';
    var id = localStorage.getItem(key);
    if (!id) {
      id = 'u-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(key, id);
    }
    return id;
  }

  async function postJson(url, body) {
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  async function attachVoiceUser() {
    return postJson('/api/voice/memory/attach-user', { user_id: voiceUserId() });
  }

  function renderUiComponent(comp) {
    if (window.aiui && typeof window.aiui.renderComponent === 'function') {
      return window.aiui.renderComponent(comp);
    }
    var wrap = el('div');
    if (comp.type === 'code_block') {
      var pre = el(
        'pre',
        'margin:0;padding:16px;border-radius:10px;background:var(--db-card-bg,#1f2937);' +
          'border:1px solid var(--db-border,#334155);white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px'
      );
      pre.textContent = comp.code || '';
      wrap.appendChild(pre);
      wrap.className = 'db-code-block';
      return wrap;
    }
    if (comp.type === 'text') {
      wrap.textContent = comp.content || '';
      return wrap;
    }
    wrap.textContent = JSON.stringify(comp);
    return wrap;
  }

  function renderUiTree(data, container) {
    if (!data) return;
    if (data._components) {
      data._components.forEach(function (c) {
        container.appendChild(renderUiComponent(c));
      });
      return;
    }
    if (data.type === 'layout' && data.children) {
      data.children.forEach(function (c) {
        container.appendChild(renderUiComponent(c));
      });
    }
  }

  function findTranscriptCodeEl(root) {
    var blocks = root.querySelectorAll('.db-code-block code');
    if (!blocks.length) {
      blocks = root.querySelectorAll('.db-code-block pre');
    }
    return blocks.length ? blocks[blocks.length - 1] : null;
  }

  async function fetchJson(url, retries) {
    var attempts = retries == null ? 1 : retries;
    var lastErr = null;
    for (var i = 0; i < attempts; i += 1) {
      try {
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          await new Promise(function (r) {
            setTimeout(r, 1500);
          });
        }
      }
    }
    throw lastErr || new Error('fetch failed');
  }

  async function resolveCallId() {
    var fromQuery = currentCallId();
    if (fromQuery) return fromQuery;
    var data = await fetchJson('/api/voice/calls');
    var calls = data.calls || [];
    var live = calls.find(function (c) {
      return String(c.status || '').toLowerCase().indexOf('progress') >= 0;
    });
    return (live && live.call_id) || (calls[0] && calls[0].call_id) || '';
  }

  async function loadWebSdk(cfg) {
    var candidates = [];
    var configured = cfg.sdk_url || '';
    if (configured && configured.indexOf('dist/vapi.js') < 0) {
      candidates.push(configured);
    }
    candidates.push('https://esm.sh/@vapi-ai/web@2.7.0');

    var lastErr = null;
    for (var i = 0; i < candidates.length; i++) {
      try {
        var mod = await import(/* webpackIgnore: true */ candidates[i]);
        var Sdk = mod.default || mod.Vapi;
        if (typeof Sdk === 'function') return Sdk;
        lastErr = new Error('Module loaded but no Vapi class');
      } catch (err) {
        lastErr = err;
        console.warn('[voice plugin] SDK load failed for', candidates[i], err);
      }
    }
    throw new Error(
      'Could not load voice web SDK' + (lastErr && lastErr.message ? ': ' + lastErr.message : '')
    );
  }

  function registerVoiceViews() {
    window.aiui.registerView(
      'call-detail',
      async function (container) {
        container.innerHTML = '';
        var wrap = el(
          'div',
          'padding:20px;display:flex;flex-direction:column;gap:16px;color:var(--db-text,#eee)'
        );
        var uiHost = el('div', 'display:flex;flex-direction:column;gap:12px');
        var statusLine = el(
          'div',
          'font-size:12px;color:var(--db-text-dim,#94a3b8)',
          'Loading PraisonAIUI components…'
        );
        wrap.appendChild(uiHost);
        wrap.appendChild(statusLine);
        container.appendChild(wrap);

        var es = null;
        var lines = [];
        var transcriptEl = null;

        function renderTranscript(fullText) {
          if (!transcriptEl) return;
          if (fullText) {
            transcriptEl.textContent = fullText;
            return;
          }
          transcriptEl.textContent = lines.length ? lines.join('\n') : '(empty)';
        }

        function appendLine(role, text) {
          lines.push(role + ': ' + text);
          renderTranscript('');
        }

        try {
          var callId = await resolveCallId();
          if (!callId) {
            renderUiTree(
              {
                type: 'layout',
                children: [
                  {
                    type: 'alert',
                    variant: 'info',
                    title: 'Call detail',
                    message: 'No calls yet — start from ElevenLabs talk or GPT Realtime.',
                  },
                ],
              },
              uiHost
            );
            statusLine.textContent = 'Idle';
            return;
          }
          var uiData = await fetchJson('/api/voice/calls/' + encodeURIComponent(callId) + '/ui');
          renderUiTree(uiData.layout, uiHost);
          transcriptEl = findTranscriptCodeEl(uiHost);
          var detail = await fetchJson('/api/voice/calls/' + encodeURIComponent(callId));
          if (detail.transcript) {
            lines = detail.transcript.split('\n').filter(Boolean);
            renderTranscript(detail.transcript);
          }
          statusLine.textContent = 'Live feed connecting…';
          es = new EventSource(
            '/api/voice/calls/' + encodeURIComponent(callId) + '/live-transcript'
          );
          es.onmessage = function (ev) {
            try {
              var payload = JSON.parse(ev.data);
              if (payload.type === 'snapshot' && payload.transcript) {
                lines = payload.transcript.split('\n').filter(Boolean);
                renderTranscript(payload.transcript);
                statusLine.textContent = 'Live · snapshot loaded';
                return;
              }
              if (payload.type === 'transcript') {
                if (payload.transcriptType === 'final') {
                  appendLine(payload.role || 'unknown', payload.text || '');
                } else if (transcriptEl) {
                  transcriptEl.textContent =
                    (lines.length ? lines.join('\n') + '\n' : '') +
                    (payload.role || 'unknown') +
                    ': ' +
                    (payload.text || '') +
                    ' …';
                }
                statusLine.textContent = 'Live · ' + (payload.transcriptType || 'update');
              }
            } catch (err) {
              console.warn('[voice plugin] SSE parse error', err);
            }
          };
          es.onerror = function () {
            statusLine.textContent = 'Live feed disconnected (call may have ended)';
          };
        } catch (err) {
          statusLine.textContent = 'Failed to load call: ' + err.message;
        }

        return function cleanup() {
          if (es) es.close();
        };
      },
      function () {}
    );

    window.aiui.registerView(
      'web-talk',
      async function (container) {
        container.innerHTML = '';
        var wrap = el('div', 'padding:24px;max-width:640px;color:var(--db-text,#eee)');
        wrap.appendChild(el('h2', 'margin:0 0 12px 0', 'Web voice'));
        wrap.appendChild(
          el(
            'p',
            'margin:0 0 20px 0;line-height:1.6;color:var(--db-text-dim,#94a3b8)',
            'Click Start talking, then allow the microphone when Chrome asks. The prompt does not appear until you click the button.'
          )
        );
        var status = el('div', 'margin-bottom:16px;font-size:13px', 'Loading config…');
        var btn = el(
          'button',
          'padding:12px 20px;border-radius:10px;border:none;background:var(--db-accent,#6366f1);' +
            'color:#fff;font-size:15px;font-weight:600;cursor:pointer',
          'Start talking'
        );
        btn.disabled = true;
        wrap.appendChild(status);
        wrap.appendChild(btn);
        container.appendChild(wrap);

        var cfg = null;
        var client = null;

        try {
          cfg = await fetchJson('/api/voice/web-config');
          if (!cfg.enabled) {
            status.textContent =
              cfg.error ||
              'Web talk is not configured. Set VOICE_PUBLIC_API_KEY, VOICE_ASSISTANT_ID, VOICE_WEB_SDK_URL, VOICE_WEB_SDK_GLOBAL.';
            btn.style.display = 'none';
            return;
          }
          status.textContent = 'Ready — click Start talking, then allow microphone.';
          btn.disabled = false;
        } catch (err) {
          status.textContent = 'Config error: ' + err.message;
          return;
        }

        btn.addEventListener('click', async function () {
          if (client && typeof client.stop === 'function' && btn.textContent === 'End call') {
            client.stop();
            client = null;
            status.textContent = 'Call ended';
            btn.textContent = 'Start talking';
            return;
          }
          btn.disabled = true;
          status.textContent = 'Loading web SDK…';
          try {
            var Sdk = await loadWebSdk(cfg);
            client = new Sdk(cfg.public_key);
            if (typeof client.start === 'function') {
              await client.start(cfg.assistant_id);
            } else if (typeof client.startAssistant === 'function') {
              await client.startAssistant(cfg.assistant_id);
            } else {
              throw new Error('SDK has no start() method');
            }
            status.textContent = 'In call — allow microphone if Chrome asks. Speak now.';
            btn.textContent = 'End call';
            btn.disabled = false;
          } catch (err) {
            status.textContent = 'Start failed: ' + err.message;
            btn.disabled = false;
          }
        });
      }
    );

    window.aiui.registerView(
      'eleven-talk',
      async function (container) {
        container.innerHTML = '';
        var wrap = el('div', 'padding:24px;max-width:640px;color:var(--db-text,#eee)');
        wrap.appendChild(el('h2', 'margin:0 0 12px 0', 'ElevenLabs voice'));
        wrap.appendChild(
          el(
            'p',
            'margin:0 0 20px 0;line-height:1.6;color:var(--db-text-dim,#94a3b8)',
            'Speech Engine runs STT/TTS in the browser. Your PraisonAI agent handles replies on the server.'
          )
        );
        var status = el('div', 'margin-bottom:16px;font-size:13px', 'Loading config…');
        var btn = el(
          'button',
          'padding:12px 20px;border-radius:10px;border:none;background:var(--db-accent,#6366f1);' +
            'color:#fff;font-size:15px;font-weight:600;cursor:pointer',
          'Start conversation'
        );
        btn.disabled = true;
        wrap.appendChild(status);
        wrap.appendChild(btn);
        container.appendChild(wrap);

        var conversation = null;
        var cfg = null;

        try {
          cfg = await fetchJson('/api/voice/speech-engine/config', 8);
          if (!cfg.enabled) {
            status.textContent =
              cfg.error ||
              'Speech Engine not ready. Run: pip install -U "elevenlabs>=2.47.0" then .\\start_dev.ps1 -Restart. ' +
                'API key needs convai_write permission in ElevenLabs dashboard.';
            btn.style.display = 'none';
            return;
          }
          var toolList = (cfg.tools && cfg.tools.length ? cfg.tools.join(', ') : 'get_current_time, echo_message');
          status.textContent =
            'Ready — LLM ' +
            (cfg.model || 'gpt-4o-mini') +
            ' · tools: ' +
            toolList +
            '. Click Start conversation, then allow microphone.';
          btn.disabled = false;
        } catch (err) {
          status.textContent = 'Config error: ' + err.message;
          return;
        }

        btn.addEventListener('click', async function () {
          if (conversation && btn.textContent === 'End conversation') {
            try {
              await conversation.endSession();
            } catch (e) {
              /* ignore */
            }
            conversation = null;
            status.textContent = 'Conversation ended';
            btn.textContent = 'Start conversation';
            return;
          }
          btn.disabled = true;
          status.textContent = 'Loading ElevenLabs client…';
          try {
            var sdkUrl = cfg.client_sdk_url || 'https://esm.sh/@elevenlabs/client';
            var mod = await import(/* webpackIgnore: true */ sdkUrl);
            var Conversation = mod.Conversation;
            if (!Conversation || typeof Conversation.startSession !== 'function') {
              throw new Error('ElevenLabs client SDK missing Conversation.startSession');
            }
            var tokenResp = await fetchJson('/api/voice/speech-engine/token');
            if (!tokenResp.token) throw new Error('No conversation token returned');
            await navigator.mediaDevices.getUserMedia({ audio: true });
            await attachVoiceUser();
            var startOpts = {
              conversationToken: tokenResp.token,
              onConnect: function () {
                status.textContent =
                  'Connected — speak, then pause ~1s so the agent knows you finished.';
                btn.textContent = 'End conversation';
                btn.disabled = false;
              },
              onDisconnect: function (details) {
                var reason = details && details.reason ? details.reason : '';
                if (reason === 'agent' || reason === 'unknown') {
                  reason =
                    'Speech Engine server did not respond in time. Restart .\\start_dev.ps1 -Restart and try again.';
                } else if (!reason) {
                  reason =
                    'Connection closed (ElevenLabs could not reach your Speech Engine WebSocket).';
                }
                status.textContent = 'Disconnected — ' + reason;
                btn.textContent = 'Start conversation';
                btn.disabled = false;
                conversation = null;
              },
              onError: function (error) {
                status.textContent =
                  'Error: ' + (error && error.message ? error.message : String(error));
                btn.disabled = false;
              },
              onStatusChange: function (state) {
                if (state && state.status) {
                  status.textContent = 'Status: ' + state.status;
                }
              },
              onModeChange: function (mode) {
                if (!mode || !mode.mode) return;
                if (mode.mode === 'listening') {
                  status.textContent = 'Listening… speak, then pause when done.';
                } else if (mode.mode === 'speaking') {
                  status.textContent = 'Agent speaking…';
                } else {
                  status.textContent = 'Mode: ' + mode.mode;
                }
              },
              onMessage: function (msg) {
                if (msg && msg.message) {
                  console.log('[eleven-talk]', msg.source || 'unknown', msg.message);
                }
              },
            };
            if (cfg.first_message) {
              startOpts.overrides = {
                agent: { firstMessage: cfg.first_message },
              };
            }
            conversation = await Conversation.startSession(startOpts);
          } catch (err) {
            status.textContent = 'Start failed: ' + err.message;
            btn.disabled = false;
          }
        });
      }
    );

    window.aiui.registerView(
      'realtime-talk',
      async function (container) {
        container.innerHTML = '';
        var wrap = el('div', 'padding:24px;max-width:640px;color:var(--db-text,#eee)');
        wrap.appendChild(el('h2', 'margin:0 0 12px 0', 'GPT Realtime voice'));
        wrap.appendChild(
          el(
            'p',
            'margin:0 0 20px 0;line-height:1.6;color:var(--db-text-dim,#94a3b8)',
            'Speech-to-speech via OpenAI gpt-realtime-2.1-mini (WebRTC).'
          )
        );
        var status = el('div', 'margin-bottom:16px;font-size:13px', 'Loading config…');
        var btn = el(
          'button',
          'padding:12px 20px;border-radius:10px;border:none;background:var(--db-accent,#6366f1);' +
            'color:#fff;font-size:15px;font-weight:600;cursor:pointer',
          'Start conversation'
        );
        btn.disabled = true;
        wrap.appendChild(status);
        wrap.appendChild(btn);
        container.appendChild(wrap);

        var pc = null;
        var dc = null;
        var audioEl = null;
        var localStream = null;
        var callId = null;
        var cfg = null;

        async function saveTranscript(role, text) {
          if (!callId || !text) return;
          try {
            await postJson('/api/voice/realtime/transcript', {
              call_id: callId,
              role: role,
              text: text,
            });
          } catch (e) {
            console.warn('[realtime-talk] transcript save failed', e);
          }
        }

        function handleRealtimeEvent(event) {
          if (!event || !event.type) return;
          if (
            event.type === 'conversation.item.input_audio_transcription.completed' &&
            event.transcript
          ) {
            saveTranscript('user', event.transcript);
            status.textContent = 'You: ' + event.transcript;
          }
          if (event.type === 'response.output_audio_transcript.done' && event.transcript) {
            saveTranscript('agent', event.transcript);
            status.textContent = 'Agent: ' + event.transcript;
          }
          if (event.type === 'response.output_audio_transcript.delta' && event.delta) {
            status.textContent = 'Agent speaking…';
          }
          if (event.type === 'input_audio_buffer.speech_started') {
            status.textContent = 'Listening…';
          }
        }

        async function endSession() {
          if (dc) {
            try {
              dc.close();
            } catch (e) {
              /* ignore */
            }
            dc = null;
          }
          if (pc) {
            try {
              pc.close();
            } catch (e) {
              /* ignore */
            }
            pc = null;
          }
          if (localStream) {
            localStream.getTracks().forEach(function (t) {
              t.stop();
            });
            localStream = null;
          }
          if (audioEl && audioEl.parentNode) {
            audioEl.parentNode.removeChild(audioEl);
            audioEl = null;
          }
          if (callId) {
            try {
              await postJson('/api/voice/realtime/end', { call_id: callId });
            } catch (e) {
              /* ignore */
            }
          }
          callId = null;
          status.textContent = 'Conversation ended.';
          btn.textContent = 'Start conversation';
          btn.disabled = false;
        }

        try {
          cfg = await fetchJson('/api/voice/realtime/config', 8);
          if (!cfg.enabled) {
            status.textContent =
              cfg.error || 'Set OPENAI_API_KEY in .env, then restart .\\start_dev.ps1';
            btn.style.display = 'none';
            return;
          }
          status.textContent = 'Ready (' + (cfg.model || 'gpt-realtime-2.1-mini') + ').';
          btn.disabled = false;
        } catch (err) {
          status.textContent = 'Config error: ' + err.message;
          return;
        }

        btn.addEventListener('click', async function () {
          if (pc && btn.textContent === 'End conversation') {
            await endSession();
            return;
          }
          btn.disabled = true;
          status.textContent = 'Starting WebRTC session…';
          try {
            var callResp = await postJson('/api/voice/realtime/new-call', {
              user_id: voiceUserId(),
            });
            callId = callResp.call_id;
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            pc = new RTCPeerConnection();
            audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            audioEl.style.display = 'none';
            wrap.appendChild(audioEl);
            pc.ontrack = function (e) {
              if (audioEl) audioEl.srcObject = e.streams[0];
            };
            localStream.getTracks().forEach(function (track) {
              pc.addTrack(track, localStream);
            });
            dc = pc.createDataChannel('oai-events');
            dc.addEventListener('open', function () {
              if (cfg.first_message) {
                dc.send(
                  JSON.stringify({
                    type: 'response.create',
                    response: {
                      instructions:
                        'Greet the user by saying exactly: ' + cfg.first_message,
                    },
                  })
                );
              }
            });
            dc.addEventListener('message', function (e) {
              try {
                handleRealtimeEvent(JSON.parse(e.data));
              } catch (err) {
                console.warn('[realtime-talk] event parse failed', err);
              }
            });
            var offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            var sdpResp = await fetch(
              '/api/voice/realtime/session?call_id=' + encodeURIComponent(callId),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/sdp' },
                body: offer.sdp,
              }
            );
            if (!sdpResp.ok) {
              var errText = await sdpResp.text();
              throw new Error(errText || 'SDP exchange failed');
            }
            var answerSdp = await sdpResp.text();
            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
            status.textContent = 'Connected — speak when ready.';
            btn.textContent = 'End conversation';
            btn.disabled = false;
          } catch (err) {
            status.textContent = 'Start failed: ' + err.message;
            await endSession();
            btn.disabled = false;
          }
        });
      }
    );

    window.aiui.registerView(
      'config',
      async function (container) {
        container.innerHTML = '';
        var wrap = el('div', 'padding:24px;max-width:900px;color:var(--db-text,#eee)');
        wrap.appendChild(el('h2', 'margin:0 0 8px 0', 'Voice stack doctor'));
        wrap.appendChild(
          el(
            'p',
            'margin:0 0 16px 0;font-size:13px;color:var(--db-text-dim,#94a3b8)',
            'Checks .env keys, local ports, APIs, and Speech Engine tunnel reachability.'
          )
        );
        var status = el('div', 'margin-bottom:16px;font-size:13px', 'Running checks…');
        var tableHost = el('div', '');
        wrap.appendChild(status);
        wrap.appendChild(tableHost);
        container.appendChild(wrap);

        function statusColor(st) {
          if (st === 'pass') return '#22c55e';
          if (st === 'warn') return '#eab308';
          return '#ef4444';
        }

        try {
          var data = await fetchJson('/api/voice/doctor', 12);
          var summary = data.summary || {};
          status.textContent =
            'Passed ' +
            (summary.passed || 0) +
            ' · Warnings ' +
            (summary.warnings || 0) +
            ' · Failed ' +
            (summary.failed || 0);
          var rows = (data.checks || []).map(function (c) {
            return [
              c.name || '—',
              c.status || '—',
              c.detail || '—',
            ];
          });
          renderUiTree(
            {
              type: 'layout',
              children: [
                {
                  type: 'table',
                  headers: ['Check', 'Status', 'Detail'],
                  rows: rows.length ? rows : [['—', '—', '—']],
                },
              ],
            },
            tableHost
          );
          var badges = tableHost.querySelectorAll('td');
          badges.forEach(function (cell) {
            if (cell.textContent === 'pass' || cell.textContent === 'warn' || cell.textContent === 'fail') {
              cell.style.color = statusColor(cell.textContent);
              cell.style.fontWeight = '600';
            }
          });
        } catch (err) {
          status.textContent = 'Doctor failed: ' + err.message;
        }
      },
      function () {}
    );

    console.log(
      '[voice plugin] Registered call-detail + web-talk + eleven-talk + realtime-talk + config views'
    );

    var path = (window.location.pathname || '').replace(/^\//, '');
    if (
      (path === 'web-talk' ||
        path === 'call-detail' ||
        path === 'eleven-talk' ||
        path === 'realtime-talk') &&
      typeof window.aiui.selectPage === 'function'
    ) {
      window.aiui.selectPage(path);
    } else if (
      path === 'web-talk' ||
      path === 'call-detail' ||
      path === 'eleven-talk' ||
      path === 'realtime-talk'
    ) {
      var n = 0;
      var t = setInterval(function () {
        n += 1;
        if (typeof window.aiui.selectPage === 'function') {
          clearInterval(t);
          window.aiui.selectPage(path);
        } else if (n > 50) {
          clearInterval(t);
        }
      }, 100);
    }
  }

  whenReady(registerVoiceViews);
})();
