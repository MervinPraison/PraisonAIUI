/**
 * The Command Deck layout frame (chunk `layout-command`). Stub: the kit's
 * BasicFrame until Track K builds this layout's own frame from its design.
 * A layout imports only the SDK, components/ui, lib and the kit, never another
 * layout or the shell (app-layouts/isolation.test.ts).
 */
import type { LayoutProps } from '@/sdk/layouts'
import { BasicFrame } from '@/app-layouts/kit'

export default function CommandFrame(props: LayoutProps) {
  return <BasicFrame {...props} name="command" chatPage="chat" />
}
