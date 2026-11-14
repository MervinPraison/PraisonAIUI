/**
 * A2UI surface (lazy chunk): the existing surfaces/ renderer, which itself
 * loads the optional @a2ui/* packages on demand.
 */
import type { FC } from 'react'
import { SurfaceHost } from '@/surfaces/SurfaceHost'

const A2uiPart: FC<{ data: { surface_id?: string; messages?: Record<string, unknown>[] }; sessionId?: string }> = ({ data, sessionId }) => (
  <div className="my-2 min-w-0 max-w-full" data-a2ui-surface={data.surface_id ?? 'main'}>
    <SurfaceHost mode="auto" messages={data.messages ?? []} surfaceId={data.surface_id} sessionId={sessionId} />
  </div>
)

export default A2uiPart
