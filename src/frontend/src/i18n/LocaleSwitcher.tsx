import { useLocale } from './LocaleProvider'

export function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLocale()

  // Don't show switcher if only one locale
  if (locales.length <= 1) {
    return null
  }

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      className="px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
      aria-label="Language"
    >
      {locales.map((loc) => (
        <option key={loc} value={loc}>
          {loc.toUpperCase()}
        </option>
      ))}
    </select>
  )
}