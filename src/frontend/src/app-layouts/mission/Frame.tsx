/**
 * The Mission Control layout frame (chunk `layout-mission`). Stub: the kit's
 * BasicFrame until Track M builds this layout's own frame from its design.
 * A layout imports only the SDK, components/ui, lib and the kit, never another
 * layout or the shell (app-layouts/isolation.test.ts).
 */
import type { LayoutProps } from '@/sdk/layouts'
import { BasicFrame } from '@/app-layouts/kit'

export default function MissionFrame(props: LayoutProps) {
  return <BasicFrame {...props} name="mission" chatPage="chat" />
}
