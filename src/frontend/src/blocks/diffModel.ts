/**
 * Pure line-by-line LCS diff for `diff_viewer` blocks.
 * Capped at MAX_DIFF_LINES per side so huge payloads never freeze the browser.
 */

export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
  oldLine?: number
  newLine?: number
}

export const MAX_DIFF_LINES = 400

export function computeLineDiff(before: string, after: string): {
  lines: DiffLine[]
  added: number
  removed: number
  truncated: boolean
} {
  const aAll = before === '' ? [] : before.replace(/\r\n/g, '\n').split('\n')
  const bAll = after === '' ? [] : after.replace(/\r\n/g, '\n').split('\n')
  const truncated = aAll.length > MAX_DIFF_LINES || bAll.length > MAX_DIFF_LINES
  const a = aAll.slice(0, MAX_DIFF_LINES)
  const b = bAll.slice(0, MAX_DIFF_LINES)
  const m = a.length
  const n = b.length

  // Flat Int32Array DP table keeps memory tiny and allocation single-shot.
  const cols = n + 1
  const dp = new Int32Array((m + 1) * cols)
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * cols + j] =
        a[i] === b[j]
          ? dp[(i + 1) * cols + (j + 1)] + 1
          : Math.max(dp[(i + 1) * cols + j], dp[i * cols + (j + 1)])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 })
      i++
      j++
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
      lines.push({ kind: 'del', text: a[i], oldLine: i + 1 })
      removed++
      i++
    } else {
      lines.push({ kind: 'add', text: b[j], newLine: j + 1 })
      added++
      j++
    }
  }
  while (i < m) {
    lines.push({ kind: 'del', text: a[i], oldLine: i + 1 })
    removed++
    i++
  }
  while (j < n) {
    lines.push({ kind: 'add', text: b[j], newLine: j + 1 })
    added++
    j++
  }

  return { lines, added, removed, truncated }
}
