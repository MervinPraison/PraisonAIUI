/**
 * Find the nav page a URL names when its letter case is wrong
 * (`/docs/API/sessions` for `/docs/api/sessions`). Static hosts match file
 * names exactly, so such a URL lands on the app's 404 page; the app finds the
 * page here and moves to its own URL (App.tsx, `history.replaceState`).
 *
 * Only an unambiguous match counts: when two pages differ by case alone, the
 * URL is left alone (not found) rather than guessed.
 */
import type { NavItem } from '../types'
import { normalizeDocPath } from '../pathUtils'

/** The one nav item whose path equals `path` ignoring case, else null. */
export function findNavItemIgnoringCase(items: NavItem[] | undefined, path: string): NavItem | null {
    const target = normalizeDocPath(path).toLowerCase()
    let found: NavItem | null = null
    const walk = (list: NavItem[]): boolean => {
        for (const item of list) {
            if (item.path && normalizeDocPath(item.path).toLowerCase() === target) {
                if (found && found.path !== item.path) return false // ambiguous
                found = item
            }
            if (item.children && !walk(item.children)) return false
        }
        return true
    }
    return walk(items ?? []) ? found : null
}
