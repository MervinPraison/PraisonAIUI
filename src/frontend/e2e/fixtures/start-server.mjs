#!/usr/bin/env node
/**
 * Start one server for the Playwright suites (playwright.config.ts webServer).
 *
 *   node start-server.mjs --port 8721 [--shell app] [--docs] [--src <repo>] [-- <mock_server.py args>]
 *
 *   --port <n>     port to listen on (required)
 *   --shell <v>    value for AIUI_SHELL (app | legacy); unset by default
 *   --docs         build e2e/fixtures/docs-site with `aiui build` and serve it with `aiui serve`
 *   --src <repo>   run another checkout's Python package and its committed bundle
 *                  (used to capture the legacy baseline from the v0.3.153 tree)
 *
 * Isolation (every run):
 *   - AIUI_DATA_DIR and HOME point at a fresh temp directory, so sessions,
 *     config, theme caches and ~/.praisonai dashboard plugins of the machine
 *     never leak into a test. Set AIUI_E2E_KEEP_HOME=1 if your Python needs the
 *     real HOME (packages installed with `pip install --user`).
 *   - provider keys and tokens (*_API_KEY, *_TOKEN) are removed from the env.
 *   - AIUI_DISABLE_PLUGIN_AUTOLOAD=1: installed entry-point plugins are ignored.
 *   - the current `dist/` build is copied to a temp directory and served with
 *     AIUI_TEMPLATES_DIR, so the tracked templates are never touched and never
 *     tested by accident. Run `npm run build` first.
 *
 * Python: AIUI_E2E_PYTHON, else `python3`, else `python`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..', '..')
const REPO = path.resolve(FRONTEND, '..', '..')

function fail(msg) {
  console.error(`start-server: ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { port: 0, shell: '', docs: false, src: '', rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      opts.rest = argv.slice(i + 1)
      break
    }
    if (a === '--port') opts.port = Number(argv[++i])
    else if (a === '--shell') opts.shell = argv[++i] ?? ''
    else if (a === '--src') opts.src = path.resolve(argv[++i] ?? '')
    else if (a === '--docs') opts.docs = true
    else fail(`unknown argument: ${a}`)
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0) fail('--port <n> is required')
  return opts
}

function findPython() {
  const candidates = process.env.AIUI_E2E_PYTHON ? [process.env.AIUI_E2E_PYTHON] : ['python3', 'python']
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { stdio: 'ignore' })
    if (r.status === 0) return bin
  }
  fail(`no Python >= 3.10 found (tried ${candidates.join(', ')}); set AIUI_E2E_PYTHON`)
}

/** Block until Python can bind `port` (as `aiui serve` does), or fail after 90 s. */
function waitUntilBindable(python, port, env) {
  const probe = [
    'import socket, sys, time',
    'deadline = time.time() + 90',
    'while True:',
    '    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
    '    try:',
    `        s.bind(("", ${port}))`,
    '        sys.exit(0)',
    '    except OSError:',
    '        if time.time() > deadline: sys.exit(1)',
    '        time.sleep(0.5)',
    '    finally:',
    '        s.close()',
  ].join('\n')
  const r = spawnSync(python, ['-c', probe], { env, stdio: 'ignore' })
  if (r.status !== 0) fail(`port ${port} is still in use after 90 s`)
}

const opts = parseArgs(process.argv.slice(2))
const python = findPython()
const work = mkdtempSync(path.join(os.tmpdir(), 'aiui-e2e-'))
const repo = opts.src || REPO
if (!existsSync(path.join(repo, 'src', 'praisonaiui'))) fail(`${repo} is not a PraisonAIUI checkout`)

const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/(_API_KEY|_TOKEN)$/.test(k) && k !== 'AIUI_SHELL'),
)
Object.assign(env, {
  PYTHONPATH: path.join(repo, 'src'),
  PYTHONUNBUFFERED: '1',
  AIUI_DATA_DIR: path.join(work, 'data'),
  AIUI_DISABLE_PLUGIN_AUTOLOAD: '1',
})
mkdirSync(env.AIUI_DATA_DIR, { recursive: true })
if (process.env.AIUI_E2E_KEEP_HOME !== '1') {
  env.HOME = path.join(work, 'home')
  env.USERPROFILE = env.HOME
  mkdirSync(env.HOME, { recursive: true })
}
if (opts.shell) env.AIUI_SHELL = opts.shell

if (!opts.src) {
  // Serve the fresh build, never the tracked templates.
  const templates = path.join(work, 'frontend')
  const sync = spawnSync(process.execPath, [path.join(FRONTEND, 'scripts', 'sync-templates.mjs'), '--dest', templates], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (sync.status !== 0) fail('could not copy dist/ (run `npm run build` in src/frontend first)')
  env.AIUI_TEMPLATES_DIR = templates
}

let command
if (opts.docs) {
  const site = path.join(work, 'site')
  const config = path.join(HERE, 'docs-site', 'aiui.template.yaml')
  const build = spawnSync(python, ['-m', 'praisonaiui.cli', 'build', '--config', config, '--output', site], {
    env,
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (build.status !== 0) fail('`aiui build` failed for e2e/fixtures/docs-site')
  // `aiui serve` moves to the next free port when its port cannot be bound,
  // and Playwright would then wait for the wrong port until it times out. A
  // port is also unbindable for a while after a previous run's connections
  // closed (TIME_WAIT), so wait for it the way `aiui serve` checks it.
  waitUntilBindable(python, opts.port, env)
  command = ['-m', 'praisonaiui.cli', 'serve', '--no-build', '--output', site, '--port', String(opts.port), ...opts.rest]
} else {
  command = [path.join(HERE, 'mock_server.py'), '--port', String(opts.port), ...opts.rest]
}

const child = spawn(python, command, { env, cwd: work, stdio: 'inherit' })

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  rmSync(work, { recursive: true, force: true })
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    child.kill('SIGTERM')
    // Do not wait for a slow shutdown: Playwright is already tearing down.
    setTimeout(() => {
      child.kill('SIGKILL')
      cleanup()
      process.exit(0)
    }, 3000).unref()
  })
}
child.on('exit', (code) => {
  cleanup()
  process.exit(code ?? 0)
})
