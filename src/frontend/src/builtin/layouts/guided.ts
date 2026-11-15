/**
 * builtin.layout-guided: Guided Studio, for newcomers (ADR 0003 §4 G).
 * Plain words, large targets, every step explained.
 *
 *   frame        app-layouts/guided/Frame (chunk layout-guided)
 *   chat         thread 'steps'; the chat page keeps no session rail (the
 *                frame lists "Your recent chats"); approvals as the explained
 *                card; regions, each its own lazy chunk:
 *                  turnHeader  the plain-language step tracker (lf-step-tracker)
 *                  turnFooter  follow-up chips from run_completed.suggestions
 *                  empty       templates to start from
 *   pages        `start` (Home) and `templates`, shell-only pages of the
 *                Python record builtin.layout-guided: registered only when the
 *                manifest lists them (guidedPagesBuiltin), lazily
 *
 * Eager and tiny: everything below is behind import(); the regions and
 * pages behind a single one (app-layouts/guided/lazy), so the boot chunk
 * carries one preload list for them, not five.
 */
import type { BuiltinPlugin } from '../types'
import type { LayoutDescriptor } from './types'

const parts = () => import('@/app-layouts/guided/lazy')

export const guidedLayout: LayoutDescriptor = {
  id: 'guided',
  meta: {
    title: 'Guided Studio',
    description: 'Plain language and large buttons; every step explained.',
    chat: {
      sessions: 'frame',
      thread: 'steps',
      approvals: 'card',
      turnHeader: () => parts().then((m) => m.stepTracker()),
      turnFooter: () => parts().then((m) => m.followUps()),
      empty: () => parts().then((m) => m.templatesEmpty()),
    },
  },
  load: () => import('@/app-layouts/guided/Frame'),
}

/** Guided's own pages and their lazy React components. */
export const GUIDED_PAGES = Object.freeze({
  start: () => parts().then((m) => m.startPage()),
  templates: () => parts().then((m) => m.templatesPage()),
})

/**
 * The browser half of the pages of builtin.layout-guided. The server lists
 * them (shell_only, `layouts: ['guided']`) only while Guided is offered, so
 * with the layout disabled nothing registers and their URLs show "Page not
 * found".
 */
export const guidedPagesBuiltin: BuiltinPlugin = {
  name: 'builtin.layout-guided',
  pages: Object.keys(GUIDED_PAGES),
  activate(sdk, { pageIds }) {
    for (const id of pageIds) {
      const load = GUIDED_PAGES[id as keyof typeof GUIDED_PAGES]
      if (load) sdk.registerPage(id, load)
    }
  },
}
