// The keyboard strip stacks below 640px: text on its own row (never squeezed
// to a sliver), Approve / Deny sharing the next row, no key hints there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = readFileSync(path.join(process.cwd(), 'src/chat-engine/presentation/KeyboardGate.tsx'), 'utf8')

test('the text takes a full row below sm and shares it from sm up', () => {
  assert.match(src, /data-gate-text/)
  assert.match(src, /basis-\[calc\(100%-1\.75rem\)\][^"]*sm:basis-0/)
})

test('the actions take the next row below sm, each button growing; key hints only from sm with a pointer', () => {
  assert.match(src, /className="flex w-full items-center gap-1\.5 sm:w-auto sm:shrink-0" data-gate-actions/)
  assert.equal((src.match(/className="flex-1 sm:flex-none"/g) ?? []).length, 2)
  assert.match(src, /hidden[^"]*sm:\[@media\(hover:hover\)\]:inline-flex/)
})
