// Voice input in the composer: when it shows, how it records, what it says on failure.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import VoiceInput from './VoiceInput'
import { loadVoiceConfig, parseVoiceConfig, resetVoiceConfigForTests, VOICE_URL } from './voice'
import { clock, MIC_BLOCKED, micErrorMessage, pickRecordingType, withTranscript } from './voiceRecorder'

afterEach(() => resetVoiceConfigForTests())

test('parseVoiceConfig: on only when the server says enabled: true', () => {
  assert.deepEqual(parseVoiceConfig({ enabled: true, max_seconds: 60, max_bytes: 1000 }), { enabled: true, maxSeconds: 60, maxBytes: 1000 })
  assert.deepEqual(parseVoiceConfig({ enabled: true }), { enabled: true, maxSeconds: 120, maxBytes: 8 * 1024 * 1024 })
  assert.equal(parseVoiceConfig({ enabled: false, max_seconds: 60 }), null)
  assert.equal(parseVoiceConfig({ enabled: 'yes' }), null)
  assert.equal(parseVoiceConfig(null), null)
})

test('loadVoiceConfig: one request per page view; the feature off (404) or a network error is "off"', async () => {
  const calls: string[] = []
  const ok = (async (url: string) => {
    calls.push(url)
    return new Response(JSON.stringify({ enabled: true, max_seconds: 30 }), { status: 200 })
  }) as unknown as typeof fetch
  assert.equal((await loadVoiceConfig(ok))?.maxSeconds, 30)
  await loadVoiceConfig(ok)
  assert.deepEqual(calls, [VOICE_URL])

  resetVoiceConfigForTests()
  assert.equal(await loadVoiceConfig((async () => new Response('', { status: 404 })) as unknown as typeof fetch), null)
  resetVoiceConfigForTests()
  assert.equal(await loadVoiceConfig((async () => { throw new TypeError('offline') }) as unknown as typeof fetch), null)
})

test('pickRecordingType: Opus in WebM first, MP4 for Safari, else let the browser choose', () => {
  assert.equal(pickRecordingType(() => true), 'audio/webm;codecs=opus')
  assert.equal(pickRecordingType((t) => t === 'audio/mp4'), 'audio/mp4')
  assert.equal(pickRecordingType(() => false), '')
  assert.equal(pickRecordingType(() => { throw new Error('no') }), '')
})

test('micErrorMessage: a blocked permission says how to allow it', () => {
  assert.equal(micErrorMessage(new DOMException('denied', 'NotAllowedError')), MIC_BLOCKED)
  assert.equal(micErrorMessage({ name: 'SecurityError' }), MIC_BLOCKED)
  assert.match(micErrorMessage({ name: 'NotFoundError' }), /No microphone was found/)
  assert.match(micErrorMessage({ name: 'NotReadableError' }), /busy in another app/)
  assert.match(micErrorMessage(new Error('?')), /could not start/)
})

test('withTranscript: the text goes after what is typed, trimmed; nothing heard changes nothing', () => {
  assert.equal(withTranscript('', ' hello '), 'hello')
  assert.equal(withTranscript('Summarise this:  ', 'the plan'), 'Summarise this: the plan')
  assert.equal(withTranscript('draft', '   '), 'draft')
  assert.equal(clock(0), '0:00')
  assert.equal(clock(65.9), '1:05')
})

test('the button at rest: a named, unpressed toggle with a polite status region', () => {
  const html = renderToStaticMarkup(createElement(VoiceInput, { maxSeconds: 60, maxBytes: 1000 }))
  assert.match(html, /data-voice-input="idle"/)
  assert.match(html, /<button[^>]*aria-label="Record a voice message"/)
  assert.match(html, /aria-pressed="false"/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /lucide-mic/)
})
