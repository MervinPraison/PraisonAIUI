"""Synthetic checks: headless Chromium against one or more targets.

Every timing is read in page time (``performance.now()``) by ``probe.js``:
first content is the moment the article heading is on screen with no loading
skeleton left; a navigation is timed from just before the click to that moment
on the new page.

Flows per target: cold + warm first content and reload for each page, sidebar
click-through (waiting for each page), rapid click-through (no waiting),
hover-prefetch then click, back/forward, search open + query, and the same
deep page opened in two tabs at once.

Issues recorded: requests held over 1 s before reaching the network (resource
timing ``requestStart`` missing, or queued > 1 s after DNS and connect),
requests stalled (over 5 s, or still open when a flow ends), failed requests,
console errors and page errors, skeleton on screen over 3 s, content that never
appeared, and the app's ``aiui:docs-load`` events when the build emits them.
"""

from __future__ import annotations

import json
import re
import time
import urllib.request
import uuid
from pathlib import Path

from . import budgets as budgets_mod
from .stats import summarize

PAGES = [
    "/",
    "/docs/getting-started/installation",
    "/docs/getting-started/quickstart",
    "/docs/features/plugins",
    "/docs/features/react-shell",
]
PROFILES = {"docs": {"ready": "#main-content h1", "skeleton": ".aiui-docs-skeleton",
                     "nav": "aside a[data-nav-path]", "start": "/docs/getting-started/installation",
                     "aliases": {"/docs/index": "/"}}}
HELD_MS, STALL_MS, OPEN_MS, SKELETON_MS = 1000, 5000, 3000, 3000
TIMEOUT_MS = 20000
PROBE = (Path(__file__).with_name("probe.js")).read_text(encoding="utf-8")
WAIT_READY = """([path, any, aliases]) => {
  const S = window.__preqa; if (!S) return false;
  const m = window.__preqaMark ?? 0, from = window.__preqaFrom;
  const norm = (p) => { p = p.replace(/\\/+$/, '') || '/'; return aliases[p] || p };
  const r = S.ready.find((r) => r.t >= m && r.h1 !== from && (any || norm(r.path) === path));
  return r ? { ms: Math.round(r.t - m), path: r.path } : false }"""
# Before an in-page action: remember the time and the heading on screen, so the
# old page (URL already changed, content not yet swapped) never counts as ready.
MARK = """(sel) => { window.__preqaFrom = document.querySelector(sel)?.textContent?.slice(0, 80);
  window.__preqaMark = performance.now() }"""


def kind_of(url: str) -> str:
    path = url.split("?")[0].split("#")[0]
    for ext, k in ((".js", "js"), (".mjs", "js"), (".css", "css"), (".json", "json"), (".md", "md"),
                   (".woff2", "font"), (".woff", "font"), (".html", "html")):
        if path.endswith(ext):
            return k
    return "other"


class Collector:
    def __init__(self, ignore: dict, profile: dict):
        self.profile = profile
        self.t: dict[str, list] = {}
        self.pages: dict[str, dict[str, list]] = {}
        self.issues: dict[str, list] = {k: [] for k in ("held", "stalled", "failed", "skeleton", "timeouts", "console")}
        self.docs_load: list = []
        self.bytes: dict[str, dict] = {}
        self.aborted = 0
        self.ignore = {k: [re.compile(p) for p in v] for k, v in (ignore or {}).items()}
        self._seen: set = set()
        self._pending: dict[int, dict] = {}

    def add(self, metric: str, ms, page: str | None = None, which: str | None = None):
        if ms is None:
            return
        self.t.setdefault(metric, []).append(ms)
        if page and which:
            self.pages.setdefault(page, {}).setdefault(which, []).append(ms)

    def ignored(self, kind: str, text: str) -> bool:
        return any(p.search(text) for p in self.ignore.get(kind, []))

    def issue(self, kind: str, **item):
        if kind in ("failed", "console") and self.ignored(kind, item.get("url", "") + " " + item.get("text", "")):
            return
        self.issues[kind].append(item)

    def attach(self, page, flow: str):
        pending: dict = self._pending.setdefault(id(page), {})

        def on_request(r):
            pending[r] = time.monotonic()

        def on_done(r):
            t0 = pending.pop(r, None)
            if t0 is not None and (time.monotonic() - t0) * 1000 > STALL_MS:
                self.issue("stalled", flow=flow, url=r.url, ms=round((time.monotonic() - t0) * 1000))

        def on_failed(r):
            pending.pop(r, None)
            err = r.failure or ""
            if "ERR_ABORTED" in err:  # navigation or the loader cancelled it: expected
                self.aborted += 1
            else:
                self.issue("failed", flow=flow, url=r.url, text=err)

        def on_response(resp):
            if resp.status >= 400:
                self.issue("failed", flow=flow, url=resp.url, text=f"HTTP {resp.status}")

        def on_console(msg):
            text = msg.text
            if text.startswith("aiui:docs-load"):
                self.docs_load.append({"flow": flow, "console": text[:300]})
            elif msg.type == "error":
                self.issue("console", flow=flow, text=text[:300])

        page.on("request", on_request)
        page.on("requestfinished", on_done)
        page.on("requestfailed", on_failed)
        page.on("response", on_response)
        page.on("console", on_console)
        page.on("pageerror", lambda e: self.issue("console", flow=flow, text=f"pageerror: {e}"[:300]))

    def drain(self, page, flow: str) -> dict | None:
        """Read the probe's snapshot: held requests, skeleton stretches, docs-load events."""
        try:
            snap = page.evaluate("() => window.__preqaSnapshot && window.__preqaSnapshot()")
        except Exception:  # page closed or crashed
            snap = None
        now = time.monotonic()
        pending = self._pending.get(id(page), {})
        for r, t0 in list(pending.items()):
            if (now - t0) * 1000 > OPEN_MS:
                pending.pop(r, None)
                self.issue("stalled", flow=flow, url=r.url, ms=round((now - t0) * 1000), open=True)
        if not snap:
            return None
        for e in snap["res"]:
            key = (id(page), e["url"], e["start"])
            if key in self._seen:
                continue
            self._seen.add(key)
            if e["queue"] is not None and e["queue"] > HELD_MS:
                self.issue("held", flow=flow, url=e["url"], ms=e["queue"], at=e["start"], reason="queued")
            elif e["queue"] is None and e["dur"] > HELD_MS:
                self.issue("held", flow=flow, url=e["url"], ms=e["dur"], at=e["start"], reason="requestStart=0")
        for s in snap["skel"]:
            self.t.setdefault("skeleton", []).append(s["ms"])
            key = (id(page), "skel", s["at"])
            if s["ms"] > SKELETON_MS and key not in self._seen and not s.get("open"):
                self._seen.add(key)
                self.issue("skeleton", flow=flow, url=s["path"], ms=s["ms"])
            elif s["ms"] > SKELETON_MS and s.get("open"):
                self.issue("skeleton", flow=flow, url=s["path"], ms=s["ms"], open=True)
        for ev in snap.get("docsLoad") or []:
            if isinstance(ev, dict):
                self.docs_load.append({"flow": flow, **ev})
        return snap

    def metrics(self) -> dict:
        m = {name: summarize(v) for name, v in self.t.items() if name != "skeleton"}
        m["skeleton_max_ms"] = max(self.t.get("skeleton", [0]) or [0])
        for k, n in (("held_requests", "held"), ("stalled_requests", "stalled"), ("failed_requests", "failed"),
                     ("console_errors", "console"), ("content_timeouts", "timeouts"),
                     ("skeleton_over_3s", "skeleton")):
            m[k] = len(self.issues[n])
        m["aborted_requests"] = self.aborted
        ms = [e["ms"] for e in self.docs_load if isinstance(e.get("ms"), (int, float))]
        bad = [e for e in self.docs_load if e.get("outcome") not in (None, "ok", "success", "hit", "cached")]
        m["docs_load_events"] = len(self.docs_load)
        m["docs_load_problems"] = len(bad)
        if ms:
            m["docs_load_ms"] = summarize(ms)
        if self.bytes:
            m["bytes"] = {k: max(b["bytes"].get(k, 0) for b in self.bytes.values()) for k in
                          ("js", "css", "font", "json", "md", "html", "total")}
            m["requests"] = {k: max(b["requests"].get(k, 0) for b in self.bytes.values()) for k in
                             ("js", "css", "font", "json", "md", "total")}
        return m


def _wait(page, col: Collector, flow: str, path: str | None, timeout: int = TIMEOUT_MS) -> float | None:
    aliases = col.profile.get("aliases", {})
    norm = (path or "").rstrip("/") or "/"
    try:
        h = page.wait_for_function(WAIT_READY, arg=[norm, path is None, aliases], timeout=timeout, polling=50)
        return h.json_value()["ms"]
    except Exception as exc:  # timeout or page error: the page never showed content
        col.issue("timeouts", flow=flow, url=path or page.url, text=str(exc).splitlines()[0][:200])
        return None


def _sidebar(page, sel: str) -> list[str]:
    return page.evaluate(
        "(sel) => [...new Set([...document.querySelectorAll(sel)].filter(a => a.offsetParent)"
        ".map(a => a.getAttribute('href')))]", sel)


def _click(page, sel: str, href: str):
    page.locator(f'{sel}[href="{href}"]').first.click(timeout=5000)


def run_target(browser, base: str, col: Collector, prof: dict, pages: list[str], runs: int,
               stop=lambda: False) -> None:
    def ctx():
        c = browser.new_context(viewport={"width": 1280, "height": 800})
        c.add_init_script(f"window.__preqaCfg = {json.dumps(prof)};\n{PROBE}")
        return c

    # 1. cold / warm first content, bytes, reload
    for path in pages:
        for i in range(runs):
            c = ctx()
            p = c.new_page()
            col.attach(p, "cold")
            p.goto(base + path, wait_until="commit")
            col.add("first_content_cold_ms", _wait(p, col, "cold", path), path, "cold")
            if i == 0:
                p.wait_for_timeout(2500)
                snap = col.drain(p, "cold")
                if snap:
                    b, n = {"total": 0}, {"total": 0}
                    for e in snap["res"]:
                        k = kind_of(e["url"])
                        b[k] = b.get(k, 0) + e["x"]
                        n[k] = n.get(k, 0) + 1
                        b["total"] += e["x"]
                        n["total"] += 1
                    b["html"] = (snap.get("html") or {}).get("x", 0)
                    b["total"] += b["html"]
                    col.bytes[path] = {"bytes": b, "requests": n}
            else:
                col.drain(p, "cold")
            p.goto(base + path, wait_until="commit")
            col.add("first_content_warm_ms", _wait(p, col, "warm", path), path, "warm")
            col.drain(p, "warm")
            p.reload(wait_until="commit")
            col.add("reload_ms", _wait(p, col, "reload", path), path, "reload")
            col.drain(p, "reload")
            c.close()
        if stop():
            return

    # 2. sidebar click-through (wait for each page), then back / forward
    c = ctx()
    p = c.new_page()
    col.attach(p, "nav")
    p.goto(base + prof["start"], wait_until="commit")
    _wait(p, col, "nav", prof["start"])
    p.wait_for_timeout(1500)
    links = [h for h in _sidebar(p, prof["nav"]) if h and h.rstrip("/") != prof["start"]]
    visited = [prof["start"]]
    for href in links[:8]:
        p.evaluate(MARK, prof["ready"])
        _click(p, prof["nav"], href)
        col.add("nav_ms", _wait(p, col, "nav", href))
        visited.append(href)
        p.wait_for_timeout(300)
    for back in reversed(visited[-4:-1]):
        p.evaluate(MARK, prof["ready"])
        p.go_back(wait_until="commit")
        col.add("back_forward_ms", _wait(p, col, "back", back))
    for fwd in visited[-3:-1]:
        p.evaluate(MARK, prof["ready"])
        p.go_forward(wait_until="commit")
        col.add("back_forward_ms", _wait(p, col, "forward", fwd))
    col.drain(p, "nav")
    c.close()
    if stop():
        return

    # 3. hover-prefetch then click (fresh context: nothing cached)
    c = ctx()
    p = c.new_page()
    col.attach(p, "hover")
    p.goto(base + prof["start"], wait_until="commit")
    _wait(p, col, "hover", prof["start"])
    p.wait_for_timeout(1000)
    for href in links[8:12] or links[:4]:
        p.locator(f'{prof["nav"]}[href="{href}"]').first.hover(timeout=5000)
        p.wait_for_timeout(400)
        p.evaluate(MARK, prof["ready"])
        _click(p, prof["nav"], href)
        col.add("hover_nav_ms", _wait(p, col, "hover", href))
    col.drain(p, "hover")
    c.close()

    # 4. rapid click-through: 8 clicks 120 ms apart, the last page must show
    c = ctx()
    p = c.new_page()
    col.attach(p, "rapid")
    p.goto(base + prof["start"], wait_until="commit")
    _wait(p, col, "rapid", prof["start"])
    burst = (links[12:20] if len(links) >= 20 else links[-8:])
    for href in burst:
        p.evaluate(MARK, prof["ready"])
        _click(p, prof["nav"], href)
        p.wait_for_timeout(120)
    if burst:
        col.add("rapid_final_ms", _wait(p, col, "rapid", burst[-1]))
    p.wait_for_timeout(500)
    col.drain(p, "rapid")
    c.close()
    if stop():
        return

    # 5. search: open the dialog, type a query, wait for results
    c = ctx()
    p = c.new_page()
    col.attach(p, "search")
    p.goto(base + prof["start"], wait_until="commit")
    _wait(p, col, "search", prof["start"])
    p.wait_for_timeout(1000)
    try:
        p.evaluate(MARK, prof["ready"])
        p.keyboard.press("Control+k")
        p.wait_for_selector("[role=dialog] input", timeout=10000)
        col.add("search_open_ms", p.evaluate("() => Math.round(performance.now() - window.__preqaMark)"))
        p.evaluate(MARK, prof["ready"])
        p.locator("[role=dialog] input").first.fill("install")
        p.wait_for_function("() => [...document.querySelectorAll('[cmdk-item]')].some(e => /install/i.test(e.textContent))",
                            timeout=15000, polling=50)
        col.add("search_query_ms", p.evaluate("() => Math.round(performance.now() - window.__preqaMark)"))
    except Exception as exc:
        col.issue("timeouts", flow="search", url=prof["start"], text=str(exc).splitlines()[0][:200])
    col.drain(p, "search")
    c.close()

    # 6. two tabs: the same deep page, opened at once in one profile
    deep = pages[-1]
    c = ctx()
    tabs = [c.new_page(), c.new_page()]
    for t in tabs:
        col.attach(t, "two-tabs")
    for t in tabs:
        t.goto(base + deep, wait_until="commit")
    for t in tabs:
        col.add("two_tabs_ms", _wait(t, col, "two-tabs", deep))
        col.drain(t, "two-tabs")
    c.close()


def _sha(base: str, timeout: float = 10) -> str:
    """The commit a target serves: pre-QA writes preqa-build.json; Pages deploys say 'deploy: <sha>'."""
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/preqa-build.json", timeout=timeout) as r:
            return json.load(r).get("sha", "")
    except Exception:
        pass
    if "ui.praison.ai" in base:
        try:
            req = urllib.request.Request("https://api.github.com/repos/MervinPraison/PraisonAIUI/commits/gh-pages",
                                         headers={"Accept": "application/vnd.github+json", "User-Agent": "preqa"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                msg = json.load(r)["commit"]["message"]
            return msg.split("deploy:", 1)[1].split()[0] if "deploy:" in msg else ""
        except Exception:
            return ""
    return ""


def track(targets: dict[str, str], budgets: dict, pages: list[str] | None = None, runs: int = 3,
          profile: str = "docs", fail_fast: bool = False) -> list[dict]:
    """Run every flow on every target; one history record per target."""
    from playwright.sync_api import sync_playwright  # only the tracker needs Playwright

    from .history import utc_now

    run_id = uuid.uuid4().hex[:12]
    records = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for name, base in targets.items():
            base = base.rstrip("/")
            col = Collector(budgets.get("ignore", {}), PROFILES[profile])
            rec = {"ts": utc_now(), "run_id": run_id, "target": name, "base": base, "sha": _sha(base),
                   "profile": profile, "runs": runs}

            def stop():
                partial = col.metrics()
                return fail_fast and any(b["kind"] != "missing" for b in
                                         budgets_mod.compare(partial, budgets, name))
            t0 = time.time()
            try:
                run_target(browser, base, col, PROFILES[profile], pages or PAGES, runs, stop)
            except Exception as exc:  # a flow crashed: the run fails, the data so far is kept
                rec["error"] = f"{type(exc).__name__}: {exc}"[:500]
            rec["duration_s"] = round(time.time() - t0, 1)
            rec["metrics"] = col.metrics()
            rec["pages"] = {path: {**{f"{w}_p95": summarize(v).get("p95") for w, v in d.items()}, **d}
                            for path, d in col.pages.items()}
            rec["issues"] = col.issues
            rec["docs_load"] = col.docs_load[-200:]
            rec["breaches"] = budgets_mod.compare(rec["metrics"], budgets, name)
            rec["status"] = "FAIL" if rec["breaches"] or rec.get("error") else "PASS"
            records.append(rec)
        browser.close()
    return records
