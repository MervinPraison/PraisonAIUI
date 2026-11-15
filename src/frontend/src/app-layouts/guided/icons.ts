/** Icons of the pages Guided knows (the frame and the cards); others show the manifest's mark. */
import type { ComponentType } from 'react'
import { Bot, CircleHelp, House, LayoutTemplate, MessageCircle, MessagesSquare, Settings } from 'lucide-react'
import { HELP_ID, PAGE } from './nav'

export type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** Icons of the pages Guided knows; others show the manifest's mark. */
export const PAGE_ICONS: Readonly<Record<string, IconComponent>> = Object.freeze({
  [PAGE.home]: House,
  [PAGE.chat]: MessageCircle,
  [PAGE.agents]: Bot,
  [PAGE.templates]: LayoutTemplate,
  [PAGE.sessions]: MessagesSquare,
  [PAGE.settings]: Settings,
  [HELP_ID]: CircleHelp,
})
