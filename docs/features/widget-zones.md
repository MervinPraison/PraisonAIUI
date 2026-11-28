# Widget Zones

> Widget zones place small built-in widgets (stats cards, links, banners) around

Widget zones place small built-in widgets (stats cards, links, banners) around
the page content of a docs site (`aiui build`, `style: docs` or `custom`),
configured per template in YAML.

## Zone Layout

`FlexibleLayout` renders these zones:

```
┌─────────────────────────────────────────┐
│              HERO                       │
├─────────┬───────────────────┬───────────┤
│  LEFT   │                   │   RIGHT   │
│ SIDEBAR │   page content    │  SIDEBAR  │
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

| Zone | Location | Notes |
|------|----------|-------|
| `hero` | Above the content | Banners, announcements |
| `leftSidebar` | Left column | Replaces the docs navigation when set |
| `rightSidebar` | Right column | Below the table of contents |
| `bottomNav` | Below the content | Related links |
| `footer` | Bottom | Footer widgets, above the site footer |
| `header`, `topNav`, `main` | | Accepted by the schema; no layout renders them yet |

A `Toc` entry in `rightSidebar` is skipped: the table of contents is always
drawn there when the page has headings. When the config defines a component
named `sidebar`, `header` or `footer` and a template leaves the matching zone
(`leftSidebar`, `header`, `footer`) empty, the build fills the zone with that
component.

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

### Other widgets

| Widget | Props |
|--------|-------|
| `Progress` | `label`, `value` (0 to 100), `showPercent` (default true) |
| `Announcement` | `title`, `message`, `type` (`info`, `warning`, `success`) |
| `RecentPosts` | `title`, `posts` (list of `title`, `href`, `date`) |
| `BadgeList` | `title`, `badges` (list of strings) |

## Layouts Supporting Zones

| Layout | Zones rendered |
|--------|----------------|
| `FlexibleLayout` | `hero`, `leftSidebar`, `rightSidebar`, `bottomNav`, `footer` |
| `ThreeColumnLayout` (default) | `rightSidebar` |
| `CenteredLayout` | `hero` |
| `FullWidthLayout` | `hero` |
| `TwoColumnLayout` | none |

## Example

```yaml
templates:
  docs:
    layout: "FlexibleLayout"
    zones:
      rightSidebar:
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

## Related pages

- [YAML Configuration](https://ui.praison.ai/docs/concepts/configuration.md)
- [Templates & Layouts](https://ui.praison.ai/docs/concepts/templates.md)
- [Slots & Components](https://ui.praison.ai/docs/concepts/slots.md)
