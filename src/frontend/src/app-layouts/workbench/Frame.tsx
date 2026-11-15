/**
 * The Workbench layout frame (chunk `layout-workbench`). Stub: the kit's
 * BasicFrame until Track W builds this layout's own frame from its design.
 * A layout imports only the SDK, components/ui, lib and the kit, never another
 * layout or the shell (app-layouts/isolation.test.ts).
 */
import type { LayoutProps } from '@/sdk/layouts'
import { BasicFrame } from '@/app-layouts/kit'

export default function WorkbenchFrame(props: LayoutProps) {
  return <BasicFrame {...props} name="workbench" chatPage="chat" />
}
