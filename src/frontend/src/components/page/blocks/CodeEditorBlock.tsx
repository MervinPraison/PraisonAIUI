/**
 * The `code_editor` block: block props to the Editor template. Registered
 * lazily by blocks/coreBlocks.tsx, in its own chunk. The template does not
 * depend on the block layer, so a React page uses it without the blocks chunk.
 */
import { useMemo, useState } from 'react'
import { arr, display, isRecord, num, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { CodeView, Editor, type Diagnostic } from '../Editor'

/**
 * `{type: "code_editor", title, files: [{name, content, language}],
 *   output, diagnostics: [{file, line, severity, message}]}`: a read-only
 * multi-file viewer with tabs and an output panel.
 */
export function CodeEditorBlock({ node }: { node: BlockNode }) {
  const p = node.props ?? {}
  const files = useMemo(
    () =>
      arr(p.files)
        .filter(isRecord)
        .map((f, i) => ({ id: str(f.name ?? f.path, `file-${i + 1}`), content: str(f.content ?? f.code), language: str(f.language) })),
    [p.files],
  )
  const [active, setActive] = useState<string | undefined>(undefined)
  const file = files.find((f) => f.id === active) ?? files[0]
  const diagnostics: Diagnostic[] = arr(p.diagnostics)
    .filter(isRecord)
    .filter((d) => !d.file || d.file === file?.id)
    .map((d) => ({
      line: num(d.line, 1),
      severity: d.severity === 'warning' || d.severity === 'warn' ? 'warning' : 'error',
      message: display(d.message),
    }))
  const title = str(p.title ?? p.label, 'Code')
  const output = p.output != null ? display(p.output) : ''
  if (!file) return null
  return (
    <Editor
      label={title}
      tabs={files.length > 1 ? files.map((f) => ({ id: f.id, title: f.id, problems: undefined })) : undefined}
      activeTab={file.id}
      onTab={setActive}
      panel={output ? <pre>{output}</pre> : undefined}
      panelTitle={output ? 'Output' : undefined}
      status={
        <>
          <span>{file.id}</span>
          {file.language && <span>{file.language}</span>}
          <span>{file.content.split('\n').length} lines</span>
        </>
      }
    >
      <CodeView code={file.content} label={`${title}, ${file.id}${file.language ? `, ${file.language}` : ''}`} diagnostics={diagnostics} />
    </Editor>
  )
}
