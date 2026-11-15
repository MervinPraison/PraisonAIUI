/**
 * A file, PDF or video artifact: the chat's own media elements
 * (chat/MultimediaElements, a lazy chunk of its own). A PDF or video from
 * another host waits for a click (see ./ClickToLoad); a file is only a link.
 */
import { lazy, Suspense, type JSX } from 'react'
import { hostOf, isTrustedUrl as isTrustedImageUrl, safeUrl } from './urls'
import type { ArtifactKind } from '@/sdk/layoutTypes'
import { ClickToLoad } from './ClickToLoad'

const Media = lazy(() =>
  import('@/chat/MultimediaElements').then((m) => ({
    default: function MediaElement({ kind, url, name, mime }: { kind: ArtifactKind; url: string; name: string; mime?: string }) {
      if (kind === 'video') return <m.VideoElement url={url} className="max-w-full" />
      if (kind === 'pdf') return <m.PdfElement url={url} name={name} />
      return <m.FileElement url={url} name={name} type={mime} />
    },
  })),
)

export default function FileViewer({ kind, url, name, mime }: { kind: ArtifactKind; url: string; name: string; mime?: string }): JSX.Element {
  const safe = safeUrl(url)
  if (!safe) return <p className="text-sm text-tier-3">{name} has an unsupported link and was not loaded.</p>
  return (
    <ClickToLoad trusted={kind === 'file' || isTrustedImageUrl(safe)} label={`${kind === 'video' ? 'Video' : 'Document'} from ${hostOf(safe)}`}>
      <div className="min-w-0">
        <Suspense fallback={<div className="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}>
          <Media kind={kind} url={safe} name={name} mime={mime} />
        </Suspense>
      </div>
    </ClickToLoad>
  )
}
