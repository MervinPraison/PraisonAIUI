import { useEffect, useState } from 'react'
import { applyTheme } from './themes'
import './index.css'
import type { UIConfig, DocsNav, RouteManifest, NavItem } from './types'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { Content } from './Content'
import { ZoneWidgets } from './Widgets'
import { Toc } from './Toc'
import { Footer } from './Footer'
import { ChatLayout, AgentUILayout, CopilotWidget, PlaygroundLayout } from './layouts'

export default function App() {
  const [config, setConfig] = useState<UIConfig>({})
  const [nav, setNav] = useState<DocsNav>({})
  const [routes, setRoutes] = useState<RouteManifest>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<NavItem | null>(null)
  const [activeItemPath, setActiveItemPath] = useState<string>('')

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
        applyTheme(
          theme?.preset || 'zinc',
          theme?.darkMode !== false,
          theme?.radius || 'md'
        )

        // Handle initial URL path for SPA routing
        const currentPath = window.location.pathname
        if (currentPath && currentPath !== '/') {
          // Find matching nav item by path
          const findItem = (items: NavItem[]): NavItem | null => {
            for (const item of items) {
              if (item.path === currentPath || item.path === currentPath.replace(/^\//, '')) {
                return item
              }
              if (item.children) {
                const found = findItem(item.children)
                if (found) return found
              }
            }
            return null
          }

          // Search all nav groups
          if (navData.items) {
            for (const group of navData.items) {
              if (group.children) {
                const found = findItem(group.children)
                if (found) {
                  setSelectedItem(found)
                  setActiveItemPath(found.path || found.title)
                  break
                }
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadManifests()

    // Handle browser back/forward navigation
    const handlePopState = () => {
      const path = window.location.pathname
      if (path === '/') {
        setSelectedItem(null)
        setActiveItemPath('')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Update SEO meta tags dynamically
  const updateSEO = (title: string, path: string, description?: string) => {
    // Update title
    document.title = `${title} | ${config.site?.title || 'Documentation'}`

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
    metaDesc.content = description || `${title} - ${config.site?.description || ''}`

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
  }

  const handleItemClick = (item: NavItem) => {
    setSelectedItem(item)
    setActiveItemPath(item.path || item.title)
    // Use History API for SEO-friendly URLs
    const path = item.path || `/${item.title.toLowerCase().replace(/\s+/g, '-')}`
    window.history.pushState({ path }, item.title, path)
    // Update SEO meta tags
    updateSEO(item.title, path)
  }

  if (loading) {
    return (
      <div className="dark flex items-center justify-center min-h-screen bg-background">
        <span className="text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dark flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
        <h2 className="text-xl font-semibold text-destructive">Failed to load</h2>
        <p className="text-muted-foreground">{error}</p>
      </div>
    )
  }

  // Determine layout from templates config
  const layout = config.templates?.docs?.layout || 'ThreeColumnLayout'
  const zones = config.templates?.docs?.zones

  // Render based on layout type
  const renderLayout = () => {
    switch (layout) {
      case 'TwoColumnLayout':
        // Sidebar + Content (no TOC)
        return (
          <div className="flex">
            <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
            <Content config={config} routes={routes} selectedItem={selectedItem} />
          </div>
        )
      case 'CenteredLayout':
        // Centered content, no sidebar
        return (
          <div className="flex justify-center">
            <div className="w-full max-w-4xl px-6">
              {zones?.hero && <ZoneWidgets widgets={zones.hero} />}
              <Content config={config} routes={routes} selectedItem={selectedItem} />
            </div>
          </div>
        )
      case 'FullWidthLayout':
        // Full width content
        return (
          <div className="px-6">
            {zones?.hero && <ZoneWidgets widgets={zones.hero} />}
            <Content config={config} routes={routes} selectedItem={selectedItem} />
          </div>
        )
      case 'FlexibleLayout':
        // WordPress-style zones layout
        return (
          <div className="flex flex-col">
            {zones?.hero && <ZoneWidgets widgets={zones.hero} />}
            <div className="flex flex-1">
              {zones?.leftSidebar && (
                <aside className="w-64 border-r p-4 hidden md:block">
                  <ZoneWidgets widgets={zones.leftSidebar} />
                </aside>
              )}
              <div className="flex-1">
                <Content config={config} routes={routes} selectedItem={selectedItem} />
              </div>
              <Toc selectedItem={selectedItem} zones={zones} />
            </div>
            {zones?.bottomNav && (
              <div className="border-t p-4 bg-muted/30">
                <ZoneWidgets widgets={zones.bottomNav} />
              </div>
            )}
          </div>
        )
      case 'ThreeColumnLayout':
      default:
        // Classic: Sidebar + Content + TOC with zones
        return (
          <div className="flex">
            <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
            <Content config={config} routes={routes} selectedItem={selectedItem} />
            <Toc selectedItem={selectedItem} zones={zones} />
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
      case 'custom':
        // For custom, show docs with copilot widget if chat enabled
        if (config.chat?.enabled) {
          return (
            <div className="min-h-screen bg-background text-foreground">
              <Header config={config} />
              {renderLayout()}
              <Footer config={config} />
              <CopilotWidget config={config.chat} layout={config.layout} />
            </div>
          )
        }
        return (
          <div className="min-h-screen bg-background text-foreground">
            <Header config={config} />
            {renderLayout()}
            <Footer config={config} />
          </div>
        )
      case 'docs':
      default:
        // Docs mode - optionally with copilot widget
        if (config.chat?.enabled) {
          const layoutMode = config.layout?.mode
          if (layoutMode && ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(layoutMode)) {
            return (
              <div className="min-h-screen bg-background text-foreground">
                <Header config={config} />
                {renderLayout()}
                <Footer config={config} />
                <CopilotWidget config={config.chat} layout={config.layout} />
              </div>
            )
          }
        }
        return (
          <div className="min-h-screen bg-background text-foreground">
            <Header config={config} />
            {renderLayout()}
            <Footer config={config} />
          </div>
        )
    }
  }

  return renderByStyle()
}
