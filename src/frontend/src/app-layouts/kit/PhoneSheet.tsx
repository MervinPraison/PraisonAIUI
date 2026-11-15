/**
 * The phone menu: a left sheet holding the frame's nav and chats. Nothing
 * mounts, and the sheet code (radix dialog) is not downloaded, until it is
 * first opened; after that it stays mounted so it can animate closed.
 */
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { loadPhoneSheetBody } from './phoneSheetLoader'

export interface PhoneSheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Accessible name, e.g. "Menu and chats". */
  title: string
  /** Shown at the top (the brand). */
  header?: ReactNode
  children: ReactNode
}

const Body = lazy(loadPhoneSheetBody)

export function PhoneSheet(props: PhoneSheetProps) {
  const [requested, setRequested] = useState(props.open)
  if (props.open && !requested) setRequested(true)
  if (!requested) return null
  return (
    <Suspense fallback={null}>
      <Body {...props} />
    </Suspense>
  )
}
