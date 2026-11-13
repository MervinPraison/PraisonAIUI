/**
 * Adaptive re-render pacing for a streaming chat message.
 *
 * Every update makes Streamdown re-parse the trailing block and re-render its
 * code block (every line, every token span, twice: plain, then highlighted).
 * Shiki itself is incremental (shikiPlugin.ts), but the render still grows
 * with the block, so a 2,000-line fence streamed token by token would keep the
 * main thread saturated. Updates are therefore:
 *  - coalesced to at most one per animation frame, and
 *  - spaced by the measured cost of the previous update, counted from the
 *    moment that update committed, so markdown work stays well under `share`
 *    of the main thread (a cheap message still updates every frame; a
 *    2,000-line fence, whose re-render costs 100-200 ms, updates about once a
 *    second instead of saturating the thread).
 * The final text (streaming ends) is always shown immediately.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface PacerClock {
    now(): number
    /** Run `fn` after `ms` (0 means the next frame). Returns a cancel function. */
    schedule(fn: () => void, ms: number): () => void
}

export interface PacerOptions {
    /** Target share of main-thread time spent on markdown updates. */
    share?: number
    /** Upper bound on the spacing between updates. */
    maxIntervalMs?: number
    /** Each update renders twice (plain, then highlighted): sampled cost × this. */
    passes?: number
}

export const STREAM_SHARE = 0.25
export const MAX_STREAM_INTERVAL_MS = 1000

/**
 * Framework-free core (unit-tested with a fake clock). `push` offers the
 * latest text; `emit` is called with it when it is due. `measured(ms)` reports
 * how long the last emitted update took to render and commit.
 */
export class StreamPacer {
    private last = Number.NEGATIVE_INFINITY
    private cost = 0
    /** Pending scheduled update. */
    private cancel: (() => void) | null = null
    /** An emitted update has not committed yet (released by `measured` or the watchdog). */
    private inFlight = false
    private watchdog: (() => void) | null = null
    private latest = ''
    private emitted: string | null = null
    private readonly emit: (text: string) => void
    private readonly clock: PacerClock
    private readonly share: number
    private readonly maxInterval: number
    private readonly passes: number

    constructor(
        emit: (text: string) => void,
        clock: PacerClock,
        { share = STREAM_SHARE, maxIntervalMs = MAX_STREAM_INTERVAL_MS, passes = 2 }: PacerOptions = {},
    ) {
        this.emit = emit
        this.clock = clock
        this.share = share
        this.maxInterval = maxIntervalMs
        this.passes = passes
    }

    /** Current spacing between updates, from the smoothed render cost. */
    interval(): number {
        return Math.min(this.maxInterval, (this.cost * this.passes) / this.share)
    }

    /**
     * The last emitted update took `ms` to render and has just committed. The
     * next update waits `interval()` from now. Counting from the emit instead
     * would let a 150 ms render followed by a 200 ms gap keep the main thread
     * ~75% busy, and emitting again while a (time-sliced) render is still in
     * flight would restart that render.
     */
    measured(ms: number): void {
        if (ms >= 0) {
            // Smooth, but react quickly to a jump (a fence just started growing).
            this.cost = ms > this.cost ? ms : this.cost * 0.7 + ms * 0.3
        }
        this.settle()
    }

    push(text: string): void {
        this.latest = text
        // A pending update picks up the latest text; one in flight re-schedules on commit.
        if (this.cancel || this.inFlight || text === this.emitted) return
        const wait = Math.max(0, this.last + this.interval() - this.clock.now())
        this.cancel = this.clock.schedule(() => {
            this.cancel = null
            this.send(this.latest)
        }, wait)
    }

    /** Show `text` now (streaming finished) and drop any pending update. */
    flush(text: string): void {
        this.dispose()
        this.latest = text
        this.send(text)
    }

    dispose(): void {
        this.cancel?.()
        this.cancel = null
        this.watchdog?.()
        this.watchdog = null
        this.inFlight = false
    }

    private send(text: string): void {
        this.last = this.clock.now()
        this.emitted = text
        this.inFlight = true
        // If no commit is ever reported (React bailed out), do not stall the stream.
        this.watchdog?.()
        this.watchdog = this.clock.schedule(() => {
            this.watchdog = null
            this.settle()
        }, this.maxInterval)
        this.emit(text)
    }

    private settle(): void {
        if (!this.inFlight) return
        this.inFlight = false
        this.watchdog?.()
        this.watchdog = null
        this.last = this.clock.now()
        if (this.latest !== this.emitted) this.push(this.latest)
    }
}

const browserClock: PacerClock = {
    now: () => performance.now(),
    schedule(fn, ms) {
        if (ms <= 0 && typeof requestAnimationFrame === 'function') {
            const id = requestAnimationFrame(() => fn())
            return () => cancelAnimationFrame(id)
        }
        // After the wait, still land on a frame boundary.
        let raf = 0
        const t = setTimeout(() => {
            if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(() => fn())
            else fn()
        }, ms)
        return () => {
            clearTimeout(t)
            if (raf) cancelAnimationFrame(raf)
        }
    },
}

/**
 * The text a streaming message should render right now: paced (see above)
 * and deferred, so React can still drop an intermediate render under load.
 * Not streaming: the source itself, synchronously (history, docs, the final
 * frame).
 */
export function useStreamingText(source: string, streaming: boolean): string {
    const [shown, setShown] = useState(source)
    const shownRef = useRef(source)
    const emittedAt = useRef(0)
    const pacer = useRef<StreamPacer | null>(null)
    pacer.current ??= new StreamPacer((text) => {
        if (text === shownRef.current) {
            // Nothing to render, so no commit will report back: settle now.
            pacer.current?.measured(Number.NaN)
            return
        }
        emittedAt.current = performance.now()
        shownRef.current = text
        setShown(text)
    }, browserClock)

    useEffect(() => {
        const p = pacer.current!
        if (streaming) p.push(source)
        else if (shownRef.current !== source) p.flush(source)
    }, [source, streaming])

    const deferred = useDeferredValue(shown)

    // Cost of the update just committed: from the emit to the commit of the
    // deferred render, i.e. the Streamdown subtree actually re-rendering.
    useLayoutEffect(() => {
        if (!emittedAt.current) return
        pacer.current!.measured(performance.now() - emittedAt.current)
        emittedAt.current = 0
    }, [deferred])

    useEffect(() => () => pacer.current?.dispose(), [])

    return streaming ? deferred : source
}
