/**
 * builtin.layout-chat-canvas: the app shell's default layout. The chat on
 * the left, a canvas of the artifacts the agent makes (tables, code, files)
 * beside it (design: Canvas.dc.html, CanvasPhone.dc.html).
 *
 * Eager and tiny: the frame (`app-layouts/chat-canvas`, chunk
 * `layout-chat-canvas`) loads only when this layout is rendered, and the
 * canvas and the artifact cards (`layout-features/artifacts`, chunk
 * `lf-artifacts`) only when the chat page shows them.
 *
 * The artifacts feature is optional at build time: `import.meta.glob` lists
 * its modules when they are in the tree and nothing otherwise, so a build
 * without them still has a working layout (the chat, without a canvas).
 * Outside Vite (the unit-test bundler) the glob is not transformed and the
 * call throws, which reads as "not in the tree".
 */
import type { ChatPresentation, ChatRegionProps, RegionLoader, TurnRegionProps } from '@/sdk/layouts'
import type { LayoutDescriptor } from './types'

type Modules = Record<string, () => Promise<unknown>>

/** The composer's "@" (chat-engine/presentation, a lazy chunk of its own). */
export const mentionLoader: RegionLoader = () => import('@/chat-engine/presentation/ArtifactMention')

/** Paths of the artifacts feature's regions (track A), as the glob keys them. */
export const CANVAS_PANEL = '/src/layout-features/artifacts/CanvasPanel.tsx'
export const ARTIFACT_CARDS = '/src/layout-features/artifacts/ArtifactCards.tsx'

function artifactModules(): Modules {
  try {
    return import.meta.glob([
      '/src/layout-features/artifacts/CanvasPanel.tsx',
      '/src/layout-features/artifacts/ArtifactCards.tsx',
    ])
  } catch {
    return {}
  }
}

/**
 * The chat presentation for the modules found: sessions in the frame,
 * bubbles, approval cards; the canvas as the aside (phone: "Chat | Canvas"),
 * the artifact cards under each answer and "@" (reference an artifact) in
 * the composer when the feature is there.
 */
export function chatCanvasPresentation(modules: Modules): ChatPresentation {
  const chat: ChatPresentation = { sessions: 'frame', thread: 'bubbles', approvals: 'card' }
  const panel = modules[CANVAS_PANEL]
  const cards = modules[ARTIFACT_CARDS]
  if (panel) {
    chat.aside = panel as RegionLoader<ChatRegionProps>
    chat.asideLabel = 'Canvas'
    // "@" (reference an artifact) reads the frame's artifacts feed, so it comes with the canvas.
    chat.composerTool = mentionLoader
  }
  if (cards) chat.turnFooter = cards as RegionLoader<TurnRegionProps>
  return chat
}

export const chatCanvasLayout: LayoutDescriptor = {
  id: 'chat-canvas',
  meta: {
    title: 'Chat and Canvas',
    description: 'Chat beside a canvas of the artifacts the agent makes.',
    // The design's warm paper palette and serif titles (app-layouts/chat-canvas/paper.css).
    look: 'paper',
    chat: chatCanvasPresentation(artifactModules()),
  },
  load: () => import('@/app-layouts/chat-canvas/Frame'),
}
