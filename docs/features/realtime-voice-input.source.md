# Voice input in the chat

Talk instead of typing. When an app turns on voice input, the chat composer
gets a microphone button. Press it, speak, and press it again: the recording
is turned into text and put in the message box, after anything already typed,
for you to read over and send.

Voice input belongs to the **realtime** feature (`builtin.realtime`). It is
off unless the app asks for it, so no other chat shows a microphone.

## Turn it on

Give aiui a realtime manager that can transcribe speech. The bundled
`OpenAIRealtimeManager` uses OpenAI speech to text (`OPENAI_API_KEY`, and
`OPENAI_BASE_URL` for a compatible server):

```python
import praisonaiui as aiui
from praisonaiui.features.realtime import OpenAIRealtimeManager

aiui.set_realtime_manager(OpenAIRealtimeManager())
# Another speech-to-text model:
# aiui.set_realtime_manager(OpenAIRealtimeManager(transcribe_model="whisper-1"))
```

`aiui.OpenAIRealtimeManager` is the same class. There is no
`praisonaiui.realtime` module: import it from `praisonaiui` or
`praisonaiui.features.realtime`.

Your own backend works too. Subclass `RealtimeProtocol` and implement
`transcribe`:

```python
from praisonaiui.features.realtime import RealtimeProtocol

class MySpeech(RealtimeProtocol):
    async def transcribe(self, audio: bytes, *, mime_type: str) -> str:
        return await my_stt(audio, mime_type)   # mime_type: audio/webm, audio/mp4...
    # create_session, send_audio, receive_audio, call_tool, close_session as before

aiui.set_realtime_manager(MySpeech())
```

A manager without `transcribe` keeps the microphone hidden.
`aiui.set_realtime_manager(None)` turns voice input off again.

## In the browser

| State | What you see |
|---|---|
| At rest | A microphone icon button before Send ("Record a voice message") |
| Recording | A red stop button and a running time; screen readers hear "Recording". Press the button again to stop and transcribe, or Escape to discard |
| Transcribing | A spinner in the button |
| Done | The text in the message box, with the caret at its end |

The browser asks for the microphone the first time. If access is blocked, a
message says how to allow it in the browser's site settings; no microphone,
or one busy in another app, gets its own message. A recording stops by itself
after two minutes.

The button is keyboard accessible (Tab to it, Enter or Space to start and
stop, Escape to discard) and has a visible focus ring. Its code is a separate
chunk that loads only for an app with voice input on.

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/realtime/voice` | GET | `{"enabled": bool, "max_seconds": 120, "max_bytes": 8388608}`: whether the composer shows the microphone |
| `/api/realtime/transcribe` | POST | The recording as the raw body (`Content-Type: audio/*`). Returns `{"text": "..."}` |

`/api/realtime/transcribe` answers 404 while voice input is off, 415 for a
body that is not audio, 400 for an empty one, 413 over 8 MiB, 501 when the
manager cannot transcribe, and 502 when the speech service fails (its message
is logged by type only, never returned). Both routes need the same
credentials as every other `/api` route.

## Not included

The reply is text. Speaking it aloud (see [TTS](tts.md)) and a hands-free,
speech-to-speech session are not part of this feature.
