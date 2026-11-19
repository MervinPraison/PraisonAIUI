/**
 * Content languages (ui-config `navigation.languages`, docs/features/navigation.md#languages;
 * built by compiler/languages.py). The default language is served at the docs root and every
 * other one from its folder: `/docs/fr/...`, and inside a version `/docs/v1/fr/...`. The
 * sidebar, pager and search show the open language only; the header switcher keeps the page.
 */
import type { NavDivision, NavItem, NavLanguage } from '../types'
import type { DivisionLink } from './navDivisions'
import { docPages } from './docNav'
import { firstPath, versionAt } from './versions'

const clean = (path: string) => (path || '/').replace(/\/+$/, '') || '/'
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
/** A folder's page by either name: `/docs/fr` and `/docs/fr/index`. */
const same = (a: string, b: string) => clean(a).replace(/\/index$/, '') === clean(b).replace(/\/index$/, '')

/** `path` as its version's root (`/docs`, `/docs/v1`), its language's index and the rest (`/guide`). */
export function languageSplit(languages: NavLanguage[], versions: NavDivision[], path: string) {
    const p = clean(path) === '/' ? '' : clean(path)
    const base = languages.find((l) => l.default)?.prefix ?? ''
    const root = versions[versionAt(versions, p || base)]?.prefix ?? base
    const rest = under(p, root) ? p.slice(root.length) : ''
    const at = languages.findIndex((l) => !!l.folder && under(rest, `/${l.folder}`))
    if (at >= 0) return { root, index: at, rest: rest.slice(languages[at].folder.length + 1) }
    return { root, index: languages.findIndex((l) => l.default), rest }
}

/** The index of the language `path` is in (-1: no languages). */
export const languageAt = (languages: NavLanguage[], versions: NavDivision[], path: string) =>
    languages.length ? languageSplit(languages, versions, path).index : -1

/** The sidebar entries of language `index` (an entry with no page, such as a link, goes with the default). */
export function languageItems(items: NavItem[], languages: NavLanguage[], versions: NavDivision[], index: number): NavItem[] {
    if (index < 0) return items
    return items.filter((item) => languageAt(languages, versions, firstPath(item) ?? '/') === index)
}

/** The language's name: its `name`, else its own name for itself (`fr`: Français). */
export function languageName(lang: NavLanguage): string {
    if (lang.name) return lang.name
    try {
        const own = new Intl.DisplayNames([lang.language], { type: 'language' }).of(lang.language)
        if (own && own.toLowerCase() !== lang.language.toLowerCase()) return own.charAt(0).toLocaleUpperCase(lang.language) + own.slice(1)
    } catch {
        // an engine without Intl.DisplayNames: the code
    }
    return lang.language
}

/** The switcher's entries: each language opens the page at the same path in it, else its first page. */
export function languageLinks(languages: NavLanguage[], versions: NavDivision[], items: NavItem[], path: string): DivisionLink[] {
    const { root, index, rest } = languageSplit(languages, versions, path)
    return languages.flatMap((l, i) => {
        if (l.hidden && i !== index) return []
        const pages = docPages({ items: languageItems(items, languages, versions, i) })
        const target = `${root}${l.folder ? `/${l.folder}` : ''}${rest}`
        const page = pages.find((p) => same(p.path ?? '', target)) ?? pages[0]
        if (!page && i !== index) return []
        return [{ key: `lang:${l.language}`, name: languageName(l), lang: l.language, page, section: -1, active: i === index }]
    })
}

// The reader's pick in the switcher (blocked storage: no pick is kept).
const KEY = 'aiui-docs-language'
const storage = <T,>(run: (s: Storage) => T): T | null => {
    try {
        return run(localStorage)
    } catch {
        return null
    }
}
export const storedLanguage = () => storage((s) => s.getItem(KEY))
export const rememberLanguage = (code: string) => storage((s) => s.setItem(KEY, code))

export interface BrowserLanguages {
    languages?: readonly string[]
    webdriver?: boolean
    userAgent?: string
}
const BOT = /bot|crawl|spider|slurp|preview|lighthouse/i

/** The language a reader prefers: their earlier pick, else the first browser language the docs have
 *  (`fr-CA` finds `fr`, `pt` finds `pt-BR`); -1 for none, and always for crawlers and automation. */
export function preferredLanguage(languages: NavLanguage[], browser: BrowserLanguages, stored: string | null): number {
    if (!browser.languages?.length || browser.webdriver || BOT.test(browser.userAgent ?? '')) return -1
    const shown = (test: (code: string) => boolean) => languages.findIndex((l) => !l.hidden && test(l.language.toLowerCase()))
    if (stored) return shown((code) => code === stored.toLowerCase())
    for (const tag of browser.languages.map((t) => t.toLowerCase())) {
        const base = tag.split('-')[0]
        const i = [(c: string) => c === tag, (c: string) => c === base, (c: string) => c.split('-')[0] === base]
            .map(shown).find((n) => n >= 0)
        if (i !== undefined) return i
    }
    return -1
}

/** On a visit to the docs home in the default language, the page to open instead: the home of the
 *  reader's language (preferredLanguage), else undefined (stay). */
export function autoRoute(
    languages: NavLanguage[], versions: NavDivision[], items: NavItem[], path: string,
    browser: BrowserLanguages, stored: string | null,
): NavItem | undefined {
    const { root, index, rest } = languageSplit(languages, versions, path)
    const docs = clean(path) === '/' || under(clean(path), root)
    const home = docs && (!rest || rest === '/index') && (!versions.length || versions[versionAt(versions, path)]?.default)
    if (!home || !languages[index]?.default) return undefined
    const target = preferredLanguage(languages, browser, stored)
    if (target < 0 || target === index) return undefined
    return languageLinks(languages, versions, items, path).find((l) => l.key === `lang:${languages[target].language}`)?.page
}
