/** A markdown document artifact, through the chat's lazy Markdown renderer. */
import type { JSX } from 'react'
import { Markdown } from '@/markdown/LazyMarkdown'

export default function MarkdownViewer({ content, streaming }: { content: string; streaming?: boolean }): JSX.Element {
  return (
    <div className="min-w-0 max-w-prose">
      <Markdown variant="chat" streaming={streaming}>
        {content}
      </Markdown>
    </div>
  )
}
