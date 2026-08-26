import { useEffect, useState } from 'react'
import { applyTheme, applyStoredThemePreference } from './themes'
import './index.css'
import type { UIConfig, DocsNav, RouteManifest, NavItem } from './types'
import { Header } from './Header'
import { Sidebar, MobileNavSheet } from './Sidebar'
import { Content } from './Content'
import { ZoneWidgets } from './Widgets'
import { Toc } from './Toc'
import { Footer } from './Footer'
import { ChatLayout, AgentUILayout, CopilotWidget, PlaygroundLayout } from './layouts'
import { LocaleProvider } from './i18n'
import { resolveTemplate, shouldShowToc } from './resolver'
import { normalizeDocPath } from './pathUtils'

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
  const [selectedItem, setSelectedItem] = useState<NavItem | null>(null)
  const [activeItemPath, setActiveItemPath] = useState<string>('')
  const [currentPath, setCurrentPath] = useState(() => normalizeDocPath(window.location.pathname))
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Helper function to find nav item by path (searches top-level items and nested children)
  const findNavItemByPath = (navData: DocsNav, path: string): NavItem | null => {
    const normalizedPath = normalizeDocPath(path)

    const findItem = (items: NavItem[]): NavItem | null => {
      for (const item of items) {
        const itemPath = normalizeDocPath(item.path ?? '')
        if (itemPath === normalizedPath) {
          return item
        }
        if (item.children) {
          const found = findItem(item.children)
          if (found) return found
        }
      }
      return null
    }

    return navData.items ? findItem(navData.items) : null
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
    const canonicalPath = normalizeDocPath(path)
    const formattedTitle = formatSeoTitle(title, cfg)
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
    const path = normalizeDocPath(item.path || '/')
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    updateSEO(item.title, path, item.description, undefined, item.noindex)
  }

  // Keep React nav state in sync when plugins perform SPA navigation
  useEffect(() => {
    const onPluginNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      const path = normalizeDocPath(detail?.path ?? window.location.pathname)
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
      try {
        const [configRes, navRes, routesRes] = await Promise.all([
          fetch('/ui-config.json'),
          fetch('/docs-nav.json'),
          fetch('/route-manifest.json'),
        ])

        if (!configRes.ok || !navRes.ok || !routesRes.ok) {
          throw new Error('Failed to load manifests')
        }

        const configData = await configRes.json()
        const navData = await navRes.json()
        setConfig(configData)
        setNav(navData)
        setRoutes(await routesRes.json())

        // Apply theme from YAML config
        const theme = configData.site?.theme
        const yamlDark = theme?.darkMode !== false
        applyTheme(
          theme?.preset || 'zinc',
          yamlDark,
          theme?.radius || 'md'
        )
        applyStoredThemePreference(yamlDark)

        // Handle initial URL path for SPA routing
        const initialPath = normalizeDocPath(window.location.pathname)
        setCurrentPath(initialPath)
        if (initialPath !== window.location.pathname) {
          window.history.replaceState(null, '', initialPath + window.location.search + window.location.hash)
        }
        if (initialPath !== '/') {
          const found = findNavItemByPath(navData, initialPath)
          if (found) {
            setSelectedItem(found)
            setActiveItemPath(found.path || found.title)
            updateSEO(found.title, initialPath, found.description, configData, found.noindex)
          }
        } else {
          const docsHome = findNavItemByPath(navData, '/docs/index')
          if (docsHome) {
            setSelectedItem(docsHome)
            setActiveItemPath(docsHome.path || docsHome.title)
            updateSEO(docsHome.title, normalizeDocPath(docsHome.path || '/docs/index'), docsHome.description, configData, docsHome.noindex)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadManifests()
  }, [])

  // Handle browser back/forward navigation in a separate effect
  useEffect(() => {
    const handlePopState = () => {
      const path = normalizeDocPath(window.location.pathname)
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
    const path = normalizeDocPath(item.path || `/${item.title.toLowerCase().replace(/\s+/g, '-')}`)
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    setCurrentPath(path)
    window.history.pushState({ path }, item.title, path)
    updateSEO(item.title, path, item.description, undefined, item.noindex)
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
        nav={nav}
        activeItem={activeItemPath}
        onItemClick={handleItemClick}
        title={config.site?.title || 'Navigation'}
      />
      <Header
        config={config}
        templateKey={activeTemplateKey}
        onMenuClick={() => setMobileNavOpen(true)}
      />
    </>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <h2 className="text-xl font-semibold text-destructive">Failed to load</h2>
        <p className="text-muted-foreground">{error}</p>
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
          <div className="flex">
            <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
            <Content config={config} routes={routes} selectedItem={selectedItem} currentPath={currentPath} />
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
            <div className="min-h-screen bg-background text-foreground">
              <SkipLink enabled={config.a11y?.skipToContent} />
              {docsChrome}
              {renderLayout()}
              {showGlobalFooter && <Footer config={config} templateKey={activeTemplateKey} />}
              <CopilotWidget config={config.chat} layout={config.layout} />
            </div>
          )
        }
        return (
          <div className="min-h-screen bg-background text-foreground">
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
              <div className="min-h-screen bg-background text-foreground">
                <SkipLink enabled={config.a11y?.skipToContent} />
                {docsChrome}
                {renderLayout()}
                {showGlobalFooter && <Footer config={config} templateKey={activeTemplateKey} />}
                <CopilotWidget config={config.chat} layout={config.layout} />
              </div>
            )
          }
        }
        return (
          <div className="min-h-screen bg-background text-foreground">
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
      {renderByStyle()}
    </LocaleProvider>
  )
}
