/**
 * The composer's microphone (voice input; a lazy chunk, see ./voice). Press
 * to record, press again to stop (Escape discards); the clip goes to
 * `POST /api/realtime/transcribe` and the text lands in the composer, after
 * what is already typed, to read over and send. It stops by itself after
 * `maxSeconds`. A blocked or missing microphone, or a failed transcription,
 * is said in a toast; the state is announced to screen readers.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { notify } from '@/sdk/notify'
import { cn } from '@/lib/utils'
import { PREFILL_EVENT } from './feeds'
import type { VoiceConfig } from './voice'
import { clock, micErrorMessage, pickRecordingType, TRANSCRIBE_URL, withTranscript } from './voiceRecorder'

type Phase = 'idle' | 'starting' | 'recording' | 'sending'

const ERROR_TOAST = { type: 'error', duration: 8000 } as const

export default function VoiceInput({ maxSeconds, maxBytes }: Pick<VoiceConfig, 'maxSeconds' | 'maxBytes'>): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: number; discard: boolean } | null>(null)

  const release = useCallback(() => {
    const r = rec.current
    if (!r) return
    window.clearInterval(r.timer)
    for (const track of r.stream.getTracks()) track.stop()
    rec.current = null
  }, [])

  useEffect(
    () => () => {
      if (rec.current) rec.current.discard = true
      if (rec.current?.recorder.state === 'recording') rec.current.recorder.stop()
      release()
    },
    [release],
  )

  const toComposer = (text: string) => {
    const box = button.current?.closest('form')?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')
    const next = withTranscript(box?.value ?? '', text)
    window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: { text: next } }))
    requestAnimationFrame(() => {
      if (!box) return
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
    })
  }

  const send = async (clip: Blob) => {
    setPhase('sending')
    try {
      if (clip.size > maxBytes) throw new Error('The recording is too long.')
      const res = await fetch(TRANSCRIBE_URL, {
        method: 'POST',
        body: clip,
        credentials: 'same-origin',
        headers: { 'Content-Type': clip.type || 'audio/webm', Accept: 'application/json' },
      })
      const data = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown }
      if (!res.ok) throw new Error(typeof data.error === 'string' && data.error ? data.error : 'Could not transcribe the recording.')
      const text = typeof data.text === 'string' ? data.text.trim() : ''
      if (text) toComposer(text)
      else void notify('No speech was heard. Try again, closer to the microphone.', { type: 'info' })
    } catch (err) {
      void notify(err instanceof Error && err.message ? err.message : 'Could not transcribe the recording.', ERROR_TOAST)
    } finally {
      setPhase('idle')
    }
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      void notify('Voice input needs a browser that can record from the microphone.', ERROR_TOAST)
      return
    }
    setPhase('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setPhase('idle')
      void notify(micErrorMessage(err), ERROR_TOAST)
      return
    }
    const type = pickRecordingType((t) => MediaRecorder.isTypeSupported(t))
    let recorder: MediaRecorder
    try {
      recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream)
    } catch (err) {
      for (const track of stream.getTracks()) track.stop()
      setPhase('idle')
      void notify(micErrorMessage(err), ERROR_TOAST)
      return
    }
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onstop = () => {
      const discard = rec.current?.discard ?? true
      release()
      if (discard) {
        setPhase('idle')
        return
      }
      void send(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }))
    }
    const begun = Date.now()
    const timer = window.setInterval(() => {
      const s = (Date.now() - begun) / 1000
      setElapsed(s)
      if (s >= maxSeconds) stop(false)
    }, 250)
    rec.current = { recorder, stream, timer, discard: false }
    setElapsed(0)
    recorder.start()
    setPhase('recording')
  }

  const stop = (discard: boolean) => {
    const r = rec.current
    if (!r) return
    r.discard = discard
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    else {
      release()
      setPhase('idle')
    }
  }

  // Escape discards a recording wherever focus is (the button or the
  // composer), before anything else hears it (a sheet would close too).
  useEffect(() => {
    if (phase !== 'recording') return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      stop(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const recording = phase === 'recording'
  const busy = phase === 'starting' || phase === 'sending'
  const label = recording ? 'Stop recording and transcribe' : phase === 'sending' ? 'Transcribing your recording' : 'Record a voice message'

  return (
    <span className="flex shrink-0 items-center" data-voice-input={phase}>
      {/* Recording, the stop button carries the running time (one pill, so the composer row keeps Send at 390 px). */}
      <Button
        ref={button}
        type="button"
        variant={recording ? 'destructive' : 'ghost'}
        size={recording ? 'sm' : 'icon-sm'}
        className={cn('shrink-0 rounded-lg', recording ? 'tabular-nums' : 'text-muted-foreground hover:text-foreground')}
        aria-label={label}
        aria-pressed={recording}
        aria-disabled={busy || undefined}
        title={recording ? 'Stop (Esc discards)' : 'Voice input'}
        onClick={() => {
          if (busy) return
          if (recording) stop(false)
          else void start()
        }}
      >
        {busy ? <Spinner size="sm" /> : recording ? <Square className="fill-current motion-safe:animate-pulse" /> : <Mic />}
        {recording && <span aria-hidden="true">{clock(elapsed)}</span>}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {recording ? 'Recording. Press the button again to stop, or Escape to discard.' : phase === 'sending' ? 'Transcribing.' : ''}
      </span>
    </span>
  )
}
