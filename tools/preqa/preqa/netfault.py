"""Network fault check: a docs page opened after the connection went dead while idle.

Some networks silently drop an idle TCP connection after 15-30 s (seen on a
home router over IPv6). The browser does not know: it sends the next request
down its one HTTP/2 connection to the site and waits. This check reproduces
that with ``netfault.mjs`` in front of a running pre-QA server:

1. open a docs page and click to a second one (the connection is alive),
2. stay idle until the front freezes the connection,
3. move the pointer (the visitor is back), and RETURN_MS later click to a
   third page that was not prefetched; time how long its content takes.

A docs client that retries on the same dead connection shows the error panel
("Couldn't load this page") or takes as long as the browser needs to notice;
one that moves to a fresh connection shows the page within a few seconds.

    python -m preqa netfault --upstream http://127.0.0.1:8700 [--freeze-idle-ms 12000]

Needs ``node`` and ``openssl`` on PATH. Exit 0 = within budget, 1 = breach.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

HERE = Path(__file__).parent
START = "/docs/getting-started/installation"
NAV = "aside a[data-nav-path]"
READY = "#main-content h1"
SKELETON = ".aiui-docs-skeleton"
ERROR_TEXT = "Couldn't load this page"
BUDGET_MS = 2500
# The visitor moves the pointer this long before the click (reading the sidebar).
RETURN_MS = 800
TIMEOUT_MS = 40000

# Resolves to {ms, outcome} once the heading changed from `from` and no skeleton
# is on screen ("ok"), or the docs error panel is up ("error").
WAIT = """([from, ready, skel, err, t0]) => {
  const h = document.querySelector(ready), sk = document.querySelector(skel);
  if ([...document.querySelectorAll('[role=alert]')].some((e) => e.textContent.includes(err))) return { ms: Math.round(performance.now() - t0), outcome: 'error' };
  if (h && !sk && h.textContent.slice(0, 80) !== from) return { ms: Math.round(performance.now() - t0), outcome: 'ok' };
  return false }"""


def _cert(d: Path) -> tuple[str, str]:
    cert, key = d / "cert.pem", d / "key.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                    "-keyout", str(key), "-out", str(cert)], check=True, capture_output=True)
    return str(cert), str(key)


class Front:
    """netfault.mjs as a child process; its JSON event lines are collected."""

    def __init__(self, upstream: str, freeze_ms: int):
        self.dir = Path(tempfile.mkdtemp(prefix="preqa-netfault-"))
        cert, key = _cert(self.dir)
        self.proc = subprocess.Popen(
            ["node", str(HERE / "netfault.mjs"), "--upstream", upstream, "--cert", cert, "--key", key,
             "--freeze-idle-ms", str(freeze_ms)], stdout=subprocess.PIPE, text=True)
        self.events: list[dict] = []
        self.port: int | None = None
        ready = threading.Event()

        def read():
            for line in self.proc.stdout:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                self.events.append(ev)
                if "listen" in ev:
                    self.port = ev["listen"]
                    ready.set()
        threading.Thread(target=read, daemon=True).start()
        if not ready.wait(15):
            self.close()
            raise RuntimeError("netfault.mjs did not start")

    def count(self, kind: str) -> int:
        return sum(1 for e in self.events if kind in e)

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.dir, ignore_errors=True)


def _open(page, href: str) -> dict:
    """Click the sidebar link to `href` and wait for its content or the error panel."""
    before = page.evaluate("(s) => document.querySelector(s)?.textContent?.slice(0, 80)", READY)
    t0 = page.evaluate("() => performance.now()")
    page.evaluate("(h) => console.warn('netfault: open ' + h)", href)
    page.locator(f'{NAV}[href="{href}"]').first.click(timeout=5000)
    try:
        h = page.wait_for_function(WAIT, arg=[before, READY, SKELETON, ERROR_TEXT, t0], timeout=TIMEOUT_MS, polling=50)
        return {"href": href, **h.json_value()}
    except Exception:
        return {"href": href, "ms": TIMEOUT_MS, "outcome": "timeout"}


def _unfetched(page, links: list[str]) -> list[str]:
    """Links whose Markdown this page has not requested (no prefetch, no visit)."""
    got = set(page.evaluate("() => performance.getEntriesByType('resource').map(e => new URL(e.name).pathname)"))
    return [h for h in links if h.rstrip("/") + ".source.md" not in got]


def run(upstream: str, freeze_ms: int = 12000, budget_ms: int = BUDGET_MS, headless: bool = True) -> dict:
    from playwright.sync_api import sync_playwright

    front = Front(upstream, freeze_ms)
    base = f"https://127.0.0.1:{front.port}"
    rec: dict = {"check": "netfault", "upstream": upstream, "freeze_idle_ms": freeze_ms, "budget_ms": budget_ms}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=headless)
            ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
            page = ctx.new_page()
            logs: list[str] = rec.setdefault("console", [])
            page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:400]) if m.type in ("warning", "error") else None)
            page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"[:400]))
            page.on("requestfailed", lambda r: logs.append(f"requestfailed: {r.url} {r.failure}"[:400]))
            page.goto(base + START, wait_until="load")
            page.wait_for_selector(READY, timeout=TIMEOUT_MS)
            page.wait_for_timeout(1500)  # let after-load prefetch settle
            links = page.evaluate(
                "(s) => [...new Set([...document.querySelectorAll(s)].filter(a => a.offsetParent)"
                ".map(a => a.getAttribute('href')))]", NAV)
            links = [h for h in links if h and h.rstrip("/") not in (START, "")]
            rec["warm"] = _open(page, _unfetched(page, links)[0])
            rec["protocol"] = page.evaluate("() => performance.getEntriesByType('navigation')[0]?.nextHopProtocol")
            page.wait_for_timeout(1000)
            # Pages not prefetched yet, so each click needs the network.
            todo = _unfetched(page, links)
            if len(todo) < 2:
                raise RuntimeError(f"need 2 unfetched sidebar links, found {todo}")
            frozen = front.count("freeze")
            page.wait_for_timeout(freeze_ms + 2000)  # idle: the front freezes the connection
            rec["frozen_while_idle"] = front.count("freeze") - frozen
            page.mouse.move(200, 300)  # the visitor is back
            page.mouse.move(220, 320)
            page.wait_for_timeout(RETURN_MS)
            rec["after_idle"] = _open(page, todo[0])
            rec["next"] = _open(page, todo[-1])
            rec["docs_load"] = page.evaluate("() => (window.__aiuiDocsLoad || []).slice(-12)")
            browser.close()
    finally:
        rec["connections"] = front.count("conn")
        rec["frozen"] = front.count("freeze")
        front.close()
    a = rec["after_idle"]
    rec["ok"] = a["outcome"] == "ok" and a["ms"] <= budget_ms and rec["next"]["outcome"] == "ok"
    return rec


def main(argv=None) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="preqa netfault", description=__doc__.splitlines()[0])
    p.add_argument("--upstream", default="http://127.0.0.1:8700", help="a running pre-QA server")
    p.add_argument("--freeze-idle-ms", type=int, default=12000)
    p.add_argument("--budget-ms", type=int, default=BUDGET_MS)
    p.add_argument("--out", help="also write the record to this JSON file")
    a = p.parse_args(argv)
    t = time.time()
    rec = run(a.upstream, a.freeze_idle_ms, a.budget_ms)
    rec["seconds"] = round(time.time() - t, 1)
    text = json.dumps(rec, indent=2)
    print(text)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")
    a_ = rec["after_idle"]
    print(f"netfault: {'PASS' if rec['ok'] else 'FAIL'}: page after idle {a_['outcome']} in {a_['ms']} ms "
          f"(budget {a.budget_ms} ms, {rec['frozen']} connection(s) frozen, {rec['connections']} opened)")
    return 0 if rec["ok"] else 1
