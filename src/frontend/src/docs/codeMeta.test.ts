// Fence meta for docs code blocks (codeMeta.ts): file names and highlighted lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCodeMeta, parseLineSpec } from './codeMeta'

test('line specs: lists, ranges, spaces, duplicates and junk', () => {
    assert.deepEqual(parseLineSpec('1,3-4'), [1, 3, 4])
    assert.deepEqual(parseLineSpec('4 2 2-3'), [2, 3, 4])
    assert.deepEqual(parseLineSpec('0, x, 5-3, 7'), [7])
    assert.equal(parseLineSpec('1-999999').length, 2000)
})

test('title= or a bare first word names the file; {…}, highlight= and hl_lines= pick lines', () => {
    assert.deepEqual(parseCodeMeta('title="app.py" {1,3-4}'), { title: 'app.py', lines: [1, 3, 4] })
    assert.deepEqual(parseCodeMeta("filename='a b.py'"), { title: 'a b.py', lines: [] })
    assert.deepEqual(parseCodeMeta('app.py {2}'), { title: 'app.py', lines: [2] })
    assert.deepEqual(parseCodeMeta('hl_lines="2 3"'), { lines: [2, 3] })
    assert.deepEqual(parseCodeMeta('highlight=1-2 title=x.ts'), { title: 'x.ts', lines: [1, 2] })
    assert.deepEqual(parseCodeMeta('"My script.sh"'), { title: 'My script.sh', lines: [] })
})

test('no meta, Streamdown flags and unknown keys give nothing to draw', () => {
    assert.deepEqual(parseCodeMeta(undefined), { lines: [] })
    assert.deepEqual(parseCodeMeta(''), { lines: [] })
    assert.deepEqual(parseCodeMeta('noLineNumbers startLine=5'), { lines: [] })
})
