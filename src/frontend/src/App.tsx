import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { applyTheme, applyStoredThemePreference, defaultThemeMode } from './themes'
import type { UIConfig, DocsNav, RouteManifest, NavItem } from './types'
import { Header } from './Header'
import { DocsBanner } from './docs/DocsBanner'
import { Sidebar, MobileNavSheet } from './Sidebar'
import { Content } from './Content'
import { ZoneWidgets } from './Widgets'
import { Toc } from './Toc'
import { modeHidesToc } from './docs/pageHead'
import { Footer } from './Footer'
import { LocaleProvider } from './i18n'
import { resolveTemplate, shouldShowToc } from './resolver'
import { normalizeDocPath } from './pathUtils'
import { filterNavByTab } from './docs/navTabs'
import { activeSection, divisionLinks, navSections, type DivisionLink, type NavDivisions } from './docs/navDivisions'
import { versionAt, versionItems, versionLinks, versionNavigation } from './docs/versions'
import { docSearchGroups } from './docs/docNav'
import { applyHeadTags, mergeTags, pageUrl, robotsContent } from './docs/seoMeta'
import { canonicalDocPath, docPathAliases } from './docs/docSource'
import { scrollToHash, useHashScroll } from './docs/hashScroll'
import { useHeadingAnchors } from './docs/headingAnchors'
import { useImageZoom } from './docs/imageZoom'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { fetchWithRetry, prefetchInitialDoc } from './docs/docLoader'
import { appPathname, stripBase, withBase } from './lib/url'
import { AskSelection } from './docs/AskSelection'
import { ASK_EVENT, askEndpoint } from './docs/askEntry'
import type { AskRequest } from './docs/AskAi'
import './docs/docs.css'

// The chat, agents and playground styles and the copilot widget load only for
// the style that shows them (R4): a docs site never downloads their code.
const ChatLayout = lazy(() => import('./layouts/ChatLayout').then((m) => ({ default: m.ChatLayout })))
const AgentUILayout = lazy(() => import('./layouts/AgentUILayout').then((m) => ({ default: m.AgentUILayout })))
const PlaygroundLayout = lazy(() => import('./layouts/PlaygroundLayout').then((m) => ({ default: m.PlaygroundLayout })))
const CopilotWidget = lazy(() => import('./layouts/CopilotWidget').then((m) => ({ default: m.CopilotWidget })))

/** While a style's layout chunk loads: the same spinner as the manifests' load. */
function StyleLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner tone="muted" />
    </div>
  )
}

const DocsSearch = lazy(() => import('./docs/DocsSearch'))
const AskAi = lazy(() => import('./docs/AskAi'))

/** Styles that render the docs chrome (header, nav, article, footer). */
const DOCS_CHROME_STYLES = new Set(['docs', 'custom'])

/** Theme presets that are a look of the Pro tokens (styles/paper.css), not only a colour. */
const DOCS_LOOKS = new Set(['paper'])

/**
 * The docs site draws in the PraisonAI Pro tokens: <html data-aiui-docs
 * data-aiui-tokens="pro"> switches styles/pro.css on (imported through
 * docs/docs.css). Preset `paper` adds data-aiui-look="paper" (paper.css,
 * DESIGN.md "Looks"). The chat, agents and playground styles keep the
 * classic tokens.
 */
function useDocsTokens(active: boolean, preset?: string) {
    const look = preset && DOCS_LOOKS.has(preset) ? preset : null
    useEffect(() => {
        if (!active) return
        const html = document.documentElement
        // The attributes proTokens.setTokenSystem('pro') and the shell's
        // layout host write. Not imported: proTokens.ts lives in the shell's
        // boot chunk, and a module the legacy App shared with it would move
        // into a shared boot chunk.
        html.setAttribute('data-aiui-docs', '')
        html.setAttribute('data-aiui-tokens', 'pro')
        if (look) html.setAttribute('data-aiui-look', look)
        return () => {
            html.removeAttribute('data-aiui-docs')
            html.removeAttribute('data-aiui-tokens')
            if (look) html.removeAttribute('data-aiui-look')
        }
    }, [active, look])
}

function SkipLink({ enabled }: { enabled?: boolean }) {
  if (!enabled) return null
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium"
    >
      Skip to main content
    </a>
  )
}

export default function App() {
  const [config, setConfig] = useState<UIConfig>({})
  const [nav, setNav] = useState<DocsNav>({})
  const [routes, setRoutes] = useState<RouteManifest>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manifestAttempt, setManifestAttempt] = useState(0)
  const [selectedItem, setSelectedItem] = useState<NavItem | null>(null)
  const [activeItemPath, setActiveItemPath] = useState<string>('')
  const [currentPath, setCurrentPath] = useState(() => canonicalDocPath(appPathname()))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeTabIndex, setActiveTabIndex] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMounted, setSearchMounted] = useState(false)

  // Versions (docs/versions.ts): the sidebar, tabs and search show the open version's pages only.
  const versions = config.navigation?.versions ?? []
  const version = versionAt(versions, currentPath)
  const navigation = useMemo(() => versionNavigation(config.navigation, version), [config.navigation, version])
  const versionNav = useMemo<DocsNav>(
    () => (version < 0 ? nav : { ...nav, items: versionItems(nav.items ?? [], config.navigation?.versions ?? [], version) }),
    [nav, config.navigation, version],
  )
  // Tabs, tab menu items, anchors and dropdowns with groups: each has its own sidebar (docs/navDivisions.ts).
  const sections = useMemo(() => navSections(navigation), [navigation])
  const pickedSection = useRef(-1)
  const docsStyle = !loading && !error && DOCS_CHROME_STYLES.has(config.style || 'docs')
  useDocsTokens(docsStyle, config.site?.theme?.preset)
  useHashScroll(docsStyle)
  useHeadingAnchors(docsStyle)
  useImageZoom(docsStyle)
  const searchGroups = useMemo(() => docSearchGroups(versionNav, sections), [versionNav, sections])
  const searchEnabled = docsStyle && config.search?.enabled !== false && (nav.items?.length ?? 0) > 0
  // A shared `?q=` link opens search prefilled (DocsSearch keeps `?q=` in step with the field).
  const [deepLinkQuery] = useState(() => new URLSearchParams(window.location.search).get('q')?.trim() ?? '')
  const deepLinkOpened = useRef(false)

  // "Search docs" and ⌘K / Ctrl+K: a page listening for `aiui:search-open`
  // (custom JS with its own search) can call preventDefault to take over.
  const openSearch = () => {
    const event = new CustomEvent('aiui:search-open', { cancelable: true })
    if (!window.dispatchEvent(event)) return
    setSearchMounted(true)
    setSearchOpen(true)
  }
  useEffect(() => {
    if (!searchEnabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    if (!searchEnabled || !deepLinkQuery || deepLinkOpened.current) return
    deepLinkOpened.current = true
    openSearch()
  }, [searchEnabled, deepLinkQuery])

  // Ask AI (docs/AskAi.tsx): the header button, ⌘I / Ctrl+I, `?assistant=<question>`,
  // "Ask about this" on a selected passage, search's "Ask AI" row and the `aiui:docs-ask`
  // event ({ question?, context? }) custom JS can send. Shown when `aiui serve` has a model
  // (`assistant.ai`) or a static host names a server (`assistant.endpoint`).
  const assistant = docsStyle && config.assistant ? config.assistant : null
  const askUrl = askEndpoint(assistant)
  const [askOpen, setAskOpen] = useState(false)
  const [askMounted, setAskMounted] = useState(false)
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null)
  const openAsk = (detail?: { question?: string; context?: string }) => {
    if (detail?.question || detail?.context) setAskRequest({ ...detail, nonce: Date.now() })
    setAskMounted(true)
    setAskOpen(true)
  }
  useEffect(() => {
    if (!askUrl) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'i' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        openAsk()
      }
    }
    const onAsk = (event: Event) => openAsk((event as CustomEvent).detail ?? undefined)
    window.addEventListener('keydown', onKey)
    window.addEventListener(ASK_EVENT, onAsk)
    // A `?assistant=<question>` link opens Ask AI and asks it; the parameter leaves the address bar.
    const url = new URL(window.location.href)
    const question = url.searchParams.get('assistant')
    if (question !== null) {
      url.searchParams.delete('assistant')
      window.history.replaceState(window.history.state, '', url)
      openAsk(question.trim() ? { question: question.trim().slice(0, 2000) } : undefined)
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(ASK_EVENT, onAsk)
    }
  }, [askUrl])

  const filteredNav = useMemo<DocsNav>(() => {
    if (!sections.length) return versionNav
    return { ...versionNav, items: filterNavByTab(versionNav.items ?? [], sections[activeTabIndex]) }
  }, [versionNav, sections, activeTabIndex])

  useEffect(() => {
    if (!sections.length) return
    setActiveTabIndex(activeSection(versionNav.items ?? [], sections, currentPath, pickedSection.current))
  }, [currentPath, sections, versionNav])

  // Helper function to find nav item by path (searches top-level items and nested children)
  const findNavItemByPath = (navData: DocsNav, path: string): NavItem | null => {
    const normalizedPath = normalizeDocPath(path)

    const findItem = (items: NavItem[], target: string): NavItem | null => {
      for (const item of items) {
        // A section (a YAML group in manual nav) has no path and is never a page.
        if (item.path && normalizeDocPath(item.path) === target) {
          return item
        }
        if (item.children) {
          const found = findItem(item.children, target)
          if (found) return found
        }
      }
      return null
    }

    if (!navData.items) return null
    // Else a URL that names the page another way: by its file (`/docs/adr/0001-x`,
    // `/docs/guide/index`) or without the docs base (`/getting-started/x`).
    for (const target of [normalizedPath, ...docPathAliases(normalizedPath)]) {
      const found = findItem(navData.items, target)
      if (found) return found
    }
    return null
  }

  // The public URL of an app path. The build writes seo.siteUrl with the base path in it.
  const seoUrl = (cfg: UIConfig, path: string) =>
    cfg.seo?.siteUrl ? `${cfg.seo.siteUrl.replace(/\/+$/, '')}${path}` : `${window.location.origin}${withBase(path)}`

  const formatSeoTitle = (title: string, cfg: UIConfig) => {
    const titleTemplate = cfg.seo?.titleTemplate || '%s | %s'
    const siteName = cfg.site?.title || 'Documentation'
    if (titleTemplate.includes('%s')) {
      let formattedTitle = titleTemplate.replace('%s', title)
      if (formattedTitle.includes('%s')) {
        formattedTitle = formattedTitle.replace('%s', siteName)
      }
      return formattedTitle
    }
    return `${title} | ${siteName}`
  }

  const updateSEO = (
    title: string,
    path: string,
    description?: string,
    configOverride?: UIConfig,
    page?: Pick<NavItem, 'noindex' | 'seo'>,
  ) => {
    const cfg = configOverride ?? config
    const canonicalPath = canonicalDocPath(path)
    // The home page (the site root) is titled by the site name alone, as the built index.html is.
    const formattedTitle = canonicalPath === '/' && cfg.site?.title ? cfg.site.title : formatSeoTitle(title, cfg)
    const metaDescription = description || `${title} - ${cfg.site?.description || ''}`
    const siteName = cfg.site?.title || 'Documentation'
    const image = cfg.seo?.defaultImage
    document.title = formattedTitle

    // The same tags, in the same order of precedence, as compiler/seo.py writes into the built page.
    const tags = mergeTags(
      {
        canonical: pageUrl('', seoUrl(cfg, canonicalPath), cfg.seo),
        description: metaDescription,
        robots: robotsContent(page?.noindex, cfg.seo?.robots),
        'og:title': formattedTitle,
        'og:description': metaDescription,
        'og:type': 'article',
        'og:site_name': siteName,
        'twitter:title': formattedTitle,
        'twitter:description': metaDescription,
        ...(image ? { 'og:image': image.startsWith('http') ? image : seoUrl(cfg, image) } : {}),
        ...(cfg.seo?.twitter?.handle ? { 'twitter:site': cfg.seo.twitter.handle } : {}),
      },
      { ...cfg.seo?.metatags, ...page?.seo },
      (p) => seoUrl(cfg, p),
    )
    applyHeadTags(document, tags)

    // The built page's JSON-LD graph (Organization, breadcrumbs, ...) stays while it is the page shown.
    let jsonLd = document.querySelector('script#aiui-jsonld') as HTMLScriptElement | null
    if (!jsonLd) {
      jsonLd = document.createElement('script')
      jsonLd.type = 'application/ld+json'
      jsonLd.id = 'aiui-jsonld'
      document.head.appendChild(jsonLd)
    }
    if (jsonLd.dataset.page === tags.canonical) return
    jsonLd.dataset.page = tags.canonical
    jsonLd.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description: metaDescription,
      url: tags.canonical,
      isPartOf: { '@type': 'WebSite', name: siteName, url: seoUrl(cfg, '/') },
    })
  }

  const selectNavItem = (item: NavItem) => {
    const path = canonicalDocPath(item.path || '/')
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    updateSEO(item.pageTitle ?? item.title, path, item.description, undefined, item)
  }

  // Keep React nav state in sync when plugins perform SPA navigation
  useEffect(() => {
    const onPluginNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      const path = canonicalDocPath(detail?.path ?? appPathname())
      setCurrentPath(path)
      setMobileNavOpen(false)

      const found = findNavItemByPath(nav, path)
      if (found) {
        selectNavItem(found)
        return
      }

      if (path === '/') {
        const docsHome = findNavItemByPath(nav, '/docs/index')
        if (docsHome) {
          selectNavItem(docsHome)
        }
      }
    }

    window.addEventListener('aiui:navigate', onPluginNavigate)
    return () => window.removeEventListener('aiui:navigate', onPluginNavigate)
  }, [nav, config])

  useEffect(() => {
    async function loadManifests() {
      // A deep link's page starts loading now, alongside the manifests (one round trip saved).
      prefetchInitialDoc()
      try {
        // Time limit per attempt and a fresh request on timeout (docs/docLoader.ts).
        const [configRes, navRes, routesRes] = await Promise.all(
          ['/ui-config.json', '/docs-nav.json', '/route-manifest.json'].map((url) => fetchWithRetry(url)),
        )

        if (!configRes.ok || !navRes.ok || !routesRes.ok) {
          throw new Error('Failed to load manifests')
        }

        const configData = JSON.parse(configRes.text)
        const navData = JSON.parse(navRes.text)
        setConfig(configData)
        setNav(navData)
        setRoutes(JSON.parse(routesRes.text))

        // Apply theme from config. Colour mode: the viewer's stored choice,
        // else the app's (set_theme / YAML), else the OS (mode 'system').
        const theme = configData.site?.theme
        const mode = defaultThemeMode(theme)
        applyTheme(
          theme?.preset || 'zinc',
          mode === 'dark',
          theme?.radius || 'md'
        )
        applyStoredThemePreference(mode, theme?.strict)
        // site.theme.code / codeLanguages for the lazy highlighter (markdown/codeConfig.ts);
        // docs.css draws code panels in the theme's colours while <html> is marked.
        globalThis.__AIUI_CODE__ = { code: theme?.code, codeLanguages: theme?.codeLanguages }
        document.documentElement.toggleAttribute('data-aiui-code-theme', !!theme?.code)

        // Handle initial URL path for SPA routing
        const initialPath = canonicalDocPath(appPathname())
        setCurrentPath(initialPath)
        if (initialPath !== appPathname()) {
          window.history.replaceState(null, '', withBase(initialPath) + window.location.search + window.location.hash)
        }
        if (initialPath !== '/') {
          const found = findNavItemByPath(navData, initialPath)
          if (found) {
            // A URL found under the docs base moves to the page's own path.
            const foundPath = canonicalDocPath(found.path || initialPath)
            if (foundPath !== initialPath) {
              setCurrentPath(foundPath)
              window.history.replaceState(null, '', withBase(foundPath) + window.location.search + window.location.hash)
            }
            setSelectedItem(found)
            setActiveItemPath(found.path || found.title)
            updateSEO(found.pageTitle ?? found.title, foundPath, found.description, configData, found)
          }
        } else {
          const docsHome = findNavItemByPath(navData, '/docs/index')
          if (docsHome) {
            setSelectedItem(docsHome)
            setActiveItemPath(docsHome.path || docsHome.title)
            updateSEO(docsHome.pageTitle ?? docsHome.title, canonicalDocPath(docsHome.path || '/docs/index'), docsHome.description, configData, docsHome)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadManifests()
  }, [manifestAttempt])

  // Handle browser back/forward navigation in a separate effect
  useEffect(() => {
    const handlePopState = () => {
      const path = canonicalDocPath(appPathname())
      setCurrentPath(path)
      const found = findNavItemByPath(nav, path)
      
      if (found) {
        selectNavItem(found)
      } else if (path === '/') {
        const docsHome = findNavItemByPath(nav, '/docs/index')
        if (docsHome) {
          selectNavItem(docsHome)
        } else {
          setSelectedItem(null)
          setActiveItemPath('')
          document.title = config.site?.title || 'Documentation'
        }
      }
    }
    
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [nav, config])

  const handleItemClick = (item: NavItem) => {
    const path = canonicalDocPath(item.path || `/${item.title.toLowerCase().replace(/\s+/g, '-')}`)
    window.history.pushState({ path }, item.title, withBase(path))
    window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path } }))
  }

  // A search result: the page, at its section when it has one. Another page
  // scrolls there once its article renders (useHashScroll); this page at once.
  // The hash goes on with replaceState after the move: the legacy
  // nav-intercept plugin re-navigates a pushState to another page without it.
  const openSearchResult = (item: NavItem, anchor?: string) => openAt(canonicalDocPath(item.path || '/'), anchor, item.title)
  // A cited section in an Ask AI answer: an app href with the base path.
  const openHref = (href: string) => {
    const [path, anchor] = href.split('#')
    openAt(canonicalDocPath(stripBase(path)), anchor ? decodeURIComponent(anchor) : undefined)
  }
  const openAt = (path: string, anchor?: string, title = '') => {
    const samePage = path === currentPath
    window.history.pushState({ path }, title, withBase(path))
    window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path } }))
    if (!anchor) {
      window.scrollTo({ top: 0 })
      return
    }
    window.history.replaceState({ path }, title, `${withBase(path)}#${encodeURIComponent(anchor)}`)
    if (samePage) scrollToHash()
  }

  const openDivision = (link: DivisionLink, stay?: boolean) => {
    pickedSection.current = link.section
    if (link.page && !stay) handleItemClick(link.page)
    else if (link.section >= 0) setActiveTabIndex(link.section)
  }
  const links = useMemo(
    () => ({
      ...divisionLinks(navigation, versionNav.items ?? [], sections, sections[activeTabIndex]?.key ?? ''),
      versions: versionLinks(config.navigation?.versions ?? [], nav.items ?? [], currentPath, version),
    }),
    [navigation, config.navigation, nav, versionNav, sections, activeTabIndex, currentPath, version],
  )
  const divisions: NavDivisions = { ...links, open: openDivision }
  const searchTabs = [...new Set(sections.map((s) => s.tab))]

  const templateMatch = resolveTemplate(
    currentPath.replace(/^\//, ''),
    routes,
    config.templates ?? {},
  )
  const activeTemplateKey = templateMatch?.template ?? 'docs'
  const activeTemplate = config.templates?.[activeTemplateKey] ?? config.templates?.docs
  const layout = templateMatch?.layout ?? activeTemplate?.layout ?? 'ThreeColumnLayout'
  const zones = activeTemplate?.zones
  const showToc = shouldShowToc(templateMatch)
  const showGlobalFooter = true

  const docsChrome = (
    <>
      <DocsBanner banner={config.banner} />
      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        nav={filteredNav}
        activeItem={activeItemPath}
        onItemClick={handleItemClick}
        title={config.site?.title || 'Navigation'}
        config={config}
        templateKey={activeTemplateKey}
        divisions={divisions}
      />
      <Header
        config={config}
        templateKey={activeTemplateKey}
        onMenuClick={() => setMobileNavOpen(true)}
        divisions={divisions}
        onSearchClick={searchEnabled ? openSearch : undefined}
        onAskClick={askUrl ? () => openAsk() : undefined}
      />
      {searchMounted && (
        <Suspense fallback={null}>
          <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} groups={searchGroups} onSelect={openSearchResult} indexUrl={withBase('/search-index.json')}
            tabs={searchTabs} activeTab={sections[activeTabIndex]?.tab} initialQuery={deepLinkQuery}
            placeholder={config.search?.prompt} maxResults={config.search?.maxResults}
            onAsk={askUrl ? (question) => openAsk({ question }) : undefined} />
        </Suspense>
      )}
      {askUrl && <AskSelection onAsk={(context) => openAsk({ context })} />}
      {askUrl && askMounted && (
        <Suspense fallback={null}>
          <AskAi open={askOpen} onOpenChange={setAskOpen} url={askUrl} starters={assistant?.starters}
            request={askRequest} onNavigate={openHref} />
        </Suspense>
      )}
    </>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner tone="muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <h2 className="text-xl font-semibold">Couldn't load the docs</h2>
        <p className="text-muted-foreground">Check your connection and try again.</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null)
            setLoading(true)
            setManifestAttempt((n) => n + 1)
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  // Render based on layout type
  const renderLayout = () => {
    switch (layout) {
      case 'TwoColumnLayout':
        return (
          <div className="flex">
            <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
            <Content config={config} routes={routes} selectedItem={selectedItem} currentPath={currentPath} />
          </div>
        )
      case 'CenteredLayout':
        return (
          <div className="flex justify-center">
            <div className="w-full max-w-4xl px-6">
              {zones?.hero && zones.hero.length > 0 && <ZoneWidgets widgets={zones.hero} />}
              <Content config={config} routes={routes} selectedItem={selectedItem} currentPath={currentPath} />
            </div>
          </div>
        )
      case 'FullWidthLayout':
        return (
          <div className="flex">
            {(nav?.items?.length ?? 0) > 0 && (
              <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
            )}
            <div className="flex-1 px-6">
              {zones?.hero && zones.hero.length > 0 && <ZoneWidgets widgets={zones.hero} />}
              <Content config={config} routes={routes} selectedItem={selectedItem} currentPath={currentPath} />
            </div>
          </div>
        )
      case 'FlexibleLayout': {
        const hasExplicitLeftSidebar = (zones?.leftSidebar?.length ?? 0) > 0
        const hasNavigation = (nav?.items?.length ?? 0) > 0
        const shouldRenderNavigation = hasExplicitLeftSidebar || hasNavigation

        return (
          <div className="flex flex-col">
            {zones?.hero && zones.hero.length > 0 && <ZoneWidgets widgets={zones.hero} />}
            <div className="flex flex-1">
              {shouldRenderNavigation && (
                <aside className="w-64 border-r p-4 hidden md:block">
                  {hasExplicitLeftSidebar ? (
                    <ZoneWidgets widgets={zones?.leftSidebar} />
                  ) : (
                    <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
                  )}
                </aside>
              )}
              <div className="flex-1">
                <Content config={config} routes={routes} selectedItem={selectedItem} currentPath={currentPath} />
              </div>
              <Toc selectedItem={selectedItem} zones={zones} showToc={showToc} />
            </div>
            {zones?.bottomNav && zones.bottomNav.length > 0 && (
              <div className="border-t p-4 bg-muted/30">
                <ZoneWidgets widgets={zones.bottomNav} />
              </div>
            )}
            {zones?.footer && zones.footer.length > 0 && (
              <div className="border-t p-4 bg-muted/50">
                <ZoneWidgets widgets={zones.footer} />
              </div>
            )}
          </div>
        )
      }
      case 'ThreeColumnLayout':
      default:
        return (
          // Frontmatter `mode` (docs/pageHead.ts): docs.css drops the sidebar for center and custom.
          <div className="aiui-docs-shell docs-shell" data-mode={selectedItem?.mode}>
            <Sidebar nav={filteredNav} activeItem={activeItemPath} onItemClick={handleItemClick} divisions={divisions} />
            <Content
              config={config}
              routes={routes}
              selectedItem={selectedItem}
              currentPath={currentPath}
              nav={filteredNav}
              onNavigate={handleItemClick}
              onSearch={searchEnabled ? openSearch : undefined}
            />
            {showToc && !modeHidesToc(selectedItem?.mode) && <Toc selectedItem={selectedItem} zones={zones} showToc={showToc} />}
          </div>
        )
    }
  }

  // Render based on style from config
  const renderByStyle = () => {
    const style = config.style || 'docs'

    switch (style) {
      case 'chat':
        return (
          <ChatLayout
            config={config.chat}
            layout={config.layout}
            title={config.site?.title}
          />
        )
      case 'agents':
        return (
          <AgentUILayout
            config={config.chat}
            title={config.site?.title}
          />
        )
      case 'playground':
        // Playground mode - input/output panels
        return (
          <PlaygroundLayout
            config={config.chat}
            title={config.site?.title}
          />
        )
      case 'dashboard':
        // Dashboard is handled entirely by plugin dashboard.js — React yields
        return null
      case 'custom':
        if (config.chat?.enabled) {
          return (
            <div className="aiui-docs">
              <SkipLink enabled={config.a11y?.skipToContent} />
              {docsChrome}
              {renderLayout()}
              {showGlobalFooter && <Footer config={config} templateKey={activeTemplateKey} />}
              <Suspense fallback={null}><CopilotWidget config={config.chat} layout={config.layout} /></Suspense>
            </div>
          )
        }
        return (
          <div className="aiui-docs">
            <SkipLink enabled={config.a11y?.skipToContent} />
            {docsChrome}
            {renderLayout()}
            {showGlobalFooter && <Footer config={config} templateKey={activeTemplateKey} />}
          </div>
        )
      case 'docs':
      default:
        if (config.chat?.enabled) {
          const layoutMode = config.layout?.mode
          if (layoutMode && ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(layoutMode)) {
            return (
              <div className="aiui-docs">
                <SkipLink enabled={config.a11y?.skipToContent} />
                {docsChrome}
                {renderLayout()}
                {showGlobalFooter && <Footer config={config} templateKey={activeTemplateKey} />}
                <Suspense fallback={null}><CopilotWidget config={config.chat} layout={config.layout} /></Suspense>
              </div>
            )
          }
        }
        return (
          <div className="aiui-docs">
            <SkipLink enabled={config.a11y?.skipToContent} />
            {docsChrome}
            {renderLayout()}
            {showGlobalFooter && <Footer config={config} templateKey={activeTemplateKey} />}
          </div>
        )
    }
  }

  return (
    <LocaleProvider config={config.i18n}>
      <Suspense fallback={<StyleLoading />}>{renderByStyle()}</Suspense>
    </LocaleProvider>
  )
}
