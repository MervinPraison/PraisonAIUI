// Fault front for `python -m preqa netfault`: an HTTPS (HTTP/2) server that
// proxies every request to the plain pre-QA server, behind a TCP layer that
// imitates a network which silently drops idle connections.
//
// Some home routers and carrier firewalls forget an idle TCP connection after
// 15-30 s (seen on IPv6) without telling either end. The browser keeps its one
// HTTP/2 connection to the site and sends the next request down it; nothing
// ever comes back. Here: a connection with no bytes either way for
// --freeze-idle-ms is frozen. From then on bytes in both directions are
// dropped and the socket is never closed, so the browser gets no error.
//
//   node netfault.mjs --upstream http://127.0.0.1:8700 --cert C --key K --freeze-idle-ms 3000
//
// Prints one JSON line per event to stdout: {"listen":port}, {"conn":n},
// {"freeze":n,"idle_ms":..}.
import http from 'node:http'
import http2 from 'node:http2'
import net from 'node:net'
import fs from 'node:fs'
import { parseArgs } from 'node:util'

const { values: a } = parseArgs({
    options: {
        upstream: { type: 'string' }, cert: { type: 'string' }, key: { type: 'string' },
        'freeze-idle-ms': { type: 'string', default: '3000' }, port: { type: 'string', default: '0' },
    },
})
const FREEZE_MS = Number(a['freeze-idle-ms'])
const up = new URL(a.upstream)
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection'])

const inner = http2.createSecureServer({ cert: fs.readFileSync(a.cert), key: fs.readFileSync(a.key), allowHTTP1: true },
    (req, res) => {
        const headers = {}
        for (const [k, v] of Object.entries(req.headers)) if (!k.startsWith(':') && !HOP.has(k)) headers[k] = v
        const p = http.request({ host: up.hostname, port: up.port, path: req.url, method: req.method, headers }, (r) => {
            const out = {}
            for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v
            res.writeHead(r.statusCode, out)
            r.pipe(res)
        })
        p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
        req.pipe(p)
    })

inner.listen(0, '127.0.0.1', () => {
    let n = 0
    const front = net.createServer((c) => {
        const id = ++n
        let last = Date.now()
        let frozen = false
        say({ conn: id })
        const u = net.connect(inner.address().port, '127.0.0.1')
        const check = () => {
            if (!frozen && Date.now() - last > FREEZE_MS) {
                frozen = true
                say({ freeze: id, idle_ms: Date.now() - last })
            }
        }
        const timer = setInterval(check, 200)
        const relay = (to) => (d) => {
            check()
            if (frozen) return // dropped: no reply, no reset, no close
            last = Date.now()
            to.write(d)
        }
        c.on('data', relay(u))
        u.on('data', relay(c))
        const end = () => { clearInterval(timer); c.destroy(); u.destroy() }
        c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', () => { if (!frozen) end() })
    })
    front.listen(Number(a.port), '127.0.0.1', () => say({ listen: front.address().port }))
})
