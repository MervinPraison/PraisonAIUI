// Which rendered blocks of a reply are artifacts (and so leave the thread for their card).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeIsArtifact, markInCanvas, tableIsArtifact, IN_CANVAS } from './inChat'

const code = { kind: 'code', content: 'import random\n\nprint(sorted([3, 1, 2]))' }
const table = { kind: 'table', content: '| Algorithm | Stable |\n|---|---|\n| Timsort | Yes |', columns: ['Algorithm', 'Stable'] }

test('a code block is an artifact when its text is the artifact text (whitespace aside)', () => {
  assert.equal(codeIsArtifact('import random  \n\nprint(sorted([3, 1, 2]))\n', [code]), true)
  assert.equal(codeIsArtifact('import randomprint(sorted([3, 1, 2]))', [code]), true, 'highlighted lines have no newline between them')
  assert.equal(codeIsArtifact('print(1)', [code]), false, 'a short snippet is no artifact: it stays')
  assert.equal(codeIsArtifact('', [code]), false)
  assert.equal(codeIsArtifact('import random', [code]), false, 'a prefix counts only while the reply streams')
  assert.equal(codeIsArtifact('import random', [code], true), true)
  assert.equal(codeIsArtifact('import random\n\nprint(sorted([3, 1, 2]))\nprint(4)', [code], true), true)
  assert.equal(codeIsArtifact('import random', [table], true), false, 'only code and markdown artifacts')
  assert.equal(codeIsArtifact('# Notes\n\nhello', [{ kind: 'markdown', content: '# Notes\n\nhello' }]), true)
})

test('a table is an artifact when its header is a table artifact header (markup and case aside)', () => {
  assert.equal(tableIsArtifact(['Algorithm', 'Stable'], [table]), true)
  assert.equal(tableIsArtifact(['algorithm ', '**Stable**'], [table]), true)
  assert.equal(tableIsArtifact(['Algorithm', 'Average'], [table]), false)
  assert.equal(tableIsArtifact([], [table]), false)
  assert.equal(tableIsArtifact(['Algorithm', 'Stable'], [code]), false)
})

/** A minimal element tree with the bits markInCanvas reads (querySelectorAll, attributes, parents). */
class El {
  attrs = new Map<string, string>()
  children: El[] = []
  parentElement: El | null = null
  tag: string
  classes: string[]
  text: string
  constructor(tag: string, classes: string[] = [], text = '', attrs: Record<string, string> = {}) {
    this.tag = tag
    this.classes = classes
    this.text = text
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v)
  }
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this
      this.children.push(k)
    }
    return this
  }
  get childElementCount() {
    return this.children.length
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('')
  }
  hasAttribute(n: string) {
    return this.attrs.has(n)
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v)
  }
  removeAttribute(n: string) {
    this.attrs.delete(n)
  }
  private is(sel: string): boolean {
    if (sel.startsWith('.')) return this.classes.includes(sel.slice(1))
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
    if (attr) return attr[2] === undefined ? this.attrs.has(attr[1]) : this.attrs.get(attr[1]) === attr[2]
    return this.tag === sel
  }
  private all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()])
  }
  querySelectorAll(sel: string): El[] {
    const steps = sel.split(' ')
    return this.all().filter((el) => {
      if (!el.is(steps[steps.length - 1])) return false
      let i = steps.length - 2
      for (let p = el.parentElement; p && p !== this && i >= 0; p = p.parentElement) if (p.is(steps[i])) i--
      return i < 0
    })
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null
  }
  closest(sel: string): El | null {
    if (this.is(sel)) return this
    for (let p = this.parentElement; p; p = p.parentElement) if (p.is(sel)) return p
    return null
  }
}

test('markInCanvas marks the block of each artifact, keeps snippets, and unmarks what no longer matches', () => {
  const md = new El('div', ['aiui-markdown'])
  const codeBlock = new El('div').add(new El('div', [], '', { 'data-aiui-code': '' }).add(new El('pre', [], code.content)))
  const snippet = new El('div').add(new El('div', [], '', { 'data-aiui-code': '' }).add(new El('pre', [], 'print(1)')))
  const tableBlock = new El('div').add(
    new El('div').add(new El('table').add(new El('thead').add(new El('th', [], 'Algorithm'), new El('th', [], 'Stable')))),
  )
  md.add(new El('p', [], 'Here it is'), codeBlock, snippet, tableBlock)
  const reasoning = new El('div', [], '', { 'data-part': 'reasoning' }).add(
    new El('div', ['aiui-markdown']).add(new El('div', [], '', { 'data-aiui-code': '' }).add(new El('pre', [], code.content))),
  )
  const message = new El('div', [], '', { 'data-role': 'assistant' }).add(reasoning, md)
  const msg = message as unknown as Element

  assert.equal(markInCanvas(msg, [code, table]), 2)
  assert.equal(codeBlock.hasAttribute(IN_CANVAS), true, 'the whole markdown block, not just the code')
  assert.equal(tableBlock.hasAttribute(IN_CANVAS), true)
  assert.equal(snippet.hasAttribute(IN_CANVAS) || snippet.children[0].hasAttribute(IN_CANVAS), false)
  assert.equal(reasoning.querySelectorAll(`[${IN_CANVAS}]`).length, 0, 'reasoning is never touched')

  assert.equal(markInCanvas(msg, [table]), 1)
  assert.equal(codeBlock.hasAttribute(IN_CANVAS), false)
  assert.equal(markInCanvas(msg, []), 0)
  assert.equal(tableBlock.hasAttribute(IN_CANVAS), false)
})

test("a table's copy and download actions leave with it: the renderer's table frame is the block", () => {
  // Streamdown: [data-streamdown=table-wrapper] > (the scroll box with the table) + (the actions, drawn over the corner).
  const scroll = new El('div', ['border-collapse']).add(
    new El('table').add(new El('thead').add(new El('th', [], 'Algorithm'), new El('th', [], 'Stable'))),
  )
  const actions = new El('div').add(new El('button', [], 'Copy table'))
  const wrapper = new El('div', [], '', { 'data-streamdown': 'table-wrapper' }).add(scroll, actions)
  const md = new El('div', ['aiui-markdown']).add(new El('p', [], 'Here it is'), new El('div').add(wrapper), new El('p', [], 'Pick mergesort'))
  const message = new El('div', [], '', { 'data-role': 'assistant' }).add(md)

  assert.equal(markInCanvas(message as unknown as Element, [table]), 1)
  const marked = md.querySelectorAll(`[${IN_CANVAS}]`)
  assert.equal(marked.length, 1)
  assert.ok(marked[0] === wrapper || marked[0] === wrapper.parentElement, 'the frame (or its only-child wrapper) is hidden, actions included')
  assert.equal(scroll.hasAttribute(IN_CANVAS), false, 'not just the table, which left the actions over the reply text')
})
