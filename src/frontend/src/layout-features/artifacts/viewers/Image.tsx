/**
 * An image artifact. Like the chat (chat-engine/parts/ElementPart), only
 * same-origin, data:image and blob: URLs load on their own; any other host
 * waits for a click, so an injected element cannot beacon out by rendering.
 */
import { useState, type JSX } from 'react'
import { ExternalLink, ImageOff } from 'lucide-react'
import { hostOf, isTrustedImageUrl, safeUrl } from '@/chat-engine/util'
import { ClickToLoad } from './ClickToLoad'

export default function ImageViewer({ url, alt }: { url: string; alt: string }): JSX.Element {
  const safe = safeUrl(url)
  const [failed, setFailed] = useState(false)
  if (!safe) return <p className="text-sm text-tier-3">This image has an unsupported link and was not loaded.</p>
  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-tier-2">
        <ImageOff className="size-4" aria-hidden /> The image could not be loaded
      </div>
    )
  }
  return (
    <ClickToLoad trusted={isTrustedImageUrl(safe)} label={`Image from ${hostOf(safe)}`}>
      <figure className="m-0 flex min-w-0 flex-col items-start gap-2">
        <img src={safe} alt={alt} onError={() => setFailed(true)} className="max-h-[70vh] max-w-full rounded-lg border border-hairline object-contain" />
        <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs font-semibold text-link">
          Open the original <ExternalLink className="size-3" aria-hidden />
        </a>
      </figure>
    </ClickToLoad>
  )
}
