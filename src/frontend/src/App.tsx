import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { applyTheme, SHADCN_THEMES } from './themes'
import './index.css'

interface NavItem {
  title: string
  href?: string
  path?: string
  children?: NavItem[]
}

interface ThemeConfig {
  preset?: string
  radius?: string
  darkMode?: boolean
}

interface SiteConfig {
  title?: string
  description?: string
  theme?: ThemeConfig
}

interface WidgetConfig {
  type: string
  props?: Record<string, unknown>
}

interface ZonesConfig {
  header?: WidgetConfig[]
  topNav?: WidgetConfig[]
  hero?: WidgetConfig[]
  leftSidebar?: WidgetConfig[]
  main?: WidgetConfig[]
  rightSidebar?: WidgetConfig[]
  bottomNav?: WidgetConfig[]
  footer?: WidgetConfig[]
}

interface TemplateConfig {
  layout?: string
  slots?: Record<string, unknown>
  zones?: ZonesConfig
}

interface UIConfig {
  site?: SiteConfig
  components?: Record<string, { props?: Record<string, unknown> }>
  templates?: Record<string, TemplateConfig>
}

interface DocsNav {
  items?: NavItem[]
}

interface RouteManifest {
  routes?: { pattern: string; template: string }[]
}

function Header({ config }: { config: UIConfig }) {
  const header = config.components?.header?.props as {
    logoText?: string
    links?: { label: string; href: string }[]
    cta?: { label: string; href: string }
  } | undefined

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center px-6 max-w-screen-2xl mx-auto">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center">
            <span className="text-primary-foreground text-sm font-bold">AI</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">{header?.logoText || config.site?.title || 'PraisonAIUI'}</span>
        </div>

        {/* Search (placeholder) */}
        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search documentation..."
              className="w-full h-9 pl-10 pr-4 text-sm rounded-lg border border-border/50 bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border/50 bg-muted px-1.5 text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Navigation */}
        <nav className="ml-auto flex items-center gap-1">
          {header?.links?.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg transition-all"
            >
              {link.label}
            </a>
          ))}
          {header?.cta && (
            <Button size="sm" className="ml-2 shadow-sm" asChild>
              <a href={header.cta.href}>{header.cta.label}</a>
            </Button>
          )}
        </nav>
      </div>
    </header>
  )
}

interface SidebarProps {
  nav: DocsNav
  activeItem: string
  onItemClick: (item: NavItem) => void
}

function Sidebar({ nav, activeItem, onItemClick }: SidebarProps) {
  const renderItem = (item: NavItem, depth = 0) => {
    const itemPath = item.path || item.title
    const isActive = activeItem === itemPath
    const hasChildren = item.children && item.children.length > 0

    return (
      <div key={item.title + (item.path || '')}>
        <button
          onClick={() => onItemClick(item)}
          className={`group w-full text-left px-3 py-2 text-sm rounded-lg transition-all duration-150 flex items-center gap-2 ${isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          style={{ paddingLeft: `${16 + depth * 16}px` }}
        >
          {/* Indicator dot for active item */}
          <span className={`w-1.5 h-1.5 rounded-full transition-all ${isActive ? 'bg-primary' : 'bg-transparent group-hover:bg-muted-foreground/30'}`} />
          <span className="truncate">{item.title}</span>
          {hasChildren && (
            <svg className="w-3 h-3 ml-auto text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
        {item.children?.map((child) => renderItem(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="w-64 border-r border-border/50 bg-muted/20">
      <ScrollArea className="h-[calc(100vh-4rem)] py-6">
        <div className="px-3 space-y-6">
          {nav.items?.map((group) => (
            <div key={group.title}>
              <h4 className="px-3 mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest">
                {group.title}
              </h4>
              <div className="space-y-0.5">
                {group.children?.map((item) => renderItem(item))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

interface ContentProps {
  config: UIConfig
  routes: RouteManifest
  selectedItem: NavItem | null
}

function Content({ config, routes, selectedItem }: ContentProps) {
  const [markdown, setMarkdown] = useState<string>('')
  const [loadingContent, setLoadingContent] = useState(false)
  const theme = config.site?.theme

  // Load markdown content when selected item changes
  useEffect(() => {
    if (!selectedItem?.path) {
      setMarkdown('')
      return
    }

    const loadContent = async () => {
      setLoadingContent(true)
      try {
        // Convert path like /docs/getting-started/installation to docs/getting-started/installation.md
        const docPath = (selectedItem.path ?? '').replace(/^\//, '') + '.md'
        const response = await fetch(`/${docPath}`)
        if (response.ok) {
          const content = await response.text()
          setMarkdown(content)
        } else {
          setMarkdown(`*Content for **${selectedItem.title}** not found.*`)
        }
      } catch {
        setMarkdown(`*Failed to load content for **${selectedItem.title}**.*`)
      } finally {
        setLoadingContent(false)
      }
    }

    loadContent()
  }, [selectedItem])

  // Custom components for react-markdown with Tailwind styling
  const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-3xl font-bold mt-8 mb-4">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-2xl font-semibold mt-8 mb-4 text-primary">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-xl font-semibold mt-6 mb-3">{children}</h3>,
    h4: ({ children }: { children?: React.ReactNode }) => <h4 className="text-lg font-semibold mt-4 mb-2">{children}</h4>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="my-3 text-muted-foreground leading-relaxed">{children}</p>,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} className="text-primary hover:underline">{children}</a>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-6 my-4 space-y-1">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-6 my-4 space-y-1">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="text-muted-foreground">{children}</li>,
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">{children}</blockquote>,
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      // Check if this is inside a pre block (fenced code block)
      const isInline = !className && String(children).indexOf('\n') === -1
      if (isInline) {
        return <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
      }
      // Block code - rendered by pre wrapper
      return <code className="block font-mono">{children}</code>
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto my-4 font-mono whitespace-pre">{children}</pre>
    ),
    table: ({ children }: { children?: React.ReactNode }) => <div className="overflow-auto my-4"><table className="w-full border-collapse text-sm">{children}</table></div>,
    thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/50">{children}</thead>,
    tr: ({ children }: { children?: React.ReactNode }) => <tr className="border-b">{children}</tr>,
    th: ({ children }: { children?: React.ReactNode }) => <th className="px-4 py-2 text-left font-medium">{children}</th>,
    td: ({ children }: { children?: React.ReactNode }) => <td className="px-4 py-2 text-muted-foreground">{children}</td>,
    hr: () => <hr className="my-6 border-border" />,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em>{children}</em>,
  }

  if (selectedItem) {
    return (
      <main className="flex-1 p-8 max-w-3xl">
        {loadingContent ? (
          <div className="text-muted-foreground">Loading content...</div>
        ) : markdown ? (
          <article className="prose max-w-none">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {markdown}
            </Markdown>
          </article>
        ) : (
          <div className="bg-muted/50 border rounded-lg p-6">
            <p className="text-muted-foreground">
              Content for <strong className="text-primary">{selectedItem.title}</strong> would be displayed here.
            </p>
          </div>
        )}
      </main>
    )
  }

  return (
    <main className="flex-1 p-8 max-w-3xl">
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        {config.site?.title || 'Documentation'}
      </h1>
      <p className="text-muted-foreground text-lg mb-8">
        {config.site?.description || 'Welcome to the documentation.'}
      </p>

      <Separator className="my-8" />

      <h2 className="text-2xl font-semibold mb-4 text-primary">Theme Configuration</h2>
      <div className="bg-muted/50 border rounded-lg p-4 mb-6">
        <p className="text-sm text-muted-foreground mb-2">
          <strong>Current theme from YAML:</strong>
        </p>
        <pre className="text-primary text-sm">
          {`site:
  theme:
    preset: "${theme?.preset || 'zinc'}"
    radius: "${theme?.radius || 'md'}"
    darkMode: ${theme?.darkMode !== false}`}
        </pre>
      </div>

      <h3 className="text-lg font-medium mb-3">Available Presets</h3>
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.keys(SHADCN_THEMES).map((name) => (
          <span
            key={name}
            className={`px-3 py-1 rounded-full text-sm ${name === (theme?.preset || 'zinc')
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
              }`}
          >
            {name}
          </span>
        ))}
      </div>

      <p className="text-muted-foreground mb-4">
        <strong>Click any item in the sidebar</strong> to navigate.
      </p>

      <h2 className="text-2xl font-semibold mt-8 mb-4">Routes</h2>
      <p className="text-muted-foreground mb-4">
        <span className="font-medium text-primary">{routes.routes?.length || 0}</span> routes configured.
      </p>
      <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto">
        {JSON.stringify(routes.routes?.slice(0, 3), null, 2)}
      </pre>
    </main>
  )
}

// ============ WIDGET COMPONENTS ============

function StatsCardWidget({ props }: { props?: Record<string, unknown> }) {
  const title = (props?.title as string) || 'Statistics'
  const value = (props?.value as string) || '0'
  const change = (props?.change as string) || ''
  const changeType = (props?.changeType as 'positive' | 'negative') || 'positive'

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {change && (
        <CardContent className="pt-0">
          <span className={changeType === 'positive' ? 'text-green-500 text-sm' : 'text-red-500 text-sm'}>
            {change}
          </span>
        </CardContent>
      )}
    </Card>
  )
}

function QuickLinksWidget({ props }: { props?: Record<string, unknown> }) {
  const title = (props?.title as string) || 'Quick Links'
  const links = (props?.links as { label: string; href: string }[]) || []

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {links.map((link, i) => (
          <a
            key={i}
            href={link.href}
            className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {link.label}
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

function NewsletterWidget({ props }: { props?: Record<string, unknown> }) {
  const title = (props?.title as string) || 'Newsletter'
  const buttonText = (props?.buttonText as string) || 'Subscribe'

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription>Get the latest updates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <input
          type="email"
          placeholder="Enter your email"
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
        />
        <Button size="sm" className="w-full">{buttonText}</Button>
      </CardContent>
    </Card>
  )
}

function HeroBannerWidget({ props }: { props?: Record<string, unknown> }) {
  const title = (props?.title as string) || 'Welcome'
  const subtitle = (props?.subtitle as string) || ''
  const ctaLabel = (props?.ctaLabel as string) || ''
  const ctaHref = (props?.ctaHref as string) || ''

  return (
    <div className="py-16 px-6 text-center bg-gradient-to-br from-primary/10 to-primary/5 mb-6">
      <h1 className="text-4xl font-bold mb-4">{title}</h1>
      {subtitle && <p className="text-xl text-muted-foreground mb-6">{subtitle}</p>}
      {ctaLabel && ctaHref && (
        <Button size="lg" asChild>
          <a href={ctaHref}>{ctaLabel}</a>
        </Button>
      )}
    </div>
  )
}

function CopyrightWidget({ props }: { props?: Record<string, unknown> }) {
  const text = (props?.text as string) || `© ${new Date().getFullYear()}`
  return <div className="text-center text-sm text-muted-foreground py-2">{text}</div>
}

function SocialLinksWidget({ props }: { props?: Record<string, unknown> }) {
  const links = (props?.links as { platform: string; href: string }[]) || []
  return (
    <div className="flex gap-4 justify-center py-2">
      {links.map((link, i) => (
        <a key={i} href={link.href} className="text-muted-foreground hover:text-foreground text-sm">
          {link.platform}
        </a>
      ))}
    </div>
  )
}

// Widget renderer
function renderZoneWidget(widget: WidgetConfig, index: number) {
  switch (widget.type) {
    case 'StatsCard':
      return <StatsCardWidget key={index} props={widget.props} />
    case 'QuickLinks':
      return <QuickLinksWidget key={index} props={widget.props} />
    case 'Newsletter':
      return <NewsletterWidget key={index} props={widget.props} />
    case 'HeroBanner':
      return <HeroBannerWidget key={index} props={widget.props} />
    case 'Copyright':
      return <CopyrightWidget key={index} props={widget.props} />
    case 'SocialLinks':
      return <SocialLinksWidget key={index} props={widget.props} />
    case 'Toc':
      return null // Toc is rendered separately
    default:
      return (
        <Card key={index} className="mb-4">
          <CardContent className="pt-4">
            <span className="text-muted-foreground text-sm">Widget: {widget.type}</span>
          </CardContent>
        </Card>
      )
  }
}

function ZoneWidgets({ widgets }: { widgets?: WidgetConfig[] }) {
  if (!widgets || widgets.length === 0) return null
  return <>{widgets.map((w, i) => renderZoneWidget(w, i))}</>
}

function Toc({ selectedItem, zones }: { selectedItem: NavItem | null; zones?: ZonesConfig }) {
  const rightSidebarWidgets = zones?.rightSidebar || []

  return (
    <aside className="w-64 hidden lg:block border-l border-border/50">
      <div className="sticky top-20 px-4 py-6 space-y-4">
        {/* Table of Contents */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest mb-4">
            On this page
          </h4>
          <nav className="space-y-2 text-sm">
            {selectedItem ? (
              <div className="space-y-2">
                <a href="#" className="flex items-center gap-2 text-primary font-medium">
                  <span className="w-1 h-1 rounded-full bg-primary" />
                  {selectedItem.title}
                </a>
                <a href="#overview" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors pl-3">
                  Overview
                </a>
                <a href="#usage" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors pl-3">
                  Usage
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                <a href="#theme" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  Theme Configuration
                </a>
                <a href="#presets" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  Available Presets
                </a>
              </div>
            )}
          </nav>
        </div>

        {/* Zone Widgets (excluding Toc) */}
        {rightSidebarWidgets.filter(w => w.type !== 'Toc').length > 0 && (
          <div className="pt-4 border-t border-border/50">
            <ZoneWidgets widgets={rightSidebarWidgets.filter(w => w.type !== 'Toc')} />
          </div>
        )}
      </div>
    </aside>
  )
}

function Footer({ config }: { config: UIConfig }) {
  const footer = config.components?.footer?.props as {
    text?: string
    links?: { label: string; href: string }[]
  } | undefined

  return (
    <footer className="border-t border-border/50 py-8 px-6 bg-muted/20">
      <div className="max-w-screen-2xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-primary/60 to-primary flex items-center justify-center">
            <span className="text-primary-foreground text-[8px] font-bold">AI</span>
          </div>
          <span>{footer?.text || '© 2024 PraisonAIUI'}</span>
        </div>
        <nav className="flex items-center gap-6">
          {footer?.links?.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hover:text-foreground transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header config={config} />
      {renderLayout()}
      <Footer config={config} />
    </div>
  )
}
