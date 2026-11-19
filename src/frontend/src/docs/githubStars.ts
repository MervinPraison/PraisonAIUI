// The star count on a `navbar.primary` of `type: github`: one public API call per repo per visitor
// every six hours (answer or failure kept in localStorage); until known, the button shows no count.
import { useEffect, useState } from 'react'

const KEY = 'aiui-github-stars'
const TTL_MS = 6 * 60 * 60 * 1000
type Cache = Record<string, { n: number | null; t: number }>

/** `owner/repo` of a github.com repository URL, else null. */
export function repoOf(href: string): string | null {
    const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i.exec(href)
    return m ? `${m[1]}/${m[2]}` : null
}

function readCache(storage: Storage | null): Cache {
    try {
        return JSON.parse(storage?.getItem(KEY) ?? '{}') as Cache
    } catch {
        return {}
    }
}

/** A fresh cached count (number), a cached failure (null), or undefined when it must be fetched. */
export function cachedStars(repo: string, storage: Storage | null, now = Date.now()): number | null | undefined {
    const hit = readCache(storage)[repo]
    return hit && now - hit.t < TTL_MS ? hit.n : undefined
}

const pending = new Map<string, Promise<number | null>>()

/** The repo's star count: from the cache, else one request shared by every caller. */
export function githubStars(repo: string, storage: Storage | null, fetchImpl: typeof fetch = fetch, now = Date.now()) {
    const hit = cachedStars(repo, storage, now)
    if (hit !== undefined) return Promise.resolve(hit)
    let p = pending.get(repo)
    if (p) return p
    p = fetchImpl(`https://api.github.com/repos/${repo}`, { headers: { Accept: 'application/vnd.github+json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { stargazers_count?: unknown } | null) => (typeof body?.stargazers_count === 'number' ? body.stargazers_count : null))
        .catch(() => null)
        .then((n) => {
            try {
                storage?.setItem(KEY, JSON.stringify({ ...readCache(storage), [repo]: { n, t: now } }))
            } catch {
                // storage full or blocked: the count still shows this time
            }
            pending.delete(repo)
            return n
        })
    pending.set(repo, p)
    return p
}

/** 950 -> "950", 1234 -> "1.2k", 45678 -> "45.7k". */
export function formatStars(n: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n).toLowerCase()
}

function localStore(): Storage | null {
    try {
        return window.localStorage
    } catch {
        return null
    }
}

/** The star count of a GitHub repository URL, once known (null: none to show). */
export function useGithubStars(href: string | undefined): number | null {
    const repo = href ? repoOf(href) : null
    const [stars, setStars] = useState(() => (repo ? (cachedStars(repo, localStore()) ?? null) : null))
    useEffect(() => {
        if (!repo) return
        let live = true
        githubStars(repo, localStore()).then((n) => live && setStars(n))
        return () => void (live = false)
    }, [repo])
    return stars
}
