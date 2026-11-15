/**
 * Editor page template (ProEditor.dc.html): a full-height workspace with an
 * optional file tree, open-file tabs, a run bar, the code, an output panel,
 * an assistant aside and a status bar. Every region is optional; the page
 * owns the state (which file, what ran) and passes it in.
 *
 * Also: CodeView (read-only code with a line gutter and inline diagnostics)
 * and FileTree (a keyboard-navigable tree), and the `code_editor` block.
 */
import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, CircleX, File, Folder, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { arr, display, isRecord, num, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { stepTab } from './model'
import './page.css'

export interface EditorTab {
  id: string
  title: string
  dirty?: boolean
  /** Error count, shown as a badge. */
  problems?: number
}

export interface EditorProps {
  /** Accessible name of the workspace ("Code Studio"). */
  label: string
  /** The file tree region (FileTree), left. */
  files?: ReactNode
  filesTitle?: string
  tabs?: readonly EditorTab[]
  activeTab?: string
  onTab?: (id: string) => void
  onCloseTab?: (id: string) => void
  /** Run bar: Run, environment, problem counts. */
  toolbar?: ReactNode
  /** The code (CodeView, or a real editor). */
  children: ReactNode
  /** Output / terminal panel under the code. */
  panel?: ReactNode
  panelTitle?: ReactNode
  /** Assistant or inspector, right. */
  aside?: ReactNode
  asideTitle?: ReactNode
  /** Status bar items (Ln, Col, language…). */
  status?: ReactNode
  className?: string
}

export function Editor({
  label,
  files,
  filesTitle = 'Files',
  tabs,
  activeTab,
  onTab,
  onCloseTab,
  toolbar,
  children,
  panel,
  panelTitle,
  aside,
  asideTitle,
  status,
  className,
}: EditorProps) {
  const ids = tabs?.map((t) => t.id) ?? []
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!activeTab) return
    const next = stepTab(ids, activeTab, e.key)
    if (next !== activeTab) {
      e.preventDefault()
      onTab?.(next)
      e.currentTarget.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next)}"]`)?.focus()
    }
  }
  return (
    <div className={['aiui-tpl aiui-tpl-editor', className].filter(Boolean).join(' ')} data-aiui-template="editor" aria-label={label} role="region">
      <div className="aiui-tpl-editor-body">
        {files && (
          <nav aria-label={filesTitle} className="aiui-tpl-files">
            <div className="aiui-tpl-pane-head">
              <h2 className="aiui-tpl-h3">{filesTitle}</h2>
            </div>
            {files}
          </nav>
        )}
        <div className="aiui-tpl-editor-main">
          {tabs && tabs.length > 0 && (
            <div role="tablist" aria-label="Open files" className="aiui-tpl-tabs" onKeyDown={onTabKey}>
              {tabs.map((t) => {
                const on = t.id === activeTab
                return (
                  <div
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    data-tab-id={t.id}
                    className="aiui-tpl-tab"
                    onClick={() => onTab?.(t.id)}
                  >
                    <span>{t.title}</span>
                    {t.dirty && <span className="aiui-tpl-dirty" role="img" aria-label="Unsaved" />}
                    {!!t.problems && (
                      <span className="aiui-tpl-count" aria-label={`${t.problems} ${t.problems === 1 ? 'error' : 'errors'}`}>
                        {t.problems}
                      </span>
                    )}
                    {onCloseTab && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Close ${t.title}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onCloseTab(t.id)
                        }}
                      >
                        <X aria-hidden />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {toolbar && (
            <div role="toolbar" aria-label="Run" className="aiui-tpl-editor-bar">
              {toolbar}
            </div>
          )}
          {children}
          {panel && (
            <section className="aiui-tpl-panel" aria-label={typeof panelTitle === 'string' ? panelTitle : 'Output'}>
              {panelTitle && (
                <div className="aiui-tpl-pane-head">
                  <h2 className="aiui-tpl-h3">{panelTitle}</h2>
                </div>
              )}
              {panel}
            </section>
          )}
        </div>
        {aside && (
          <aside className="aiui-tpl-aside" aria-label={typeof asideTitle === 'string' ? asideTitle : 'Assistant'}>
            {asideTitle && (
              <div className="aiui-tpl-pane-head">
                <h2 className="aiui-tpl-h3">{asideTitle}</h2>
              </div>
            )}
            <div>{aside}</div>
          </aside>
        )}
      </div>
      {status && <div className="aiui-tpl-status">{status}</div>}
    </div>
  )
}

export interface Diagnostic {
  /** 1-based line. */
  line: number
  severity: 'error' | 'warning'
  message: string
}

/** Read-only code with line numbers; a diagnostic marks its line and explains it below. */
export function CodeView({
  code,
  label,
  diagnostics = [],
  startLine = 1,
}: {
  code: string
  /** "Editor, bench.py, Python" */
  label: string
  diagnostics?: readonly Diagnostic[]
  startLine?: number
}) {
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code])
  const byLine = useMemo(() => {
    const m = new Map<number, Diagnostic[]>()
    for (const d of diagnostics) m.set(d.line, [...(m.get(d.line) ?? []), d])
    return m
  }, [diagnostics])
  return (
    <div className="aiui-tpl-code" role="textbox" aria-multiline="true" aria-readonly="true" aria-label={label} tabIndex={0}>
      <div className="aiui-tpl-code-lines">
        {lines.map((text, i) => {
          const n = startLine + i
          const diags = byLine.get(n)
          const severity = diags?.some((d) => d.severity === 'error') ? 'error' : diags ? 'warning' : undefined
          return (
            <Fragment key={n}>
              <div className="aiui-tpl-line" data-severity={severity} aria-invalid={severity === 'error' || undefined}>
                <span className="aiui-tpl-gutter" aria-hidden="true">
                  {n}
                </span>
                <span>{text}</span>
              </div>
              {diags?.map((d, j) => (
                <div key={j} role="note" className="aiui-tpl-diag" data-severity={d.severity}>
                  {d.severity === 'error' ? <CircleX aria-hidden width={14} height={14} /> : <TriangleAlert aria-hidden width={14} height={14} />}
                  <span>
                    <strong>Line {n}:</strong> {d.message}
                  </span>
                </div>
              ))}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

export interface FileNode {
  /** Unique path ("src/bench.py"). */
  path: string
  name: string
  children?: readonly FileNode[]
  /** Problems badge. */
  badge?: ReactNode
}

function flatten(nodes: readonly FileNode[], open: ReadonlySet<string>, out: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    out.push(n)
    if (n.children && open.has(n.path)) flatten(n.children, open, out)
  }
  return out
}

/** A file tree: ↑/↓ move, → opens a folder, ← closes it, Enter selects a file. */
export function FileTree({
  label,
  nodes,
  selected,
  onSelect,
  defaultOpen,
}: {
  label: string
  nodes: readonly FileNode[]
  selected?: string
  onSelect?: (path: string) => void
  /** Folders open at first (default: every folder). */
  defaultOpen?: readonly string[]
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    if (defaultOpen) return new Set(defaultOpen)
    const all = new Set<string>()
    const walk = (ns: readonly FileNode[]) => ns.forEach((n) => n.children && (all.add(n.path), walk(n.children)))
    walk(nodes)
    return all
  })
  const [focus, setFocus] = useState<string | undefined>(selected)
  const visible = flatten(nodes, open)
  const current = focus ?? selected ?? visible[0]?.path

  const setFolder = (path: string, on: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (on) next.add(path)
      else next.delete(path)
      return next
    })

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const at = visible.findIndex((n) => n.path === current)
    const node = visible[at]
    let next: string | undefined
    if (e.key === 'ArrowDown') next = visible[Math.min(visible.length - 1, at + 1)]?.path
    else if (e.key === 'ArrowUp') next = visible[Math.max(0, at - 1)]?.path
    else if (e.key === 'ArrowRight' && node?.children) setFolder(node.path, true)
    else if (e.key === 'ArrowLeft' && node?.children) setFolder(node.path, false)
    else if (e.key === 'Enter' && node) {
      if (node.children) setFolder(node.path, !open.has(node.path))
      else onSelect?.(node.path)
    } else return
    e.preventDefault()
    if (next) {
      setFocus(next)
      e.currentTarget.querySelector<HTMLElement>(`[data-path="${CSS.escape(next)}"]`)?.focus()
    }
  }

  const render = (ns: readonly FileNode[], depth: number): ReactNode =>
    ns.map((n) => {
      const folder = !!n.children
      const expanded = folder && open.has(n.path)
      return (
        <li
          key={n.path}
          role="treeitem"
          aria-expanded={folder ? expanded : undefined}
          aria-selected={!folder ? n.path === selected : undefined}
          aria-level={depth + 1}
          data-path={n.path}
          tabIndex={n.path === current ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation()
            setFocus(n.path)
            if (folder) setFolder(n.path, !expanded)
            else onSelect?.(n.path)
          }}
        >
          <div className="aiui-tpl-node" style={{ paddingInlineStart: 8 + depth * 22 }}>
            {folder ? expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden /> : null}
            {folder ? <Folder aria-hidden /> : <File aria-hidden />}
            <span className="aiui-tpl-grow">{n.name}</span>
            {n.badge}
          </div>
          {expanded && n.children && <ul role="group">{render(n.children, depth + 1)}</ul>}
        </li>
      )
    })

  return (
    <ul role="tree" aria-label={label} className="aiui-tpl-tree" onKeyDown={onKey}>
      {render(nodes, 0)}
    </ul>
  )
}

// ── `code_editor` block ──────────────────────────────────────────────

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

export default Editor
