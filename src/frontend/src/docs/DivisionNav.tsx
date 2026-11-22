// Header tabs and tab menus, the sidebar's dropdown switcher and anchors, and
// the phone drawer's tabs (navDivisions.ts). Styles: docs/docs.css (.aiui-docs-tab,
// .aiui-docs-switcher, .aiui-docs-anchor, .aiui-docs-menu).
import { Suspense, lazy, useState, type ComponentProps, type ReactNode } from 'react'
import { ChevronDown, Languages } from 'virtual:aiui-icons/inline'
import type { DivisionLink, NavDivisions } from './navDivisions'
import { canonicalDocPath } from './docSource'
import { docsIcon } from './docsHomeIcons'
import { isExternal } from './chrome'
import { withBase } from '../lib/url'

const NavMenu = lazy(() => import('./NavMenu'))

interface AnchorProps extends Omit<ComponentProps<'a'>, 'href'> {
    link: DivisionLink
    divisions: NavDivisions
    className?: string
    stay?: boolean // the phone drawer: a click swaps the sidebar instead of opening a page
    describe?: boolean // show the description under the name (menus, the switcher)
}

/** A division as a link: out to its `href`, or in place to its first page (a menu item passes its own props). */
export function DivisionAnchor({ link, divisions, stay, describe, onClick, ...props }: AnchorProps) {
    const external = !!link.href && isExternal(link.href)
    const href = link.href ?? (link.page ? withBase(canonicalDocPath(link.page.path || '/')) : '#')
    return (
        <a
            {...props}
            href={href}
            data-active={link.active ? '' : undefined}
            aria-current={link.active ? 'true' : undefined}
            target={external ? '_blank' : undefined}
            lang={link.lang}
            hrefLang={link.lang}
            rel={external ? 'noopener noreferrer' : undefined}
            onClick={(event) => {
                onClick?.(event)
                if (link.href || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                event.preventDefault()
                divisions.open(link, stay)
            }}
        >
            {docsIcon(link.icon, 'aiui-docs-divicon')}
            <span className="aiui-docs-divtext">
                <span>{link.name}</span>
                {describe && link.description && <small>{link.description}</small>}
            </span>
            {link.tag && <span className="aiui-docs-navtag">{link.tag}</span>}
            {external && docsIcon('arrow-up-right', 'aiui-docs-navext')}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
        </a>
    )
}

interface MenuProps extends Omit<AnchorProps, 'link' | 'className' | 'describe'> {
    items: DivisionLink[]
    className: string
    active?: boolean
    children: ReactNode
}

/** A button that opens a menu of divisions (a tab's `menu`, the dropdowns). */
export function DivisionMenu({ items, divisions, stay, className, active, children }: MenuProps) {
    // A click before the menu chunk arrives opens the menu once it does.
    const [early, setEarly] = useState(false)
    const trigger = (onClick?: () => void) => (
        <button type="button" className={className} data-active={active ? '' : undefined} aria-haspopup="menu" onClick={onClick}>
            {children}
            <ChevronDown className="aiui-docs-menuchev" aria-hidden="true" />
        </button>
    )
    return (
        <Suspense fallback={trigger(() => setEarly(true))}>
            <NavMenu trigger={trigger()} items={items} defaultOpen={early}
                render={(link) => <DivisionAnchor link={link} divisions={divisions} stay={stay} className="aiui-docs-menuitem" describe />} />
        </Suspense>
    )
}

/** The header's tabs: a link per tab, a menu button for a tab with `menu`. */
export function HeaderTabs({ divisions }: { divisions: NavDivisions }) {
    return (
        <nav className="aiui-docs-tabs" aria-label="Documentation sections">
            {divisions.tabs.map((tab) =>
                tab.menu?.length ? (
                    <DivisionMenu key={tab.key} items={tab.menu} divisions={divisions} className="aiui-docs-tab" active={tab.active}>
                        {docsIcon(tab.icon, 'aiui-docs-divicon')}
                        {tab.name}
                    </DivisionMenu>
                ) : (
                    <DivisionAnchor key={tab.key} link={tab} divisions={divisions} className="aiui-docs-tab" />
                ),
            )}
        </nav>
    )
}

/** The header's language switcher (docs/languages.ts): each entry opens the same page in that language. */
export function LanguageSwitcher({ divisions }: { divisions: NavDivisions }) {
    const items = divisions.languages ?? []
    const current = items.find((l) => l.active)
    if (items.length < 2 || !current) return null
    return (
        <DivisionMenu items={items} divisions={divisions} className="aiui-docs-lang">
            <Languages className="aiui-docs-divicon" aria-hidden="true" />
            <span className="sr-only">Language: </span>
            <span className="aiui-docs-langname" lang={current.lang}>{current.name}</span>
        </DivisionMenu>
    )
}

/** Above the sidebar tree: the version switcher, the dropdown switcher and the anchors; in the drawer, the tabs and the open tab's menu first. */
export function SidebarDivisions({ divisions, drawer }: { divisions: NavDivisions; drawer?: boolean }) {
    const { tabs, anchors, dropdowns, versions = [] } = divisions
    const current = dropdowns.find((d) => d.active) ?? dropdowns[0]
    const version = versions.find((v) => v.active)
    const menu = drawer ? (tabs.find((t) => t.active)?.menu ?? []) : []
    if (!anchors.length && !dropdowns.length && !version && !(drawer && tabs.length)) return null
    const row = (link: DivisionLink) => (
        <DivisionAnchor key={link.key} link={link} divisions={divisions} stay={drawer} className="aiui-docs-navitem aiui-docs-anchor" />
    )
    return (
        <div className="aiui-docs-divisions">
            {drawer && tabs.length > 1 && (
                <div className="aiui-docs-drawer-tabs" role="group" aria-label="Documentation sections">
                    {tabs.map((tab) => <DivisionAnchor key={tab.key} link={tab} divisions={divisions} stay />)}
                </div>
            )}
            {version && (
                // Each entry opens the same page in that version (else its first page).
                <DivisionMenu items={versions} divisions={divisions} className="aiui-docs-switcher aiui-docs-version" active>
                    <span className="sr-only">Version </span>
                    <span className="aiui-docs-divtext"><span>{version.name}</span></span>
                    {version.tag && <span className="aiui-docs-navtag">{version.tag}</span>}
                </DivisionMenu>
            )}
            {menu.length > 0 && <nav className="aiui-docs-anchors" aria-label="Section menu">{menu.map(row)}</nav>}
            {current && (
                <DivisionMenu items={dropdowns} divisions={divisions} stay={drawer} className="aiui-docs-switcher" active>
                    {docsIcon(current.icon, 'aiui-docs-divicon')}
                    <span className="aiui-docs-divtext">
                        <span>{current.name}</span>
                        {current.description && <small>{current.description}</small>}
                    </span>
                </DivisionMenu>
            )}
            {anchors.length > 0 && <nav className="aiui-docs-anchors" aria-label="Anchors">{anchors.map(row)}</nav>}
        </div>
    )
}
