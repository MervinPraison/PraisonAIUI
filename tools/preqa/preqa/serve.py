"""Serve a built site the way GitHub Pages does, plus the tracker dashboard at /preqa/.

Production behaviour copied here: ``Cache-Control: max-age=600`` on every
file (HTML, fixed-name ``index.js?v=`` and hashed chunks alike), ETag and
Last-Modified with 304s, gzip for text, ``/a/b`` resolving to ``a/b.html`` or
``a/b/index.html`` (a directory without its slash is redirected, 301), and the
site's ``404.html`` with status 404 for anything else. The site directory is
resolved per request, so a symlink swapped by a rebuild takes effect at once.

Binds 127.0.0.1 by default. Reach it with ``ssh -L 8700:127.0.0.1:8700 <host>``.
"""

from __future__ import annotations

import argparse
import email.utils
import gzip
import mimetypes
import os
import posixpath
import urllib.parse
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE_MAX_AGE = 600
TEXT_TYPES = ("text/", "application/javascript", "application/json", "image/svg+xml", "application/xml")
for ext, typ in ((".md", "text/markdown"), (".mjs", "application/javascript"), (".js", "application/javascript"),
                 (".woff2", "font/woff2"), (".webp", "image/webp"), (".json", "application/json")):
    mimetypes.add_type(typ, ext)


@lru_cache(maxsize=512)
def _gzip(path: str, mtime: float, size: int) -> bytes:
    with open(path, "rb") as f:
        return gzip.compress(f.read(), compresslevel=6, mtime=0)


def resolve(root: Path, url_path: str) -> tuple[str, Path | None]:
    """("file"|"redirect"|"missing", path) for a URL path under ``root``."""
    rel = posixpath.normpath(urllib.parse.unquote(url_path)).lstrip("/")
    if rel in (".", ""):
        rel = ""
    if rel.startswith("..") or "\x00" in rel:
        return "missing", None
    base = root.resolve()
    cand = (base / rel).resolve() if rel else base
    if base not in cand.parents and cand != base:
        return "missing", None
    if cand.is_file():
        return "file", cand
    html = cand.with_name(cand.name + ".html") if rel else None
    if cand.is_dir():
        if url_path.endswith("/") or not rel:
            index = cand / "index.html"
            return ("file", index) if index.is_file() else ("missing", None)
        if html and html.is_file():  # Pages prefers a.html over redirecting a/ -> a/
            return "file", html
        return "redirect", None
    if html and html.is_file():
        return "file", html
    return "missing", None


def make_handler(site: Path, dashboard: Path | None, history: Path | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "preqa"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet; systemd journal keeps errors only
            pass

        def do_HEAD(self):
            self.do_GET(head=True)

        def do_GET(self, head: bool = False):
            path = urllib.parse.urlsplit(self.path).path
            root, max_age, prefix = site, SITE_MAX_AGE, ""
            if path == "/preqa":
                return self._redirect("/preqa/")
            if dashboard and path.startswith("/preqa/history/") and history:
                prefix = "/preqa/history"
                root, max_age, path = history, 0, path[len(prefix):]
            elif dashboard and path.startswith("/preqa/"):
                prefix = "/preqa"
                root, max_age, path = dashboard, 0, path[len(prefix):]
            kind, file = resolve(root, path)
            if kind == "redirect":  # keep the mount prefix; one leading slash, never a //host redirect
                return self._redirect(prefix + "/" + path.lstrip("/") + "/")
            status = 200
            if kind == "missing":
                status, file = 404, root / "404.html"
                if not file.is_file():
                    return self._send(404, b"Not Found", "text/plain", head=head)
            self._file(status, file, max_age, head)

        def _redirect(self, location: str):
            self.send_response(301)
            self.send_header("Location", location)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _send(self, status, body, ctype, head=False, extra=()):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in extra:
                self.send_header(k, v)
            self.end_headers()
            if not head:
                self.wfile.write(body)

        def _file(self, status: int, file: Path, max_age: int, head: bool):
            st = file.stat()
            etag = f'"{int(st.st_mtime):x}-{st.st_size:x}"'
            ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            headers = [
                ("Cache-Control", f"max-age={max_age}" if max_age else "no-cache"),
                ("ETag", etag),
                ("Last-Modified", email.utils.formatdate(st.st_mtime, usegmt=True)),
                ("Vary", "Accept-Encoding"),
            ]
            if status == 200 and self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                for k, v in headers:
                    self.send_header(k, v)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            gz = "gzip" in (self.headers.get("Accept-Encoding") or "")
            if gz and ctype.startswith(TEXT_TYPES) and st.st_size > 512:
                body = _gzip(str(file), st.st_mtime, st.st_size)
                headers.append(("Content-Encoding", "gzip"))
            else:
                body = file.read_bytes()
            self._send(status, body, ctype, head=head, extra=headers)

    return Handler


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--site", required=True, help="built site directory (a symlink is followed per request)")
    p.add_argument("--dashboard", help="directory served at /preqa/ (report.json + index.html)")
    p.add_argument("--history", help="history directory served at /preqa/history/")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8700)
    a = p.parse_args(argv)
    if a.host not in ("127.0.0.1", "localhost", "::1") and not os.environ.get("PREQA_ALLOW_PUBLIC"):
        raise SystemExit("refusing to bind a public address (set PREQA_ALLOW_PUBLIC=1 to override)")
    handler = make_handler(Path(a.site), Path(a.dashboard) if a.dashboard else None,
                           Path(a.history) if a.history else None)
    httpd = ThreadingHTTPServer((a.host, a.port), handler)
    httpd.daemon_threads = True
    print(f"preqa: serving {a.site} on http://{a.host}:{a.port}/ (dashboard /preqa/)", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
