import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { I18nConfig } from '../types'

interface LocaleContextValue {
  locale: string
  locales: string[]
  rtlLocales: string[]
  setLocale: (locale: string) => void
  t: (key: string, variables?: Record<string, string>) => string
  isRTL: boolean
  strings: Record<string, string>
  loading: boolean
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function useLocale() {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return context
}

interface LocaleProviderProps {
  config?: I18nConfig
  children: React.ReactNode
}

export function LocaleProvider({ config, children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState(config?.defaultLocale || 'en')
  const [strings, setStrings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const locales = config?.locales || ['en']
  const rtlLocales = config?.rtlLocales || []
  const isRTL = rtlLocales.includes(locale)

  // Apply RTL to document
  useEffect(() => {
    if (isRTL) {
      document.documentElement.dir = 'rtl'
    } else {
      document.documentElement.dir = 'ltr'
    }
  }, [isRTL])

  // Load strings from API when locale changes
  useEffect(() => {
    const abortController = new AbortController()
    
    async function loadStrings() {
      if (!config || locales.length <= 1) return
      
      setLoading(true)
      try {
        const response = await fetch(`/api/i18n/strings/${locale}`, {
          signal: abortController.signal
        })
        if (response.ok) {
          const data = await response.json()
          setStrings(data.strings || {})
        }
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === 'AbortError') return
        console.error('Failed to load translations:', error)
      } finally {
        setLoading(false)
      }
    }

    loadStrings()
    
    // Cleanup: abort the request if component unmounts or locale changes
    return () => abortController.abort()
  }, [locale, config, locales.length])

  const setLocale = useCallback(async (newLocale: string) => {
    // Validate locale format (e.g., 'en', 'en-US', 'zh-CN')
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(newLocale)) {
      console.error('Invalid locale format:', newLocale)
      return
    }
    
    if (!locales.includes(newLocale)) return
    
    setLocaleState(newLocale)
    
    // Update server-side locale
    try {
      await fetch('/api/i18n/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale })
      })
    } catch (error) {
      console.error('Failed to update server locale:', error)
    }
  }, [locales])

  const t = useCallback((key: string, variables?: Record<string, string>) => {
    let text = strings[key] || key
    
    // Apply variable substitution with proper escaping
    if (variables) {
      Object.entries(variables).forEach(([k, v]) => {
        // Escape special regex characters in the key to prevent injection
        const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        text = text.replace(new RegExp(`{${escapedKey}}`, 'g'), v)
      })
    }
    
    return text
  }, [strings])

  const value: LocaleContextValue = {
    locale,
    locales,
    rtlLocales,
    setLocale,
    t,
    isRTL,
    strings,
    loading
  }

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  )
}