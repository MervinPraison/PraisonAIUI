# Widget Zones

WordPress-style widget areas for placing UI components in layout zones via YAML configuration.

## Zone Layout

```
┌─────────────────────────────────────────┐
│              HEADER                     │
├─────────────────────────────────────────┤
│              TOP NAV                    │
├─────────────────────────────────────────┤
│              HERO                       │
├─────────┬───────────────────┬───────────┤
│  LEFT   │                   │   RIGHT   │
│ SIDEBAR │      MAIN         │  SIDEBAR  │
├─────────┴───────────────────┴───────────┤
│            BOTTOM NAV                   │
├─────────────────────────────────────────┤
│              FOOTER                     │
└─────────────────────────────────────────┘
```

## Configuration

Use the `zones` property in your template configuration:

```yaml
templates:
  docs:
    layout: "FlexibleLayout"
    zones:
      hero:
        - type: "HeroBanner"
          props:
            title: "Welcome to Our Docs"
            subtitle: "Beautifully designed documentation"
            ctaLabel: "Get Started"
            ctaHref: "/docs/quickstart"
      
      rightSidebar:
        - type: "Toc"
        - type: "StatsCard"
          props:
            title: "Active Users"
            value: "15,231"
            change: "+20.1%"
            changeType: "positive"
        - type: "QuickLinks"
          props:
            title: "Resources"
            links:
              - label: "API Reference"
                href: "/docs/api"
              - label: "Examples"
                href: "/docs/examples"
      
      footer:
        - type: "Newsletter"
          props:
            title: "Stay Updated"
        - type: "SocialLinks"
          props:
            links:
              - platform: "GitHub"
                href: "https://github.com"
              - platform: "Twitter"
                href: "https://twitter.com"
        - type: "Copyright"
          props:
            text: "© 2024 My Company"
```

## Available Zones

| Zone | Location | Description |
|------|----------|-------------|
| `header` | Top | Site header area |
| `topNav` | Below header | Secondary navigation |
| `hero` | Above main | Hero banners, announcements |
| `leftSidebar` | Left column | Navigation, filters |
| `main` | Center | Primary content |
| `rightSidebar` | Right column | TOC, widgets |
| `bottomNav` | Below main | Pagination, related |
| `footer` | Bottom | Footer widgets |

## Built-in Widgets

### StatsCard
Display metrics and statistics.

```yaml
- type: "StatsCard"
  props:
    title: "Downloads"
    value: "42,891"
    change: "+12%"
    changeType: "positive"  # or "negative"
```

### QuickLinks
Navigation links widget.

```yaml
- type: "QuickLinks"
  props:
    title: "Quick Links"
    links:
      - label: "API Reference"
        href: "/docs/api"
```

### Newsletter
Email subscription form.

```yaml
- type: "Newsletter"
  props:
    title: "Subscribe"
    buttonText: "Sign Up"
```

### HeroBanner
Landing page hero section.

```yaml
- type: "HeroBanner"
  props:
    title: "Welcome"
    subtitle: "Build amazing docs"
    ctaLabel: "Get Started"
    ctaHref: "/docs"
```

### SocialLinks
Social media links.

```yaml
- type: "SocialLinks"
  props:
    links:
      - platform: "GitHub"
        href: "https://github.com"
```

### Copyright
Copyright notice.

```yaml
- type: "Copyright"
  props:
    text: "© 2024 Company Name"
```

## Layouts Supporting Zones

| Layout | Supported Zones |
|--------|-----------------|
| `FlexibleLayout` | All 8 zones |
| `ThreeColumnLayout` | rightSidebar only |
| `CenteredLayout` | hero only |
| `FullWidthLayout` | hero only |

## Example: Corporate Dashboard

```yaml
templates:
  docs:
    layout: "FlexibleLayout"
    zones:
      rightSidebar:
        - type: "Toc"
        - type: "StatsCard"
          props: { title: "Users", value: "15k" }
        - type: "StatsCard"
          props: { title: "Revenue", value: "$42k" }
      bottomNav:
        - type: "QuickLinks"
          props:
            title: "Related"
            links:
              - label: "Previous: Setup"
                href: "/docs/setup"
```
