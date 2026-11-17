import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { applyTheme, applyStoredThemePreference, defaultThemeMode } from './themes'
import type { UIConfig, DocsNav, RouteManifest, NavItem } from './types'
import { Header } from './Header'
import { Sidebar, MobileNavSheet } from './Sidebar'
import { Content } from './Content'
import { ZoneWidgets } from './Widgets'
import { Toc } from './Toc'
import { Footer } from './Footer'
import { LocaleProvider } from './i18n'
import { resolveTemplate, shouldShowToc } from './resolver'
import { normalizeDocPath } from './pathUtils'
import { detectActiveTabIndex, filterNavByTab } from './docs/navTabs'
import { docSearchGroups } from './docs/docNav'
import { canonicalDocPath, docPathAliases } from './docs/docSource'
import { scrollToHash, useHashScroll } from './docs/hashScroll'
import { useHeadingAnchors } from './docs/headingAnchors'
import { useImageZoom } from './docs/imageZoom'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { fetchWithRetry, prefetchInitialDoc } from './docs/docLoader'
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
  const [currentPath, setCurrentPath] = useState(() => canonicalDocPath(window.location.pathname))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeTabIndex, setActiveTabIndex] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMounted, setSearchMounted] = useState(false)

  const navTabs = config.navigation?.tabs ?? []
  const docsStyle = !loading && !error && DOCS_CHROME_STYLES.has(config.style || 'docs')
  useDocsTokens(docsStyle, config.site?.theme?.preset)
  useHashScroll(docsStyle)
  useHeadingAnchors(docsStyle)
  useImageZoom(docsStyle)
  const searchGroups = useMemo(() => docSearchGroups(nav), [nav])
  const searchEnabled = docsStyle && config.search?.enabled !== false && (nav.items?.length ?? 0) > 0

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
  const filteredNav = useMemo<DocsNav>(() => {
    if (!navTabs.length) return nav
    return { items: filterNavByTab(nav.items ?? [], navTabs[activeTabIndex]) }
  }, [nav, navTabs, activeTabIndex])

  useEffect(() => {
    if (navTabs.length) {
      setActiveTabIndex(detectActiveTabIndex(navTabs, currentPath))
    }
  }, [currentPath, navTabs])

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

  const seoOrigin = (cfg: UIConfig) => (cfg.seo?.siteUrl || window.location.origin).replace(/\/+$/, '')

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
    noindex?: boolean,
  ) => {
    const cfg = configOverride ?? config
    const canonicalPath = canonicalDocPath(path)
    // The home page (the site root) is titled by the site name alone, as the built index.html is.
    const formattedTitle = canonicalPath === '/' && cfg.site?.title ? cfg.site.title : formatSeoTitle(title, cfg)
    const metaDescription = description || `${title} - ${cfg.site?.description || ''}`
    const absoluteUrl = `${seoOrigin(cfg)}${canonicalPath}`

    document.title = formattedTitle

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = absoluteUrl

    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement
    if (!metaDesc) {
      metaDesc = document.createElement('meta')
      metaDesc.name = 'description'
      document.head.appendChild(metaDesc)
    }
    metaDesc.content = metaDescription

    const ensureMeta = (selector: string, create: () => HTMLMetaElement) => {
      let el = document.querySelector(selector) as HTMLMetaElement | null
      if (!el) {
        el = create()
        document.head.appendChild(el)
      }
      return el
    }

    ensureMeta('meta[name="robots"]', () => {
      const el = document.createElement('meta')
      el.name = 'robots'
      return el
    }).content = noindex ? 'noindex, nofollow' : 'index, follow'

    ensureMeta('meta[property="og:title"]', () => {
      const el = document.createElement('meta')
      el.setAttribute('property', 'og:title')
      return el
    }).content = formattedTitle

    ensureMeta('meta[property="og:description"]', () => {
      const el = document.createElement('meta')
      el.setAttribute('property', 'og:description')
      return el
    }).content = metaDescription

    ensureMeta('meta[property="og:url"]', () => {
      const el = document.createElement('meta')
      el.setAttribute('property', 'og:url')
      return el
    }).content = absoluteUrl

    ensureMeta('meta[property="og:type"]', () => {
      const el = document.createElement('meta')
      el.setAttribute('property', 'og:type')
      return el
    }).content = 'article'

    ensureMeta('meta[name="twitter:card"]', () => {
      const el = document.createElement('meta')
      el.name = 'twitter:card'
      return el
    }).content = 'summary'

    ensureMeta('meta[name="twitter:title"]', () => {
      const el = document.createElement('meta')
      el.name = 'twitter:title'
      return el
    }).content = formattedTitle

    ensureMeta('meta[name="twitter:description"]', () => {
      const el = document.createElement('meta')
      el.name = 'twitter:description'
      return el
    }).content = metaDescription

    if (cfg.seo?.twitter?.handle) {
      ensureMeta('meta[name="twitter:site"]', () => {
        const el = document.createElement('meta')
        el.name = 'twitter:site'
        return el
      }).content = cfg.seo.twitter.handle
    }

    if (cfg.seo?.defaultImage) {
      const image = cfg.seo.defaultImage.startsWith('http')
        ? cfg.seo.defaultImage
        : `${seoOrigin(cfg)}${cfg.seo.defaultImage}`
      ensureMeta('meta[property="og:image"]', () => {
        const el = document.createElement('meta')
        el.setAttribute('property', 'og:image')
        return el
      }).content = image
      ensureMeta('meta[name="twitter:image"]', () => {
        const el = document.createElement('meta')
        el.name = 'twitter:image'
        return el
      }).content = image
    }

    let jsonLd = document.querySelector('script#aiui-jsonld') as HTMLScriptElement | null
    if (!jsonLd) {
      jsonLd = document.createElement('script')
      jsonLd.type = 'application/ld+json'
      jsonLd.id = 'aiui-jsonld'
      document.head.appendChild(jsonLd)
    }
    jsonLd.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description: metaDescription,
      url: absoluteUrl,
      isPartOf: {
        '@type': 'WebSite',
        name: cfg.site?.title || 'Documentation',
        url: `${seoOrigin(cfg)}/`,
      },
    })
  }

  const selectNavItem = (item: NavItem) => {
    const path = canonicalDocPath(item.path || '/')
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    updateSEO(item.pageTitle ?? item.title, path, item.description, undefined, item.noindex)
  }

  // Keep React nav state in sync when plugins perform SPA navigation
  useEffect(() => {
    const onPluginNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      const path = canonicalDocPath(detail?.path ?? window.location.pathname)
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
        applyStoredThemePreference(mode)

        // Handle initial URL path for SPA routing
        const initialPath = canonicalDocPath(window.location.pathname)
        setCurrentPath(initialPath)
        if (initialPath !== window.location.pathname) {
          window.history.replaceState(null, '', initialPath + window.location.search + window.location.hash)
        }
        if (initialPath !== '/') {
          const found = findNavItemByPath(navData, initialPath)
          if (found) {
            // A URL found under the docs base moves to the page's own path.
            const foundPath = canonicalDocPath(found.path || initialPath)
            if (foundPath !== initialPath) {
              setCurrentPath(foundPath)
              window.history.replaceState(null, '', foundPath + window.location.search + window.location.hash)
            }
            setSelectedItem(found)
            setActiveItemPath(found.path || found.title)
            updateSEO(found.pageTitle ?? found.title, foundPath, found.description, configData, found.noindex)
          }
        } else {
          const docsHome = findNavItemByPath(navData, '/docs/index')
          if (docsHome) {
            setSelectedItem(docsHome)
            setActiveItemPath(docsHome.path || docsHome.title)
            updateSEO(docsHome.pageTitle ?? docsHome.title, canonicalDocPath(docsHome.path || '/docs/index'), docsHome.description, configData, docsHome.noindex)
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
      const path = canonicalDocPath(window.location.pathname)
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
    window.history.pushState({ path }, item.title, path)
    window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path } }))
  }

  // A search result: the page, at its section when it has one. Another page
  // scrolls there once its article renders (useHashScroll); this page at once.
  // The hash goes on with replaceState after the move: the legacy
  // nav-intercept plugin re-navigates a pushState to another page without it.
  const openSearchResult = (item: NavItem, anchor?: string) => {
    const path = canonicalDocPath(item.path || '/')
    const samePage = path === currentPath
    window.history.pushState({ path }, item.title, path)
    window.dispatchEvent(new CustomEvent('aiui:navigate', { detail: { path } }))
    if (!anchor) {
      window.scrollTo({ top: 0 })
      return
    }
    window.history.replaceState({ path }, item.title, `${path}#${encodeURIComponent(anchor)}`)
    if (samePage) scrollToHash()
  }

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
      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        nav={filteredNav}
        activeItem={activeItemPath}
        onItemClick={handleItemClick}
        title={config.site?.title || 'Navigation'}
        config={config}
        templateKey={activeTemplateKey}
        navTabs={navTabs}
        activeTabIndex={activeTabIndex}
        onTabChange={setActiveTabIndex}
      />
      <Header
        config={config}
        templateKey={activeTemplateKey}
        onMenuClick={() => setMobileNavOpen(true)}
        navTabs={navTabs}
        activeTabIndex={activeTabIndex}
        onTabChange={setActiveTabIndex}
        onSearchClick={searchEnabled ? openSearch : undefined}
      />
      {searchMounted && (
        <Suspense fallback={null}>
          <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} groups={searchGroups} onSelect={openSearchResult} />
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
          <div className="aiui-docs-shell docs-shell">
            <Sidebar nav={filteredNav} activeItem={activeItemPath} onItemClick={handleItemClick} />
            <Content
              config={config}
              routes={routes}
              selectedItem={selectedItem}
              currentPath={currentPath}
              nav={filteredNav}
              onNavigate={handleItemClick}
              onSearch={searchEnabled ? openSearch : undefined}
            />
            {showToc && <Toc selectedItem={selectedItem} zones={zones} showToc={showToc} />}
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
