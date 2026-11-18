// Fence meta for docs code blocks (codeMeta.ts): titles, flags, marked lines,
// notation comments and the <CodeBlock> form.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeBlockFence, parseCodeMeta, parseCodeNotation, parseLineSpec } from './codeMeta'

const none = { highlight: [], focus: [] }

test('line specs: lists, ranges, spaces, duplicates, braces, brackets and junk', () => {
    assert.deepEqual(parseLineSpec('1,3-4'), [1, 3, 4])
    assert.deepEqual(parseLineSpec('4 2 2-3'), [2, 3, 4])
    assert.deepEqual(parseLineSpec('0, x, 5-3, 7'), [7])
    assert.deepEqual(parseLineSpec('{1-2,5}'), [1, 2, 5])
    assert.deepEqual(parseLineSpec('[1,3,4]'), [1, 3, 4])
    assert.equal(parseLineSpec('1-999999').length, 2000)
})

test('title= or the bare words before the first option name the file; {…}, highlight= and hl_lines= pick lines', () => {
    assert.deepEqual(parseCodeMeta('title="app.py" {1,3-4}'), { ...none, title: 'app.py', highlight: [1, 3, 4] })
    assert.deepEqual(parseCodeMeta("filename='a b.py'"), { ...none, title: 'a b.py' })
    assert.deepEqual(parseCodeMeta('app.py {2}'), { ...none, title: 'app.py', highlight: [2] })
    assert.deepEqual(parseCodeMeta('hl_lines="2 3"'), { ...none, highlight: [2, 3] })
    assert.deepEqual(parseCodeMeta('highlight=1-2 title=x.ts'), { ...none, title: 'x.ts', highlight: [1, 2] })
    assert.deepEqual(parseCodeMeta('"My script.sh"'), { ...none, title: 'My script.sh' })
    // M119: a multi-word inline title, ending at the first option.
    assert.deepEqual(parseCodeMeta('Example title lines'), { ...none, title: 'Example title', lineNumbers: true })
    assert.deepEqual(parseCodeMeta('Example title {2} more'), { ...none, title: 'Example title', highlight: [2] })
})

test('flags are options, never titles (M120)', () => {
    assert.deepEqual(parseCodeMeta('lines'), { ...none, lineNumbers: true })
    assert.deepEqual(parseCodeMeta('wrap'), { ...none, wrap: true })
    assert.deepEqual(parseCodeMeta('expandable'), { ...none, expandable: true })
    assert.deepEqual(parseCodeMeta('nocopy'), { ...none, nocopy: true })
    assert.deepEqual(parseCodeMeta('twoslash'), none)
    assert.deepEqual(parseCodeMeta('nocopy="false" wrap={false}'), { ...none, nocopy: false, wrap: false })
    assert.deepEqual(parseCodeMeta('app.ts lines wrap expandable nocopy'), {
        ...none, title: 'app.ts', lineNumbers: true, wrap: true, expandable: true, nocopy: true,
    })
})

test('highlight={…} and focus={…}, and icon', () => {
    assert.deepEqual(parseCodeMeta('highlight={1-2,5}'), { ...none, highlight: [1, 2, 5] })
    assert.deepEqual(parseCodeMeta('{1,2,5}'), { ...none, highlight: [1, 2, 5] })
    assert.deepEqual(parseCodeMeta('focus={2,4-5}'), { ...none, focus: [2, 4, 5] })
    assert.deepEqual(parseCodeMeta('highlight={1, 3}'), { ...none, highlight: [1, 3] })
    assert.deepEqual(parseCodeMeta('icon="terminal" title="run.sh"'), { ...none, icon: 'terminal', title: 'run.sh' })
})

test('no meta, Streamdown flags and unknown keys give nothing to draw', () => {
    assert.deepEqual(parseCodeMeta(undefined), none)
    assert.deepEqual(parseCodeMeta(''), none)
    assert.deepEqual(parseCodeMeta('noLineNumbers startLine=5'), none)
})

test('notation comments: diff, highlight and focus, :N ranges, comment-only lines (M123)', () => {
    assert.equal(parseCodeNotation('const a = 1\n'), null)
    const diff = parseCodeNotation('const a = 1 // [!code --]\nconst a = 2 // [!code ++]\nkeep()')!
    assert.equal(diff.code, 'const a = 1\nconst a = 2\nkeep()')
    assert.deepEqual([diff.remove, diff.add], [[1], [2]])
    // Python, SQL and HTML comments; a :N range covers the line and the next N-1.
    const py = parseCodeNotation('x = 1  # [!code ++:3]\ny = 2\nz = 3\nw = 4')!
    assert.equal(py.code, 'x = 1\ny = 2\nz = 3\nw = 4')
    assert.deepEqual(py.add, [1, 2, 3])
    assert.deepEqual(parseCodeNotation('SELECT 1; -- [!code highlight]')!.highlight, [1])
    assert.equal(parseCodeNotation('<p>hi</p> <!-- [!code focus] -->')!.code, '<p>hi</p>')
    // A comment alone on its line goes and marks the lines after it.
    const alone = parseCodeNotation('a()\n// [!code focus:2]\nb()\nc()\nd()')!
    assert.equal(alone.code, 'a()\nb()\nc()\nd()')
    assert.deepEqual(alone.focus, [2, 3])
    // Not at the end of a line: left alone.
    assert.equal(parseCodeNotation('say("[!code ++] is notation")'), null)
})

test('<CodeBlock> props become the same fence (M127)', () => {
    assert.deepEqual(
        codeBlockFence({ language: 'javascript', filename: 'My file.js', icon: 'code', lines: 'true', highlight: '[1,3]', nocopy: 'false' }, '\n  const a = 1\n  const b = 2\n'),
        ['```javascript title="My file.js" icon="code" lines highlight={1,3}', 'const a = 1', 'const b = 2', '```'],
    )
    // A {`…`} template literal body, a fence inside the code, no language.
    assert.deepEqual(codeBlockFence({}, '{`\n```\nx\n```\n`}', '   '), ['   ````text', '   ```', '   x', '   ```', '   ````'])
})
