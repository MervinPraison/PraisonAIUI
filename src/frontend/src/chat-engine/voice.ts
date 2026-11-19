/**
 * Voice input for the composer (the realtime feature, `features/realtime.py`):
 * whether this app turned it on. Only this probe is in the chat route; the
 * recorder (./VoiceInput, with ./voiceRecorder) is a lazy chunk the composer fetches
 * only once `GET /api/realtime/voice` says `enabled`; an app without a
 * realtime manager that transcribes, or with the feature off (404), never
 * downloads it.
 */
import { useEffect, useState } from 'react'

export const VOICE_URL = '/api/realtime/voice'

export interface VoiceConfig {
  enabled: boolean
  /** The recorder stops by itself after this many seconds. */
  maxSeconds: number
  /** The server refuses a larger clip. */
  maxBytes: number
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)

/** The server's answer as a VoiceConfig (anything unexpected is "off"). */
export function parseVoiceConfig(data: unknown): VoiceConfig | null {
  if (!data || typeof data !== 'object' || (data as { enabled?: unknown }).enabled !== true) return null
  const d = data as { max_seconds?: unknown; max_bytes?: unknown }
  return { enabled: true, maxSeconds: num(d.max_seconds, 120), maxBytes: num(d.max_bytes, 8 * 1024 * 1024) }
}

let probe: Promise<VoiceConfig | null> | null = null

/** One request per page view: the app's voice input setting (null: off). */
export function loadVoiceConfig(fetchImpl: typeof fetch = fetch): Promise<VoiceConfig | null> {
  probe ??= fetchImpl(VOICE_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseVoiceConfig)
    .catch(() => null)
  return probe
}

export function resetVoiceConfigForTests(): void {
  probe = null
}

/** The voice input setting once known; null while loading and when off. */
export function useVoiceConfig(): VoiceConfig | null {
  const [config, setConfig] = useState<VoiceConfig | null>(null)
  useEffect(() => {
    let live = true
    void loadVoiceConfig().then((c) => {
      if (live) setConfig(c)
    })
    return () => {
      live = false
    }
  }, [])
  return config
}
