/**
 * The small rules the composer's recorder (./VoiceInput) follows; in its
 * lazy chunk, never in the chat route.
 */
export const TRANSCRIBE_URL = '/api/realtime/transcribe'

/** Recording formats in order of preference (Chrome and Firefox: WebM/Ogg Opus; Safari: MP4). */
export const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'] as const

/** The first format this browser records, or '' to let it choose. */
export function pickRecordingType(isSupported: (type: string) => boolean): string {
  return RECORDING_TYPES.find((t) => {
    try {
      return isSupported(t)
    } catch {
      return false
    }
  }) ?? ''
}

export const MIC_BLOCKED = 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.'

/** What to tell the person when the microphone does not start. */
export function micErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return MIC_BLOCKED
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect one and try again.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy in another app. Close it there and try again.'
  return 'The microphone could not start. Try again.'
}

/** The composer's text with the transcript added (after what is already typed). */
export function withTranscript(current: string, transcript: string): string {
  const t = transcript.trim()
  if (!t) return current
  const before = current.trimEnd()
  return before ? `${before} ${t}` : t
}

/** 0:07, 1:05 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
