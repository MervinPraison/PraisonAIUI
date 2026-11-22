// Injected before any page script (Playwright add_init_script). Records, in
// page time (ms since navigation start): when content became ready, every
// stretch the loading skeleton was on screen, and the app's aiui:docs-load
// events. window.__preqaCfg = {ready, skeleton} is prepended by track.py.
(() => {
  if (window.__preqa) return
  const cfg = window.__preqaCfg || { ready: '#main-content h1', skeleton: '.aiui-docs-skeleton' }
  const S = (window.__preqa = { ready: [], skel: [], skelSince: null, docsLoad: [] })
  let lastKey = null
  let queued = false
  function tick() {
    queued = false
    const now = performance.now()
    const sk = document.querySelector(cfg.skeleton)
    if (sk && S.skelSince === null) S.skelSince = now
    if (!sk && S.skelSince !== null) {
      S.skel.push({ at: Math.round(S.skelSince), ms: Math.round(now - S.skelSince), path: location.pathname })
      S.skelSince = null
    }
    const h = document.querySelector(cfg.ready)
    if (h && !sk) {
      const key = location.pathname + '|' + h.textContent
      if (key !== lastKey) {
        lastKey = key
        S.ready.push({ t: Math.round(now), path: location.pathname, h1: (h.textContent || '').slice(0, 80) })
      }
    }
  }
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(tick) } }
  new MutationObserver(schedule).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] })
  setInterval(tick, 100)
  addEventListener('aiui:docs-load', (e) => S.docsLoad.push(e.detail ?? null))
  // Snapshot for track.py: the open skeleton stretch counts up to now.
  window.__preqaSnapshot = () => {
    const now = performance.now()
    const skel = S.skel.slice()
    if (S.skelSince !== null) skel.push({ at: Math.round(S.skelSince), ms: Math.round(now - S.skelSince), path: location.pathname, open: true })
    const own = location.origin
    const res = performance.getEntriesByType('resource').filter((e) => e.name.startsWith(own)).map((e) => {
      const connect = e.connectEnd > 0 ? e.connectEnd - e.connectStart + (e.domainLookupEnd - e.domainLookupStart) : 0
      return {
        url: e.name.slice(own.length), start: Math.round(e.startTime), dur: Math.round(e.duration),
        queue: e.requestStart > 0 ? Math.round(e.requestStart - e.fetchStart - connect) : null,
        x: e.transferSize, d: e.decodedBodySize,
      }
    })
    const nav = performance.getEntriesByType('navigation')[0]
    const docsLoad = Array.isArray(window.__aiuiDocsLoad) ? window.__aiuiDocsLoad : S.docsLoad
    return { now: Math.round(now), path: location.pathname, ready: S.ready, skel, res, docsLoad,
      html: nav ? { x: nav.transferSize, d: nav.decodedBodySize } : null }
  }
})()
