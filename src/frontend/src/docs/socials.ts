/**
 * Social networks for the docs chrome: footer `socials` (key: URL) and header
 * links with `type: github|discord`. A known key (or, for any other key, the
 * URL's host) picks the network's name and mark (docs/ChromeLinks.tsx).
 */
import { isExternal } from './chrome'

/** `hosts`: sites (and their subdomains) that mean the network; `lucide`: a lucide icon instead of a brand mark. */
export type Network = { label: string; hosts?: string[]; lucide?: string }

export const NETWORKS: Readonly<Record<string, Network>> = {
    github: { label: 'GitHub', hosts: ['github.com'] },
    gitlab: { label: 'GitLab', hosts: ['gitlab.com'] },
    x: { label: 'X', hosts: ['x.com', 'twitter.com'] },
    discord: { label: 'Discord', hosts: ['discord.gg', 'discord.com'] },
    slack: { label: 'Slack', hosts: ['slack.com'] },
    linkedin: { label: 'LinkedIn', hosts: ['linkedin.com'] },
    youtube: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
    bluesky: { label: 'Bluesky', hosts: ['bsky.app'] },
    mastodon: { label: 'Mastodon', hosts: ['mastodon.social'] },
    reddit: { label: 'Reddit', hosts: ['reddit.com'] },
    telegram: { label: 'Telegram', hosts: ['t.me', 'telegram.me'] },
    facebook: { label: 'Facebook', hosts: ['facebook.com'] },
    instagram: { label: 'Instagram', hosts: ['instagram.com'] },
    threads: { label: 'Threads', hosts: ['threads.net', 'threads.com'] },
    medium: { label: 'Medium', hosts: ['medium.com'] },
    'hacker-news': { label: 'Hacker News', hosts: ['news.ycombinator.com'] },
    npm: { label: 'npm', hosts: ['npmjs.com'] },
    website: { label: 'Website', lucide: 'globe' },
    email: { label: 'Email', lucide: 'mail' },
    rss: { label: 'RSS', lucide: 'rss' },
    podcast: { label: 'Podcast', lucide: 'podcast' },
}

const ALIASES: Readonly<Record<string, string>> = { twitter: 'x', 'x-twitter': 'x', hackernews: 'hacker-news', web: 'website', site: 'website', mail: 'email' }

/** `network`: the key in NETWORKS (`github`), or '' for one the table does not know. */
export type Social = { network: string; label: string }

function hostOf(href: string): string {
    try {
        return new URL(href).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
        return ''
    }
}

/** The network a footer social (or a typed header link) stands for: by its key, then by its URL. */
export function socialOf(key: string, href: string): Social {
    const k = key.trim().toLowerCase()
    const byKey = ALIASES[k] ?? k
    if (NETWORKS[byKey]) return { network: byKey, label: NETWORKS[byKey].label }
    if (href.startsWith('mailto:')) return { network: 'email', label: key }
    const host = hostOf(href)
    const found = Object.entries(NETWORKS).find(([, n]) => n.hosts?.some((h) => host === h || host.endsWith(`.${h}`)))
    return found ? { network: found[0], label: found[1].label } : { network: '', label: key }
}

/** target/rel for a link to another site. */
export function linkTarget(href: string) {
    return isExternal(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {}
}

