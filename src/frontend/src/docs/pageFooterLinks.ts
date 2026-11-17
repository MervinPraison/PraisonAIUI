// The docs page footer's links and dates (docs/PageFooter.tsx), as pure functions.

/** "17 Nov 2026" from a YYYY-MM-DD commit date; the input as written if it is not one. */
export function formatUpdated(date: string, locale?: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (!m) return date
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return new Intl.DateTimeFormat(locale ?? 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

/** A new-issue link that names the page, for a "No" on "Was this page helpful?". */
export function feedbackIssueUrl(issues: string, title: string, pageUrl: string): string {
    const params = new URLSearchParams({
        title: `Docs: ${title}`,
        body: `Page: ${pageUrl}\n\nWhat was missing, wrong or unclear?\n`,
    })
    return `${issues}${issues.includes('?') ? '&' : '?'}${params.toString()}`
}
