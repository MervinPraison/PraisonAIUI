# Analytics, support chat and cookie consent

> Add web analytics or a support chat widget to a docs site with one line per

Add web analytics or a support chat widget to a docs site with one line per
provider, and ask readers for consent before anything loads.

```yaml
integrations:
  plausible: docs.example.com      # one id is enough
  intercom: abc12345
  consent: true                    # ask first, with the built-in banner
```

`aiui build` adds them to every page (the home page, each docs page and
`404.html`). Each client-side page change counts as a page view.

## Providers

A provider takes its main id as a plain value (`ga4: G-ABC1234`) or a block
with more settings. The build checks every id and URL and stops on a bad one.

| Key | Settings (first one is the main id) | Page views on navigation |
|-----|-------------------------------------|--------------------------|
| `ga4` | `measurementId` (`G-...`) | Counted by GA4's enhanced measurement (page changes based on browser history, on by default) |
| `gtm` | `tagId` (`GTM-...`) | Pushes `{event: "aiui.pageview", page_path, page_title}` to the data layer |
| `posthog` | `apiKey` (`phc_...`), `apiHost` (default `https://us.i.posthog.com`), `sessionRecording` (default `false`) | Counted by PostHog (`history_change`) |
| `plausible` | `domain`, `server` (default `https://plausible.io`, or your own instance) | Counted by Plausible |
| `fathom` | `siteId` | Counted by Fathom (`data-spa="auto"`) |
| `umami` | `websiteId` (a UUID), `src` (default `https://cloud.umami.is/script.js`) | Counted by Umami |
| `segment` | `key` (the write key) | `analytics.page()` |
| `mixpanel` | `projectToken`, `region` (`us`, `eu` or `in`) | Counted by Mixpanel (`track_pageview: "url-with-path"`) |
| `scripts` | A list of `https://` script URLs for any other tool | Up to the tool |

Support chat widgets load when the browser is idle, so they never slow the first paint:

| Key | Settings |
|-----|----------|
| `intercom` | `appId` (calls `Intercom('update')` on each page change) |
| `crisp` | `websiteId` (a UUID) |
| `front` | `chatId` |

```yaml
integrations:
  posthog: { apiKey: phc_abc123def456, apiHost: https://eu.i.posthog.com, sessionRecording: true }
  mixpanel: { projectToken: 0123456789abcdef0123456789abcdef, region: eu }
  scripts: [https://cdn.example.com/tracker.js]
```

## Cookie consent

With `consent`, nothing loads until the reader accepts. A small banner at the
bottom of the page offers **Decline** and **Accept**, the same size and style,
so declining is as easy as accepting. The choice is remembered in the
browser's local storage (`aiui-consent`: `granted` or `denied`). The banner
uses the site's theme colours in light and dark mode and fits a phone screen.

```yaml
integrations:
  ga4: G-ABC1234
  consent:
    text: We use cookies to see which pages help and which need work.
    decline: No thanks             # and accept: for the other button
    policy: /docs/privacy          # adds a link after the text
```

| Key | Default | Meaning |
|-----|---------|---------|
| `required` | `true` | `consent: true` is short for this; `false` loads without asking. |
| `banner` | `true` | `false`: no built-in banner; your own consent tool decides (below). |
| `text`, `accept`, `decline` | an English sentence, `Accept`, `Decline` | The banner's words. |
| `policy`, `policyLabel` | none, `Privacy policy` | A link to your privacy page (a site path or URL). |

**Change of mind.** Any link to `#cookie-settings` opens the banner again, for
example in the footer: `[Cookie settings](#cookie-settings)`. Declining after
accepting reloads the page, so the trackers that were running stop.

**Your own consent tool.** Set `banner: false` and tell the page the reader's
choice from the tool's callback:

```js
window.dispatchEvent(new CustomEvent('aiui:consent', { detail: { granted: true } }))
```

## Privacy and previews

Readers whose browser sends Global Privacy Control or Do Not Track get no
analytics (support chat still loads); `respectDoNotTrack: false` counts them
anyway. `aiui dev` leaves integrations out so previews are not visits;
`dev: true` under `integrations` loads them there too.

## Content Security Policy

No inline script is emitted: the settings are a JSON data block and the loader
is a file at the site root (`/aiui-integrations.js`). The build's
[Content Security Policy](https://ui.praison.ai/docs/features/content-security-policy.md) adds each provider's
hosts per directive by itself (`Compiler(config).external_origins()` lists
them). A tag manager container (`gtm`) loads whatever tags you add to it, so
with `gtm` the policy is report-only until you add their hosts under
`site.csp` and set it to enforce.

## Related pages

- [Content Security Policy](https://ui.praison.ai/docs/features/content-security-policy.md)
- [Widget Zones](https://ui.praison.ai/docs/features/widget-zones.md)
- [Progressive Web App (PWA)](https://ui.praison.ai/docs/features/pwa.md)
