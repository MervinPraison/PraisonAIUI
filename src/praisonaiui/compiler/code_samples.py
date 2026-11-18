"""Request examples for endpoint pages (docs/features/openapi.md#request-examples).

:func:`request_examples` writes a ``<RequestExample>`` with one fence per language,
made at build time from the operation: its server URL, path / query / header /
cookie parameters, the security scheme as a placeholder and the request body (its
example, else one made from the schema). The spec's own ``x-codeSamples`` /
``x-code-samples`` come first and replace a generated sample in their language.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import quote

from praisonaiui.compiler.openapi import ApiSpec, Operation
from praisonaiui.compiler.openapi_pages import (
    _CYCLE,
    _attr,
    _fence,
    _media,
    media_examples,
    merged,
    sample,
    server_url,
)

# name -> (tab label, fence language)
LANGUAGES: dict[str, tuple[str, str]] = {
    "curl": ("cURL", "bash"), "python": ("Python", "python"), "javascript": ("JavaScript", "javascript"),
    "go": ("Go", "go"), "java": ("Java", "java"), "ruby": ("Ruby", "ruby"), "php": ("PHP", "php"),
    "csharp": ("C#", "csharp"), "rust": ("Rust", "rust"), "swift": ("Swift", "swift"),
}
DEFAULT_LANGUAGES = ["curl", "python", "javascript"]
ALIASES = {"shell": "curl", "sh": "curl", "bash": "curl", "py": "python", "python3": "python",
           "js": "javascript", "node": "javascript", "nodejs": "javascript", "golang": "go",
           "rb": "ruby", "cs": "csharp", "c#": "csharp", "dotnet": "csharp", "rs": "rust"}
BASE_URL = "https://api.example.com"  # a spec without an absolute server
_STANDARD = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
_IGNORED = {"accept", "content-type", "authorization"}


def language(name: Any) -> str:
    """``node`` -> ``javascript``; an unknown name lower-cased as is."""
    key = str(name or "").strip().lower()
    return ALIASES.get(key, key)


@dataclass
class Request:
    """What every sample sends."""

    method: str
    url: str  # query string included
    headers: list[tuple[str, str]] = field(default_factory=list)  # Content-Type last
    body: Any = None  # a JSON value (``json``), a str, or form fields (``multipart``)
    kind: str = ""  # "json", "multipart", "text" ("" no body)
    files: set[str] = field(default_factory=set)  # multipart fields that are files


def _explicit(spec: ApiSpec, param: dict) -> Any:
    """A parameter's written example (``example``, ``examples``, the schema's
    example / default / const / enum), else ``_CYCLE``."""
    if "example" in param:
        return param["example"]
    for entry in (param["examples"].values() if isinstance(param.get("examples"), dict) else ()):
        entry = spec.resolve(entry)
        if isinstance(entry, dict) and "value" in entry:
            return entry["value"]
    s = merged(spec, param.get("schema") or {})
    for key in ("example", "default", "const"):
        if key in s:
            return s[key]
    for key in ("examples", "enum"):
        if isinstance(s.get(key), list) and s[key]:
            return s[key][0]
    return _CYCLE


def _text(value: Any) -> str:
    return "true" if value is True else "false" if value is False else (
        value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))


def _auth(spec: ApiSpec, op: Operation) -> list[tuple[str, str, str]]:
    """``(in, name, placeholder)`` for the first security requirement's schemes."""
    schemes = (spec.document.get("components") or {}).get("securitySchemes") or {}
    out = []
    for name in (op.security[0] if op.security and isinstance(op.security[0], dict) else {}):
        s = spec.resolve(schemes.get(name))
        kind = s.get("type") if isinstance(s, dict) else None
        scheme = str(s.get("scheme") or "").lower() if isinstance(s, dict) else ""
        if kind == "apiKey" and s.get("in") in ("header", "query", "cookie"):
            out.append((s["in"], str(s.get("name") or "api_key"), "<api-key>"))
        elif kind == "http" and scheme == "basic":
            out.append(("header", "Authorization", "Basic <encoded-value>"))
        elif kind == "http" and scheme and scheme != "bearer":
            out.append(("header", "Authorization", f"{s['scheme']} <token>"))
        elif kind in ("http", "oauth2", "openIdConnect"):
            out.append(("header", "Authorization", "Bearer <token>"))
    return out


def build_request(spec: ApiSpec, op: Operation) -> Request:
    """The request a sample sends: required parameters and those with an example,
    path parameters without one left as ``{name}``."""
    base = next((u for u in map(server_url, op.servers) if u), "")
    base = base if re.match(r"https?://", base) else BASE_URL + ("/" + base.lstrip("/") if base else "")
    found: list[tuple[str, str, Any]] = []
    path_values: dict[str, Any] = {}
    for p in op.parameters:
        where, name = p.get("in"), str(p.get("name"))
        value = _explicit(spec, p)
        if where == "path":
            path_values[name] = value
        elif where in ("query", "header", "cookie") and (p.get("required") or value is not _CYCLE) and not (
                where == "header" and name.lower() in _IGNORED):  # OpenAPI: set by the request itself
            found.append((where, name, sample(spec, p.get("schema") or {}) if value is _CYCLE else value))
    path = re.sub(r"{([^{}]+)}", lambda m: m.group(0) if path_values.get(m.group(1), _CYCLE) is _CYCLE
                  else quote(_text(path_values[m.group(1)]), safe=""), op.path)
    found = [*_auth(spec, op), *found]
    pairs = [(n, x) for w, n, v in found if w == "query" for x in (v if isinstance(v, list) else [v])]
    query = "&".join(f"{quote(n, safe='')}={quote(_text(x), safe='<>{}:,@')}" for n, x in pairs)
    headers = [(n, _text(v)) for w, n, v in found if w == "header"]
    cookies = "; ".join(f"{n}={_text(v)}" for w, n, v in found if w == "cookie")
    headers += [("Cookie", cookies)] * bool(cookies)
    request = Request(op.method, base + path + ("?" + query if query else ""), headers)
    kind, media = _media((op.request_body or {}).get("content"))
    if kind:
        examples = media_examples(spec, kind, media, "readOnly")
        value = examples[0][1] if examples else sample(spec, media.get("schema"), skip="readOnly") if (
            media.get("schema")) else None
        if "multipart/form-data" in kind:
            props = merged(spec, media.get("schema")).get("properties") or {}
            request.kind, request.body = "multipart", value if isinstance(value, dict) else {}
            request.files = {k for k, v in props.items() if merged(spec, v).get("format") in ("binary", "byte")
                             or merged(spec, v).get("contentMediaType")}
            return request
        if "json" in kind:
            request.kind, request.body = "json", {} if value is None or value is _CYCLE else value
        elif "x-www-form-urlencoded" in kind and isinstance(value, dict):
            request.kind = "text"
            request.body = "&".join(f"{quote(str(k))}={quote(_text(v))}" for k, v in value.items())
        elif value is not None and value is not _CYCLE:
            request.kind, request.body = "text", _text(value)
        request.headers += [("Content-Type", kind)] * bool(request.kind)
    return request


def _body(r: Request) -> str:
    return json.dumps(r.body, indent=2, ensure_ascii=False) if r.kind == "json" else str(r.body)


def _q(text: str) -> str:
    """A double-quoted string literal (JSON escapes: valid in every language here)."""
    return json.dumps(text, ensure_ascii=False)


def _sq(text: str) -> str:
    """A single-quoted Ruby / PHP string literal."""
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _indent(text: str, by: str) -> str:
    return "\n".join(by + line if line else line for line in text.splitlines())


def _fields(r: Request) -> list[tuple[str, str, bool]]:
    """Form fields ``(name, value, is a file)``."""
    return [(str(k), _text(v), k in r.files) for k, v in r.body.items()]


def _curl(r: Request) -> str:
    def sh(text: str) -> str:
        return "'" + text.replace("'", "'\\''") + "'"
    lines = [f"curl --request {r.method}", f"--url {sh(r.url)}",
             *(f"--header {sh(f'{k}: {v}')}" for k, v in r.headers)]
    if r.kind == "multipart":
        lines += [f"--form {sh(f'{k}=@example-file' if f else f'{k}={v}')}" for k, v, f in _fields(r)]
    elif r.kind:
        lines.append(f"--data {sh(_body(r))}")
    return " \\\n  ".join(lines)


def _python(r: Request) -> str:
    def lit(v: Any, ind: str = "") -> str:
        inner = ind + "    "
        if isinstance(v, dict) and v:
            return "{\n" + ",\n".join(f"{inner}{_q(str(k))}: {lit(x, inner)}" for k, x in v.items()) + f"\n{ind}}}"
        if isinstance(v, list) and v:
            return "[\n" + ",\n".join(inner + lit(x, inner) for x in v) + f"\n{ind}]"
        return "True" if v is True else "False" if v is False else "None" if v is None else (
            json.dumps(v, ensure_ascii=False))
    headers = [(k, v) for k, v in r.headers if r.kind != "json" or k != "Content-Type"]
    lines, args = ["import requests", "", f"url = {_q(r.url)}"], ["url"]
    if r.kind == "multipart":
        files = ",\n".join(f"    {_q(k)}: " + ('open("example-file", "rb")' if f else f"(None, {_q(v)})")
                            for k, v, f in _fields(r))
        lines.append("files = {\n" + files + "\n}" if files else "files = {}")
        args.append("files=files")
    elif r.kind:
        lines.append(f"payload = {lit(r.body) if r.kind == 'json' else _q(r.body)}")
        args.append("json=payload" if r.kind == "json" else "data=payload")
    if headers:
        lines.append("headers = " + lit(dict(headers)))
        args.append("headers=headers")
    call = (f"requests.{r.method.lower()}(" if r.method in _STANDARD else f"requests.request({_q(r.method)}, ") \
        + ", ".join(args) + ")"
    return "\n".join([*lines, "", f"response = {call}", "", "print(response.text)"])


def _javascript(r: Request) -> str:
    opts = [f"method: {_q(r.method)}"]
    lines = []
    if r.headers:
        opts.append("headers: " + _indent(json.dumps(dict(r.headers), indent=2, ensure_ascii=False), "  ").lstrip())
    if r.kind == "multipart":
        lines = ["const form = new FormData();", *(f"form.append({_q(k)}, " + (
            'new Blob(["<file contents>"]), "example-file");' if f else f"{_q(v)});") for k, v, f in _fields(r)), ""]
        opts.append("body: form")
    elif r.kind:
        body = _indent(_body(r), "  ").lstrip() if r.kind == "json" else _q(r.body)
        opts.append(f"body: JSON.stringify({body})" if r.kind == "json" else f"body: {body}")
    return "\n".join([*lines, "const options = {", ",\n".join("  " + o for o in opts), "};", "",
                      f"const response = await fetch({_q(r.url)}, options);",
                      "console.log(await response.text());"])


def _go(r: Request) -> str:
    text = _body(r)
    payload = f"`{text}`" if "`" not in text else _q(text)
    imports = ["fmt", "io", "net/http", *(["strings"] * bool(r.kind))]
    return "\n".join([
        "package main", "", "import (", *(f'\t"{i}"' for i in imports), ")", "", "func main() {",
        *([f"\tpayload := strings.NewReader({payload})", ""] if r.kind else []),
        f"\treq, _ := http.NewRequest({_q(r.method)}, {_q(r.url)}, {'payload' if r.kind else 'nil'})",
        *(f"\treq.Header.Add({_q(k)}, {_q(v)})" for k, v in r.headers),
        "", "\tres, _ := http.DefaultClient.Do(req)", "\tdefer res.Body.Close()",
        "\tbody, _ := io.ReadAll(res.Body)", "\tfmt.Println(string(body))", "}"])


def _java(r: Request) -> str:
    text = _body(r).replace("\\", "\\\\").replace('"""', '\\"""')
    body = 'HttpRequest.BodyPublishers.ofString("""\n' + _indent(text, "        ") + '\n        """)' \
        if r.kind else "HttpRequest.BodyPublishers.noBody()"
    return "\n".join([
        "import java.net.URI;", "import java.net.http.HttpClient;", "import java.net.http.HttpRequest;",
        "import java.net.http.HttpResponse;", "", "HttpRequest request = HttpRequest.newBuilder()",
        f"    .uri(URI.create({_q(r.url)}))", *(f"    .header({_q(k)}, {_q(v)})" for k, v in r.headers),
        f"    .method({_q(r.method)}, {body})", "    .build();",
        "HttpResponse<String> response = HttpClient.newHttpClient()",
        "    .send(request, HttpResponse.BodyHandlers.ofString());", "System.out.println(response.body());"])


def _ruby(r: Request) -> str:
    cls = r.method.capitalize() if r.method in _STANDARD else None
    new = f"Net::HTTP::{cls}.new(url)" if cls else \
        f"Net::HTTPGenericRequest.new({_q(r.method)}, {str(bool(r.kind)).lower()}, true, url)"
    body = ["request.body = <<~'BODY'", _indent(_body(r), "  "), "BODY"] if r.kind == "json" else \
        [f"request.body = {_sq(_body(r))}"] if r.kind else []
    return "\n".join([
        'require "uri"', 'require "net/http"', "", f"url = URI({_q(r.url)})", "",
        "http = Net::HTTP.new(url.host, url.port)", *(["http.use_ssl = true"] * r.url.startswith("https")),
        "", f"request = {new}", *(f"request[{_q(k)}] = {_sq(v)}" for k, v in r.headers), *body, "",
        "response = http.request(request)", "puts response.read_body"])


def _php(r: Request) -> str:
    opts = [f"CURLOPT_URL => {_sq(r.url)}", "CURLOPT_RETURNTRANSFER => true",
            f"CURLOPT_CUSTOMREQUEST => {_sq(r.method)}"]
    if r.kind == "json":
        opts.append("CURLOPT_POSTFIELDS => <<<'BODY'\n" + _indent(_body(r), "    ") + "\n    BODY")
    elif r.kind:
        opts.append(f"CURLOPT_POSTFIELDS => {_sq(_body(r))}")
    if r.headers:
        opts.append("CURLOPT_HTTPHEADER => [\n" + ",\n".join(f"    {_sq(f'{k}: {v}')}" for k, v in r.headers)
                    + ",\n  ]")
    return "\n".join(["<?php", "", "$curl = curl_init();", "", "curl_setopt_array($curl, [",
                      ",\n".join("  " + o for o in opts) + ",", "]);", "",
                      "$response = curl_exec($curl);", "curl_close($curl);", "", "echo $response;"])


def _csharp(r: Request) -> str:
    kind = next((v for k, v in r.headers if k == "Content-Type"), "text/plain")
    text = _body(r)
    quotes = '"' * max([3, *(len(m) + 1 for m in re.findall(r'"+', text))])
    content = [f"request.Content = new StringContent({quotes}", _indent(text, "    "),
               f"    {quotes}, Encoding.UTF8, {_q(kind)});"] if r.kind else []
    return "\n".join([
        "using System.Text;", "", "using var client = new HttpClient();",
        f"var request = new HttpRequestMessage(new HttpMethod({_q(r.method)}), {_q(r.url)});",
        *(f"request.Headers.Add({_q(k)}, {_q(v)});" for k, v in r.headers if k != "Content-Type"), *content,
        "", "var response = await client.SendAsync(request);",
        "Console.WriteLine(await response.Content.ReadAsStringAsync());"])


def _rust(r: Request) -> str:
    call = f".{r.method.lower()}({_q(r.url)})" if r.method in _STANDARD else \
        f'.request(reqwest::Method::from_bytes(b"{r.method}").unwrap(), {_q(r.url)})'
    body = [f"        .json(&json!({_indent(_body(r), '        ').lstrip()}))"] if r.kind == "json" else \
        [f"        .body({_q(_body(r))})"] if r.kind else []
    return "\n".join([
        *(["use serde_json::json;", ""] if r.kind == "json" else []), "#[tokio::main]",
        "async fn main() -> Result<(), reqwest::Error> {", "    let response = reqwest::Client::new()",
        f"        {call}", *(f"        .header({_q(k)}, {_q(v)})" for k, v in r.headers
                            if r.kind != "json" or k != "Content-Type"),
        *body, "        .send()", "        .await?;", '    println!("{}", response.text().await?);',
        "    Ok(())", "}"])


def _swift(r: Request) -> str:
    text = _body(r)
    hashes = "#" * (1 + max([0, *(len(m) for m in re.findall(r'"""(#*)', text))]))
    return "\n".join([
        "import Foundation", "", f"var request = URLRequest(url: URL(string: {_q(r.url)})!)",
        f"request.httpMethod = {_q(r.method)}",
        *(f"request.setValue({_q(v)}, forHTTPHeaderField: {_q(k)})" for k, v in r.headers),
        *([f'request.httpBody = {hashes}"""', text, f'"""{hashes}.data(using: .utf8)'] if r.kind else []), "",
        "let (data, _) = try await URLSession.shared.data(for: request)",
        "print(String(decoding: data, as: UTF8.self))"])


GENERATORS: dict[str, Callable[[Request], str]] = {
    "curl": _curl, "python": _python, "javascript": _javascript, "go": _go, "java": _java, "ruby": _ruby,
    "php": _php, "csharp": _csharp, "rust": _rust, "swift": _swift}
_MULTIPART = {"curl", "python", "javascript"}  # the languages with a form-data sample


def custom_samples(op: Operation) -> list[tuple[str, str, str]]:
    """``(language, label, source)`` from ``x-codeSamples`` / ``x-code-samples``."""
    entries = op.extensions.get("x-codeSamples") or op.extensions.get("x-code-samples")
    out = []
    for e in entries if isinstance(entries, list) else []:
        if isinstance(e, dict) and isinstance(e.get("source"), str) and e["source"].strip():
            lang = language(e.get("lang"))
            label = str(e.get("label") or LANGUAGES.get(lang, (e.get("lang") or "Example",))[0])
            out.append((lang, label, e["source"].strip("\n")))
    return out


def request_examples(spec: ApiSpec, op: Operation, languages: list[str] | None = None) -> list[str]:
    """``<RequestExample>``: the spec's own samples, then one generated per language
    in ``languages`` that has none (default :data:`DEFAULT_LANGUAGES`; webhooks: none)."""
    custom = custom_samples(op)
    out: list[str] = []
    for lang, label, source in custom:
        fence = LANGUAGES[lang][1] if lang in LANGUAGES else re.sub(r"[^a-z0-9+#-]", "", lang) or "text"
        out += [*_fence(fence, _attr(label), source), ""]
    if not op.webhook:
        request = build_request(spec, op)
        have = {lang for lang, _, _ in custom}
        for name in DEFAULT_LANGUAGES if languages is None else languages:
            name = language(name)
            if name in GENERATORS and name not in have and (request.kind != "multipart" or name in _MULTIPART):
                out += [*_fence(LANGUAGES[name][1], _attr(LANGUAGES[name][0]), GENERATORS[name](request)), ""]
    return ["<RequestExample>", "", *out, "</RequestExample>", ""] if out else []
