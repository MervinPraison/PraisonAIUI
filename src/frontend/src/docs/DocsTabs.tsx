// Docs tabs: <Tabs>, <CodeGroup> and MkDocs `=== "Label"` all render here
// (the tab strip itself is MkdocsTabs). Tabs sync by title: picking "pnpm"
// or "macOS" shows that tab in every set on the page that has it, and the
// pick is remembered (localStorage), so later pages open on it too.
// `sync={false}` keeps a set to itself. A dropdown code group picks its file
// from a menu, loaded only when a page has one.
import { Children, isValidElement, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import { MkdocsTabs } from '../markdown/MkdocsBlocks'
import { DocsHomeIcon } from './docsHomeIcons'
import { chosenTab, NONE, pickTab, snapshot, subscribe, TOC_REFRESH } from './tabSync'

const TabsSelect = lazy(() => import('./TabsSelect'))

type TabProps = { title?: string; icon?: string; anchor?: string; children?: ReactNode }
type TabsProps = { children?: ReactNode; sync?: string; initial?: string; rule?: string; variant?: string }

const isTab = (c: ReactNode): c is ReactElement<TabProps> => isValidElement<TabProps>(c) && typeof c.props.title === 'string'

function TabLabel({ title, icon, anchor }: TabProps) {
    return (
        <>
            {icon && <DocsHomeIcon name={icon} className="aiui-tab-icon" />}
            <span id={anchor} className="aiui-tab-label">{title}</span>
        </>
    )
}

export function DocsTabs({ children, sync, initial, rule, variant }: TabsProps) {
    const tabs = Children.toArray(children).filter(isTab)
    const titles = tabs.map((t) => t.props.title!)
    const synced = sync !== 'off'
    const stored = useSyncExternalStore(subscribe, snapshot, () => NONE)
    const [own, setOwn] = useState<number | null>(null)
    const start = Number.parseInt(initial ?? '', 10)
    const active = !synced && own !== null ? own : chosenTab(titles, synced ? stored : NONE, Number.isNaN(start) ? undefined : start)
    const select = (i: number) => (synced ? pickTab(titles[i]) : setOwn(i))

    const shown = useRef(active)
    useEffect(() => {
        if (shown.current === active) return
        shown.current = active
        window.dispatchEvent(new Event(TOC_REFRESH))
    }, [active])

    const cls = rule === 'bottom' ? 'aiui-tabs-rule' : undefined
    if (variant === 'dropdown' && tabs.length) {
        return (
            <div className={`aiui-tabs my-4 min-w-0 ${cls ?? ''}`} data-aiui-tabs="" data-variant="dropdown">
                <div className="aiui-tabs-picker">
                    <Suspense fallback={<span className="aiui-tabs-picker-fallback">{titles[active]}</span>}>
                        <TabsSelect titles={titles} value={active} onChange={select} />
                    </Suspense>
                </div>
                {tabs.map((t, i) => (
                    <div key={i} className="aiui-tabs-panel" data-title={t.props.title} hidden={i !== active}>{t.props.children}</div>
                ))}
            </div>
        )
    }
    return (
        <MkdocsTabs value={active} onValueChange={select} className={cls} label={(t) => <TabLabel {...t.props} />}>
            {children}
        </MkdocsTabs>
    )
}
