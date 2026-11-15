/**
 * Playwright suites for PraisonAIUI (`npm run test:e2e`).
 *
 * Every project talks to its own real server (fixtures/start-server.mjs): the
 * Python package from this checkout, a scripted provider instead of an LLM, an
 * isolated AIUI_DATA_DIR and HOME, and the current `dist/` build served through
 * AIUI_TEMPLATES_DIR. Run `npm run build` first.
 *
 *   project            server                                   specs
 *   dashboard-legacy   default style (vanilla dashboard)        legacy-parity, legacy-dashboard
 *   app-shell          AIUI_SHELL=app + the example plugin      shell-sweep, chat, plugins
 *   chat-style         style chat, presets zinc and rose        theme-presets
 *   docs               `aiui build` output on `aiui serve`      markdown
 *   page-reload-*      the dashboard and app-shell servers      page-reload
 *   layouts-host       app shell + the layout-plugin fixture    layouts-host, page-types
 *                      (fixtures/layout-plugin/serve.py)
 *   legacy-baseline    the v0.3.153 tree (opt-in, see below)    legacy-parity
 *
 * Environment:
 *   AIUI_E2E_PORT          first of seven consecutive ports (default 8720)
 *   AIUI_E2E_PYTHON        Python interpreter (default python3, then python)
 *   AIUI_E2E_REUSE=1       reuse servers that are already listening
 *   AIUI_E2E_BASELINE_SRC  a checkout of v0.3.153 (git worktree of 6bdf6f0);
 *                          enables the legacy-baseline project, which writes
 *                          e2e/__baseline__/<platform>/ (npm run test:e2e:baseline)
 *
 * CI runs the suites in parallel jobs (`--shard=i/n`): there every test is
 * its own unit of distribution (fullyParallel; each job still runs one worker,
 * so tests in a job never overlap), and each job writes a blob report to
 * e2e/.blob/ that a final job merges (`npx playwright merge-reports`).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE_PORT = Number(process.env.AIUI_E2E_PORT || 8720)
const BASELINE_SRC = process.env.AIUI_E2E_BASELINE_SRC || ''
const REUSE = process.env.AIUI_E2E_REUSE === '1'
const CI = !!process.env.CI

const PORTS = {
  legacy: BASE_PORT,
  app: BASE_PORT + 1,
  chatZinc: BASE_PORT + 2,
  chatRose: BASE_PORT + 3,
  docs: BASE_PORT + 4,
  baseline: BASE_PORT + 5,
  layouts: BASE_PORT + 6,
}
const url = (port: number) => `http://127.0.0.1:${port}`

// Specs read the second chat-style server from here.
process.env.AIUI_E2E_ROSE_URL = url(PORTS.chatRose)

const PYTHON = process.env.AIUI_E2E_PYTHON || 'python3'
const START = `node "${path.join(HERE, 'fixtures', 'start-server.mjs')}"`
function server(port: number, args: string) {
  return {
    command: `${START} --port ${port} ${args}`.trim(),
    url: `${url(port)}/`,
    reuseExistingServer: REUSE,
    timeout: 120_000,
    stdout: 'ignore' as const,
    stderr: 'pipe' as const,
  }
}

const chromium = { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }

export default defineConfig({
  testDir: path.join(HERE, 'specs'),
  outputDir: path.join(HERE, '.results'),
  // Legacy-parity baselines are shared by the project that writes them
  // (legacy-baseline) and the one that compares (dashboard-legacy), and are
  // kept per platform: font rendering differs between macOS and Linux.
  snapshotPathTemplate: path.join(HERE, '__baseline__', '{platform}', '{arg}{ext}'),
  // Shards split by test, not by file: the shell sweep alone is a third of the run.
  fullyParallel: CI,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  reporter: CI
    ? [['list'], ['blob', { outputDir: path.join(HERE, '.blob') }]]
    : [['list'], ['html', { outputFolder: path.join(HERE, '.report'), open: 'never' }]],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    // Screenshots must not depend on where the machine is.
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: [
    server(PORTS.legacy, ''),
    // The classic frame (ADR 0003 `layout: classic`): these suites and their
    // baselines pin the app shell's own sidebar and header. The layouts have
    // their own server below.
    { ...server(PORTS.app, '--shell app -- --plugin --custom-js'), env: { AIUI_LAYOUT: 'classic' } },
    server(PORTS.chatZinc, '-- --style chat --preset zinc'),
    server(PORTS.chatRose, '-- --style chat --preset rose'),
    server(PORTS.docs, '--docs'),
    // The layout host suite: its own server, with a third-party layout plugin.
    {
      command: `${PYTHON} "${path.join(HERE, 'fixtures', 'layout-plugin', 'serve.py')}" --port ${PORTS.layouts}`,
      url: `${url(PORTS.layouts)}/`,
      reuseExistingServer: REUSE,
      timeout: 120_000,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
    },
    ...(BASELINE_SRC ? [server(PORTS.baseline, `--src "${BASELINE_SRC}"`)] : []),
  ],
  projects: [
    {
      name: 'dashboard-legacy',
      testMatch: /[\\/]legacy-(parity|dashboard)\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.legacy) },
    },
    {
      name: 'app-shell',
      testMatch: /[\\/](shell-sweep|chat|plugins)\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.app) },
    },
    {
      name: 'chat-style',
      testMatch: /[\\/]theme-presets\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.chatZinc) },
    },
    {
      name: 'docs',
      testMatch: /[\\/]markdown\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.docs) },
    },
    // One spec against both page styles (the servers above, no new ones).
    {
      name: 'page-reload-dashboard',
      testMatch: /[\\/]page-reload\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.legacy) },
    },
    {
      name: 'page-reload-app',
      testMatch: /[\\/]page-reload\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.app) },
    },
    {
      name: 'layouts-host',
      testMatch: /[\\/](layouts-host|page-types)\.spec\.ts$/,
      use: { ...chromium, baseURL: url(PORTS.layouts) },
    },
    ...(BASELINE_SRC
      ? [
          {
            name: 'legacy-baseline',
            testMatch: /[\\/]legacy-parity\.spec\.ts$/,
            use: { ...chromium, baseURL: url(PORTS.baseline) },
          },
        ]
      : []),
  ],
})
