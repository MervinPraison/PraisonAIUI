/** Pure heading extractor for BlockPage Markdown document viewers. */
import { slugify } from '@/markdown/slug'

export interface DocHeading {
  id: string
  text: string
  level: 2 | 3
}

const FENCE_LINE = /^\s*(`{3,}|~{3,})/
const HEADING_LINE = /^(#{2,3})\s+(.+?)\s*#*\s*$/
const CUSTOM_ID = /\s*\{#([\w-]+)\}\s*$/

/** Strip common inline markdown markup so heading text matches rendered text. */
function plainHeading(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|~~|\*)/g, '')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .trim()
}

/** Extract `##` and `###` headings outside fenced code blocks, with anchor ids. */
export function extractMarkdownHeadings(markdown: string): DocHeading[] {
  const out: DocHeading[] = []
  let fenceChar: string | null = null
  let fenceLen = 0
  for (const line of markdown.split(/\r?\n/)) {
    const fm = FENCE_LINE.exec(line)
    if (fm) {
      const ch = fm[1][0]
      if (!fenceChar) {
        fenceChar = ch
        fenceLen = fm[1].length
      } else if (ch === fenceChar && fm[1].length >= fenceLen && line.trim() === fm[1]) {
        fenceChar = null
        fenceLen = 0
      }
      continue
    }
    if (fenceChar) continue
    const hm = HEADING_LINE.exec(line)
    if (!hm) continue
    const level = hm[1].length as 2 | 3
    const raw = hm[2]
    const custom = CUSTOM_ID.exec(raw)
    const text = plainHeading(custom ? raw.replace(CUSTOM_ID, '') : raw)
    const id = custom ? custom[1] : slugify(text)
    if (text && id) out.push({ id, text, level })
  }
  return out
}
