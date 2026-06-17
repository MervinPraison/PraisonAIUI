import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { I18nConfig } from '../types'

interface TranslationMap {
  [key: string]: string
}

interface LocaleContextType {
  locale: string
  locales: string[]
  rtlLocales: string[]
  setLocale: (locale: string) => void
  t: (key: string, fallback?: string) => string
  isRTL: boolean
}

const LocaleContext = createContext<LocaleContextType | null>(null)

const DEFAULT_TRANSLATIONS: Record<string, TranslationMap> = {
  en: {
    'nav.home': 'Home',
    'nav.docs': 'Documentation', 
    'nav.api': 'API',
    'nav.settings': 'Settings',
    'chat.placeholder': 'Type your message...',
    'chat.send': 'Send',
    'footer.copyright': 'All rights reserved',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'locale.switcher': 'Language',
  },
  es: {
    'nav.home': 'Inicio',
    'nav.docs': 'Documentación',
    'nav.api': 'API', 
    'nav.settings': 'Configuración',
    'chat.placeholder': 'Escribe tu mensaje...',
    'chat.send': 'Enviar',
    'footer.copyright': 'Todos los derechos reservados',
    'footer.privacy': 'Privacidad',
    'footer.terms': 'Términos',
    'locale.switcher': 'Idioma',
  },
  ar: {
    'nav.home': 'الصفحة الرئيسية',
    'nav.docs': 'الوثائق',
    'nav.api': 'واجهة البرمجة',
    'nav.settings': 'الإعدادات',
    'chat.placeholder': 'اكتب رسالتك...',
    'chat.send': 'إرسال',
    'footer.copyright': 'جميع الحقوق محفوظة',
    'footer.privacy': 'الخصوصية',
    'footer.terms': 'الشروط',
    'locale.switcher': 'اللغة',
  },
}

export function LocaleProvider({ 
  children, 
  config 
}: { 
  children: ReactNode
  config?: I18nConfig 
}) {
  const defaultLocale = config?.defaultLocale || 'en'
  const availableLocales = config?.locales || ['en']
  const rtlLocales = config?.rtlLocales || []
  const fallbackLocale = config?.fallbackLocale || 'en'

  const [locale, setLocaleState] = useState(() => {
    const saved = localStorage.getItem('locale')
    return saved && availableLocales.includes(saved) ? saved : defaultLocale
  })
  
  const [translations, setTranslations] = useState<Record<string, TranslationMap>>({})

  useEffect(() => {
    const loadTranslations = async () => {
      const translationCache: Record<string, TranslationMap> = {}
      
      for (const loc of availableLocales) {
        try {
          const response = await fetch(`/api/i18n/strings/${loc}`)
          if (response.ok) {
            const data = await response.json()
            translationCache[loc] = data.strings || data || DEFAULT_TRANSLATIONS[loc] || {}
          } else {
            translationCache[loc] = DEFAULT_TRANSLATIONS[loc] || {}
          }
        } catch (error) {
          console.warn(`Failed to load translations for ${loc}`, error)
          translationCache[loc] = DEFAULT_TRANSLATIONS[loc] || {}
        }
      }
      
      setTranslations(translationCache)
    }

    if (config?.locales && config.locales.length > 0) {
      loadTranslations()
    } else {
      setTranslations(DEFAULT_TRANSLATIONS)
    }
  }, [config, availableLocales])

  useEffect(() => {
    const isRTL = rtlLocales.includes(locale)
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr'
    document.documentElement.lang = locale
    localStorage.setItem('locale', locale)
  }, [locale, rtlLocales])

  const setLocale = (newLocale: string) => {
    if (availableLocales.includes(newLocale)) {
      setLocaleState(newLocale)
    }
  }

  const t = (key: string, fallback?: string): string => {
    const localeTranslations = translations[locale] || {}
    const fallbackTranslations = translations[fallbackLocale] || {}
    
    return localeTranslations[key] || 
           fallbackTranslations[key] || 
           fallback || 
           key
  }

  const isRTL = rtlLocales.includes(locale)

  return (
    <LocaleContext.Provider 
      value={{ 
        locale, 
        locales: availableLocales, 
        rtlLocales,
        setLocale, 
        t,
        isRTL
      }}
    >
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  const context = useContext(LocaleContext)
  if (!context) {
    return {
      locale: 'en',
      locales: ['en'],
      rtlLocales: [],
      setLocale: () => {},
      t: (key: string, fallback?: string) => fallback || key,
      isRTL: false
    }
  }
  return context
}