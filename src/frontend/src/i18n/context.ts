/** The locale context LocaleProvider fills and useLocale reads. */
import { createContext, useContext } from 'react'

export interface LocaleContextValue {
  locale: string
  locales: string[]
  rtlLocales: string[]
  setLocale: (locale: string) => void
  t: (key: string, variables?: Record<string, string>) => string
  isRTL: boolean
  strings: Record<string, string>
  loading: boolean
}

export const LocaleContext = createContext<LocaleContextValue | null>(null)

export function useLocale() {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return context
}
