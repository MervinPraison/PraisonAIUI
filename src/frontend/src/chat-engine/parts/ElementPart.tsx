/**
 * data-element renderer (lazy chunk). Images are drawn here; video, audio,
 * pdf, file and code reuse chat/MultimediaElements.tsx (a second lazy chunk).
 *
 * Exfiltration guard: images, video, audio and PDFs load automatically only
 * from same-origin, data:image and blob: URLs. Any other URL renders a
 * click-to-load placeholder that shows its host, so a prompt-injected element
 * cannot beacon data out just by being rendered.
 */
import { lazy, useState, type FC, type ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hostOf, isTrustedImageUrl, safeUrl } from '../util'
import { LazyBoundary } from './LazyBoundary'

const Multimedia = lazy(() =>
  import('@/chat/MultimediaElements').then((m) => ({
    default: function MultimediaElement({ el }: { el: Record<string, unknown> }) {
      const url = typeof el.url === 'string' ? el.url : ''
      const name = typeof el.name === 'string' ? el.name : undefined
      switch (el.type) {
        case 'video':
          return <m.VideoElement url={url} className="max-w-full" />
        case 'audio':
          return <m.AudioElement url={url} className="w-full" />
        case 'pdf':
          return <m.PdfElement url={url} name={name ?? 'Document'} />
        case 'code':
          return <m.CodeBlock code={String(el.content ?? '')} language={typeof el.language === 'string' ? el.language : undefined} />
        default:
          return (
            <m.FileElement
              url={url}
              name={name ?? 'File'}
              size={typeof el.size === 'number' ? el.size : undefined}
              type={typeof el.mimeType === 'string' ? el.mimeType : typeof el.mime === 'string' ? el.mime : undefined}
            />
          )
      }
    },
  })),
)

/** Holds back anything that would fetch a third-party URL on render until the user asks for it. */
function ClickToLoad({ url, label, children }: { url: string; label: string; children: ReactNode }) {
  const [allowed, setAllowed] = useState(() => !url || isTrustedImageUrl(url))
  if (allowed) return <>{children}</>
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground" data-blocked-media>
      <span className="min-w-0 truncate">
        {label} from {hostOf(url)}
      </span>
      <Button type="button" variant="outline" size="xs" onClick={() => setAllowed(true)}>
        Load
      </Button>
    </div>
  )
}

function ChatImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <ImageOff className="size-4" aria-hidden /> The image could not be loaded
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-block max-w-full">
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-96 max-w-full rounded-lg border border-border object-contain"
      />
    </a>
  )
}

const MEDIA_LABEL: Record<string, string> = { image: 'Image', video: 'Video', audio: 'Audio', pdf: 'Document' }

const ElementPart: FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const type = typeof data.type === 'string' ? data.type : 'file'
  const raw = typeof data.url === 'string' ? data.url : ''
  const url = safeUrl(raw) ?? ''
  const name = typeof data.name === 'string' ? data.name : ''
  if (raw && !url) {
    // javascript:, data:text/html and similar never reach an href or src.
    return (
      <div className="my-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground" data-element={type} data-blocked-media>
        {name || 'An attachment'} has an unsupported link and was not loaded.
      </div>
    )
  }
  return (
    <div className="my-2 min-w-0 max-w-full" data-element={type}>
      <ClickToLoad url={MEDIA_LABEL[type] ? url : ''} label={MEDIA_LABEL[type] ?? 'File'}>
        {type === 'image' && url ? (
          <ChatImage url={url} alt={typeof data.alt === 'string' ? data.alt : name} />
        ) : (
          <LazyBoundary fallback={<div className="h-10 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}>
            <Multimedia el={{ ...data, url }} />
          </LazyBoundary>
        )}
      </ClickToLoad>
    </div>
  )
}

export default ElementPart
