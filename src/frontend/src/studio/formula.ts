/**
 * Safe, zero-eval spreadsheet formula evaluator and CSV exporter.
 *
 * Supports cell references (A1, B12), rectangular ranges (A1:C5), arithmetic
 * (+, -, *, /, parentheses, unary minus), comparisons (=, <>, !=, <, <=, >, >=)
 * and common functions: SUM, AVERAGE/AVG, MIN, MAX, COUNT, COUNTA, ROUND, ABS, IF.
 * Protects against cyclic references (#CYCLE!) and division by zero (#DIV/0!).
 */

export type CellMatrix = readonly (readonly unknown[])[]

const MAX_DEPTH = 32
const MAX_RANGE_CELLS = 5000

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colLabel(index: number): string {
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

/** "A1" -> { r: 0, c: 0 }; null when not a valid A1 reference. */
export function parseCellRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,4})$/.exec(ref.trim())
  if (!m) return null
  let c = 0
  const letters = m[1].toUpperCase()
  for (let i = 0; i < letters.length; i++) c = c * 26 + (letters.charCodeAt(i) - 64)
  return { r: Number.parseInt(m[2], 10) - 1, c: c - 1 }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/[$,%]/g, '').replace(/,/g, '')
    if (!cleaned) return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function splitTopLevel(argStr: string): string[] {
  const out: string[] = []
  let depth = 0
  let inStr: string | null = null
  let start = 0
  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i]
    if (inStr) {
      if (ch === inStr) inStr = null
    } else if (ch === '"' || ch === "'") {
      inStr = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1)
    } else if (ch === ',' && depth === 0) {
      out.push(argStr.slice(start, i).trim())
      start = i + 1
    }
  }
  const tail = argStr.slice(start).trim()
  if (tail || out.length > 0) out.push(tail)
  return out
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'ident'; v: string }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < expr.length && expr[j] !== ch) j++
      tokens.push({ t: 'str', v: expr.slice(i + 1, j) })
      i = j + 1
      continue
    }
    const two = expr.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
      tokens.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/=<>'.includes(ch)) {
      tokens.push({ t: 'op', v: ch })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ t: 'lp' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ t: 'rp' })
      i++
      continue
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] ?? ''))) {
      let j = i
      while (j < expr.length && /[\d.]/.test(expr[j])) j++
      tokens.push({ t: 'num', v: Number(expr.slice(i, j)) })
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < expr.length && /[A-Za-z0-9_$:]/.test(expr[j])) j++
      tokens.push({ t: 'ident', v: expr.slice(i, j) })
      i = j
      continue
    }
    throw new Error('#ERR!')
  }
  return tokens
}

/** Evaluate every cell in a 2D grid, returning computed display values. */
export function evaluateSheet(grid: CellMatrix): unknown[][] {
  const cache = new Map<string, unknown>()
  const visiting = new Set<string>()

  function getCell(r: number, c: number, depth: number): unknown {
    if (r < 0 || c < 0 || r >= grid.length) return ''
    const row = grid[r]
    if (!Array.isArray(row) || c >= row.length) return ''
    const key = `${r}:${c}`
    if (cache.has(key)) return cache.get(key)
    const raw = row[c]
    if (typeof raw !== 'string' || !raw.trim().startsWith('=')) {
      cache.set(key, raw)
      return raw
    }
    if (visiting.has(key) || depth > MAX_DEPTH) return '#CYCLE!'
    visiting.add(key)
    let val: unknown
    try {
      val = evalExpr(raw.trim().slice(1), depth + 1)
    } catch (e) {
      val = e instanceof Error && e.message.startsWith('#') ? e.message : '#ERR!'
    } finally {
      visiting.delete(key)
    }
    cache.set(key, val)
    return val
  }

  function expandValues(arg: string, depth: number): unknown[] {
    const trimmed = arg.trim()
    if (trimmed.includes(':')) {
      const [a, b] = trimmed.split(':')
      const p1 = parseCellRef(a)
      const p2 = parseCellRef(b)
      if (p1 && p2) {
        const r0 = Math.min(p1.r, p2.r)
        const r1 = Math.max(p1.r, p2.r)
        const c0 = Math.min(p1.c, p2.c)
        const c1 = Math.max(p1.c, p2.c)
        if ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_RANGE_CELLS) throw new Error('#RANGE!')
        const vals: unknown[] = []
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) vals.push(getCell(r, c, depth))
        }
        return vals
      }
    }
    return [evalExpr(trimmed, depth)]
  }

  function evalFunc(name: string, rawArgs: string, depth: number): unknown {
    const fn = name.toUpperCase()
    const parts = splitTopLevel(rawArgs)
    if (fn === 'IF') {
      const cond = evalExpr(parts[0] ?? '0', depth)
      const truthy = typeof cond === 'boolean' ? cond : typeof cond === 'number' ? cond !== 0 : Boolean(cond)
      return evalExpr((truthy ? parts[1] : parts[2]) ?? '""', depth)
    }
    const vals = parts.flatMap((p) => (p ? expandValues(p, depth) : []))
    const nums = vals.map(toNumber).filter((n): n is number => n !== null)
    switch (fn) {
      case 'SUM':
        return nums.reduce((a, b) => a + b, 0)
      case 'AVERAGE':
      case 'AVG':
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
      case 'MIN':
        return nums.length ? Math.min(...nums) : 0
      case 'MAX':
        return nums.length ? Math.max(...nums) : 0
      case 'COUNT':
        return nums.length
      case 'COUNTA':
        return vals.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length
      case 'ABS':
        return Math.abs(nums[0] ?? 0)
      case 'ROUND': {
        const n = nums[0] ?? 0
        const digits = Math.max(0, Math.min(10, Math.trunc(nums[1] ?? 0)))
        const f = 10 ** digits
        return Math.round(n * f) / f
      }
      default:
        throw new Error('#NAME?')
    }
  }

  function evalExpr(expr: string, depth: number): unknown {
    if (depth > MAX_DEPTH) throw new Error('#CYCLE!')
    // Resolve function calls from innermost outward (zero eval/Function).
    let work = expr.trim()
    const fnPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/
    let guard = 0
    while (fnPattern.test(work) && guard++ < 64) {
      work = work.replace(fnPattern, (_all, name: string, args: string) => {
        const res = evalFunc(name, args, depth + 1)
        if (typeof res === 'string') return JSON.stringify(res)
        if (typeof res === 'boolean') return res ? '1' : '0'
        return String(res ?? 0)
      })
    }

    const tokens = tokenize(work)
    let pos = 0

    function peek(): Token | undefined {
      return tokens[pos]
    }

    function parseComparison(): unknown {
      const left = parseAddSub()
      const tk = peek()
      if (tk && tk.t === 'op' && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(tk.v)) {
        pos++
        const right = parseAddSub()
        const ln = toNumber(left)
        const rn = toNumber(right)
        const l = ln !== null && rn !== null ? ln : String(left ?? '')
        const r = ln !== null && rn !== null ? rn : String(right ?? '')
        switch (tk.v) {
          case '=': return l === r
          case '<>':
          case '!=': return l !== r
          case '<': return l < r
          case '<=': return l <= r
          case '>': return l > r
          case '>=': return l >= r
        }
      }
      return left
    }

    function parseAddSub(): unknown {
      let left = parseMulDiv()
      while (peek()?.t === 'op' && (peek() as { v: string }).v.match(/^[+-]$/)) {
        const op = (tokens[pos++] as { v: string }).v
        const right = parseMulDiv()
        const a = toNumber(left) ?? 0
        const b = toNumber(right) ?? 0
        left = op === '+' ? a + b : a - b
      }
      return left
    }

    function parseMulDiv(): unknown {
      let left = parseUnary()
      while (peek()?.t === 'op' && (peek() as { v: string }).v.match(/^[*/]$/)) {
        const op = (tokens[pos++] as { v: string }).v
        const right = parseUnary()
        const a = toNumber(left) ?? 0
        const b = toNumber(right) ?? 0
        if (op === '/') {
          if (b === 0) throw new Error('#DIV/0!')
          left = a / b
        } else {
          left = a * b
        }
      }
      return left
    }

    function parseUnary(): unknown {
      const tk = peek()
      if (tk?.t === 'op' && (tk.v === '-' || tk.v === '+')) {
        pos++
        const v = toNumber(parseUnary()) ?? 0
        return tk.v === '-' ? -v : v
      }
      return parsePrimary()
    }

    function parsePrimary(): unknown {
      const tk = tokens[pos++]
      if (!tk) return 0
      if (tk.t === 'num') return tk.v
      if (tk.t === 'str') return tk.v
      if (tk.t === 'lp') {
        const v = parseComparison()
        if (peek()?.t === 'rp') pos++
        return v
      }
      if (tk.t === 'ident') {
        if (tk.v.toUpperCase() === 'TRUE') return true
        if (tk.v.toUpperCase() === 'FALSE') return false
        const ref = parseCellRef(tk.v)
        if (!ref) throw new Error('#REF!')
        return getCell(ref.r, ref.c, depth + 1)
      }
      throw new Error('#ERR!')
    }

    return parseComparison()
  }

  return grid.map((row, r) => (Array.isArray(row) ? row.map((_cell, c) => getCell(r, c, 0)) : []))
}

/** RFC-4180 CSV serialization with formula-injection neutralization on export. */
export function sheetToCsv(values: CellMatrix): string {
  const esc = (v: unknown) => {
    const raw = v === null || v === undefined ? '' : String(v)
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
    return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
  }
  return values.map((row) => (Array.isArray(row) ? row.map(esc).join(',') : '')).join('\n')
}
