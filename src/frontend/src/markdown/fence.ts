/**
 * Markdown for a piece of code: a fenced block whose fence is longer than any
 * backtick run inside the code, so the code can never close it early. Used
 * where code arrives as data (chat `code` elements, the `code` block) and is
 * shown through the one Markdown renderer (Shiki, copy, download).
 */
export function fenced(code: string, language: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const lang = /^[\w#+.-]{1,32}$/.test(language) ? language : ''
  return `${fence}${lang}\n${code}\n${fence}`
}
