/**
 * Remove e2e work folders that an earlier run left behind.
 *
 * Every e2e server works in a fresh `aiui-e2e-*` folder under the OS temp dir and
 * removes it on a clean exit. A server that is killed with SIGKILL (Playwright
 * does this when shutdown is slow) cannot clean up, so the folders piled up:
 * about 24 MB each, 16 GB after a busy day. Each server start sweeps folders
 * older than `maxAgeMs`; a live server touches its folder far more recently.
 */
import { readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PREFIX = 'aiui-e2e-'
export const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Delete `aiui-e2e-*` folders in `dir` older than `maxAgeMs`; returns the names removed. */
export function sweepStaleWorkDirs({ dir = os.tmpdir(), maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now() } = {}) {
  const removed = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return removed
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue
    const full = path.join(dir, name)
    try {
      const st = statSync(full)
      if (!st.isDirectory() || now - st.mtimeMs < maxAgeMs) continue
      rmSync(full, { recursive: true, force: true })
      removed.push(name)
    } catch {
      // Another run may be removing the same folder; skip it.
    }
  }
  return removed
}
