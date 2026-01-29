import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { applyTheme, SHADCN_THEMES } from './themes'
import './index.css'

interface NavItem {
  title: string
  href?: string
  path?: string
  children?: NavItem[]
}

interface ThemeConfig {
  preset?: string  // zinc, slate, green, blue, violet, orange, rose, yellow
  radius?: string  // none, sm, md, lg, xl
  darkMode?: boolean
}

interface SiteConfig {
  title?: string
  description?: string
  theme?: ThemeConfig
}

interface UIConfig {
  site?: SiteConfig
  components?: Record<string, { props?: Record<string, unknown> }>
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
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-6">
        <div className="flex items-center gap-2 font-semibold">
          <span className="text-primary">{header?.logoText || config.site?.title || 'PraisonAIUI'}</span>
        </div>
        <nav className="ml-auto flex items-center gap-4">
          {header?.links?.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {link.label}
            </a>
          ))}
          {header?.cta && (
            <Button size="sm" asChild>
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

    return (
      <div key={item.title + (item.path || '')}>
        <button
          onClick={() => onItemClick(item)}
          className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${isActive
            ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
        >
          {item.title}
        </button>
        {item.children?.map((child) => renderItem(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="w-64 border-r">
      <ScrollArea className="h-[calc(100vh-3.5rem)] py-4">
        <div className="px-2 space-y-1">
          {nav.items?.map((group) => (
            <div key={group.title} className="mb-4">
              <h4 className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {group.title}
              </h4>
              {group.children?.map((item) => renderItem(item))}
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
      const isBlock = className?.includes('language-')
      return isBlock ? (
        <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto my-4"><code>{children}</code></pre>
      ) : (
        <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-sm">{children}</code>
      )
    },
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
        <h1 className="text-4xl font-bold tracking-tight mb-2 text-primary">
          {selectedItem.title}
        </h1>
        <p className="text-muted-foreground text-sm mb-6">
          <code className="bg-primary/10 text-primary px-2 py-1 rounded">{selectedItem.path || 'N/A'}</code>
        </p>
        <Separator className="my-6" />
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

function Toc({ selectedItem }: { selectedItem: NavItem | null }) {
  return (
    <aside className="w-48 hidden lg:block">
      <div className="sticky top-20 py-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          On this page
        </h4>
        <nav className="space-y-1 text-sm">
          {selectedItem ? (
            <span className="block text-primary font-medium">{selectedItem.title}</span>
          ) : (
            <>
              <a href="#" className="block text-muted-foreground hover:text-primary">Theme Configuration</a>
              <a href="#" className="block text-muted-foreground hover:text-primary">Routes</a>
            </>
          )}
        </nav>
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
    <footer className="border-t py-6 px-6">
      <div className="flex justify-between items-center text-sm text-muted-foreground">
        <span>{footer?.text || '© 2024'}</span>
        <nav className="flex gap-4">
          {footer?.links?.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-primary">
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header config={config} />
      <div className="flex">
        <Sidebar nav={nav} activeItem={activeItemPath} onItemClick={handleItemClick} />
        <Content config={config} routes={routes} selectedItem={selectedItem} />
        <Toc selectedItem={selectedItem} />
      </div>
      <Footer config={config} />
    </div>
  )
}
