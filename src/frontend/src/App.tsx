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
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname.replace(/\/$/, '') || '/')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Helper function to find nav item by path (searches top-level items and nested children)
  const findNavItemByPath = (navData: DocsNav, path: string): NavItem | null => {
    const normalizedPath = path.replace(/\/$/, '') || '/'

    const findItem = (items: NavItem[]): NavItem | null => {
      for (const item of items) {
        const itemPath = (item.path ?? '').replace(/\/$/, '')
        if (itemPath === normalizedPath || itemPath === normalizedPath.replace(/^\//, '')) {
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

  const updateSEO = (title: string, path: string, description?: string, configOverride?: UIConfig) => {
    const cfg = configOverride ?? config
    // Update title using SEO titleTemplate if available
    const titleTemplate = cfg.seo?.titleTemplate || '%s | %s'
    const siteName = cfg.site?.title || 'Documentation'
    if (titleTemplate.includes('%s')) {
      // Replace first %s with page title, second %s (if exists) with site name
      let formattedTitle = titleTemplate.replace('%s', title)
      if (formattedTitle.includes('%s')) {
        formattedTitle = formattedTitle.replace('%s', siteName)
      }
      document.title = formattedTitle
    } else {
      document.title = `${title} | ${siteName}`
    }

    // Update canonical URL
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = window.location.origin + path

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement
    if (!metaDesc) {
      metaDesc = document.createElement('meta')
      metaDesc.name = 'description'
      document.head.appendChild(metaDesc)
    }
    metaDesc.content = description || `${title} - ${cfg.site?.description || ''}`

    // Update Open Graph tags
    let ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement
    if (!ogTitle) {
      ogTitle = document.createElement('meta')
      ogTitle.setAttribute('property', 'og:title')
      document.head.appendChild(ogTitle)
    }
    ogTitle.content = title

    let ogUrl = document.querySelector('meta[property="og:url"]') as HTMLMetaElement
    if (!ogUrl) {
      ogUrl = document.createElement('meta')
      ogUrl.setAttribute('property', 'og:url')
      document.head.appendChild(ogUrl)
    }
    ogUrl.content = window.location.origin + path

    // Update Twitter meta tags if configured
    if (cfg.seo?.twitter) {
      Object.entries(cfg.seo.twitter).forEach(([key, value]) => {
        let twitterMeta = document.querySelector(`meta[name="twitter:${key}"]`) as HTMLMetaElement
        if (!twitterMeta) {
          twitterMeta = document.createElement('meta')
          twitterMeta.name = `twitter:${key}`
          document.head.appendChild(twitterMeta)
        }
        twitterMeta.content = value
      })
    }

    // Set default image if available
    if (cfg.seo?.defaultImage) {
      let ogImage = document.querySelector('meta[property="og:image"]') as HTMLMetaElement
      if (!ogImage) {
        ogImage = document.createElement('meta')
        ogImage.setAttribute('property', 'og:image')
        document.head.appendChild(ogImage)
      }
      ogImage.content = cfg.seo.defaultImage
    }
  }

  const selectNavItem = (item: NavItem) => {
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    updateSEO(item.title, item.path || '/')
  }

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
        const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
        setCurrentPath(currentPath)
        if (currentPath !== '/') {
          const found = findNavItemByPath(navData, currentPath)
          if (found) {
            setSelectedItem(found)
            setActiveItemPath(found.path || found.title)
            updateSEO(found.title, found.path || currentPath, undefined, configData)
          }
        } else {
          const docsHome = findNavItemByPath(navData, '/docs/index')
          if (docsHome) {
            setSelectedItem(docsHome)
            setActiveItemPath(docsHome.path || docsHome.title)
            updateSEO(docsHome.title, docsHome.path || '/docs/index', undefined, configData)
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
      const path = window.location.pathname.replace(/\/$/, '') || '/'
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
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    const path = item.path || `/${item.title.toLowerCase().replace(/\s+/g, '-')}`
    setCurrentPath(path.replace(/\/$/, '') || '/')
    window.history.pushState({ path }, item.title, path)
    updateSEO(item.title, path)
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
            <Content config={config} routes={routes} selectedItem={selectedItem} />
          </div>
        )
      case 'CenteredLayout':
        return (
          <div className="flex justify-center">
            <div className="w-full max-w-4xl px-6">
              {zones?.hero && zones.hero.length > 0 && <ZoneWidgets widgets={zones.hero} />}
              <Content config={config} routes={routes} selectedItem={selectedItem} />
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
              <Content config={config} routes={routes} selectedItem={selectedItem} />
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
                <Content config={config} routes={routes} selectedItem={selectedItem} />
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
            <Content config={config} routes={routes} selectedItem={selectedItem} />
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
