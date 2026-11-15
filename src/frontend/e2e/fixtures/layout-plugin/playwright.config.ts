/**
 * The layout host suite (e2e/specs/layouts-host.spec.ts) and every layout's
 * own suite (e2e/specs/layout-<id>.spec.ts) against their own server: the
 * mock server in the app shell with the third-party layout plugin of this
 * folder (serve.py). Run `npm run build` first.
 *
 *   npx playwright test -c e2e/fixtures/layout-plugin/playwright.config.ts
 *
 * Environment: AIUI_E2E_LAYOUT_PORT (default 9040), AIUI_E2E_PYTHON,
 * AIUI_E2E_REUSE=1 (reuse a server that is already listening).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const E2E = path.resolve(HERE, '..', '..')
const PORT = Number(process.env.AIUI_E2E_LAYOUT_PORT || 9040)
const BASE = `http://127.0.0.1:${PORT}`
const PYTHON = process.env.AIUI_E2E_PYTHON || 'python3'
const CI = !!process.env.CI

export default defineConfig({
  testDir: path.join(E2E, 'specs'),
  // The host suite and every layout's own suite (layout-<id>.spec.ts).
  testMatch: /[\\/](layouts-host|layout-[a-z][a-z0-9-]*)\.spec\.ts$/,
  outputDir: path.join(E2E, '.results', 'layouts-host'),
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  reporter: [['list']],
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: `${PYTHON} "${path.join(HERE, 'serve.py')}" --port ${PORT}`,
    url: `${BASE}/`,
    reuseExistingServer: process.env.AIUI_E2E_REUSE === '1',
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
