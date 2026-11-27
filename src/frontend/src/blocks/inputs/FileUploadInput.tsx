/**
 * Lazy `file_upload` block: drag-and-drop or browse files, upload to the
 * authenticated `POST /api/chat/attachments` endpoint, display removable chips,
 * and post safe attachment handles (`{id, filename, content_type, size}`) via
 * `HiddenValue` (`data-aiui-json`).
 */
import { useId, useRef, useState, type ChangeEvent, type DragEvent, type JSX } from 'react'
import { FileText, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BlockNode } from '@/sdk/registry'
import { isRecord, num, str } from '../normalize'
import { Chip, HiddenValue } from './shared'
import {
  formatFileSize,
  inferUploadMimeType,
  parseInitialFiles,
  parseUploadResponse,
  validateUploadCandidate,
  type UploadedFileHandle,
} from './fileUploadModel'

export function FileUploadInput({ node }: { node: BlockNode }): JSX.Element {
  const p = node.props ?? {}
  const label = str(p.label, 'Upload file')
  const name = str(p.name, 'files')
  const accept = str(p.accept)
  const multiple = p.multiple === true
  const maxSizeMb = Math.max(0.1, num(p.max_size_mb, 10))
  const helpText = str(p.help_text)
  const autoSubmit = p.auto_submit === true

  const inputId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<UploadedFileHandle[]>(() => parseInitialFiles(p.value, multiple))
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uploadBatch = async (selected: FileList | File[] | null) => {
    if (!selected || selected.length === 0) return
    const list = multiple ? Array.from(selected) : [selected[0]]
    setError(null)

    for (const file of list) {
      const problem = validateUploadCandidate(file, maxSizeMb)
      if (problem) {
        setError(problem)
        return
      }
    }

    setUploading(true)
    try {
      const uploaded: UploadedFileHandle[] = []
      for (const file of list) {
        const res = await fetch('/api/chat/attachments', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': inferUploadMimeType(file),
            'X-Filename': encodeURIComponent(file.name),
          },
          body: file,
        })
        const data: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          const msg = isRecord(data) && str(data.error) ? str(data.error) : `Upload failed (${res.status})`
          throw new Error(msg)
        }
        const handle = parseUploadResponse(data, file.name)
        if (!handle) throw new Error('Unexpected upload response from server.')
        uploaded.push(handle)
      }
      setFiles((prev) => (multiple ? [...prev, ...uploaded] : uploaded))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    void uploadBatch(e.target.files)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (!uploading) void uploadBatch(e.dataTransfer.files)
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const hiddenValue = multiple ? files : (files[0] ?? null)

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-auto-submit={autoSubmit ? '' : undefined}>
      <label htmlFor={inputId} className="text-xs font-medium text-foreground">
        {label}
      </label>

      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-busy={uploading || undefined}
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
            e.preventDefault()
            fileRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition-colors outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring',
          dragging ? 'border-primary bg-accent-soft' : 'border-border bg-background hover:bg-muted/40',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        <input
          id={inputId}
          ref={fileRef}
          type="file"
          accept={accept || undefined}
          multiple={multiple}
          onChange={onInputChange}
          className="sr-only"
          tabIndex={-1}
        />
        {uploading ? (
          <Loader2 aria-hidden className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload aria-hidden className="size-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">
          {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
        </span>
        <span className="text-xs text-muted-foreground">
          {helpText || `Max ${maxSizeMb} MB${accept ? ` · ${accept}` : ''}`}
        </span>
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Uploaded files">
          {files.map((f) => (
            <Chip
              key={f.id}
              removeLabel={`Remove ${f.filename}`}
              disabled={uploading}
              onRemove={() => removeFile(f.id)}
            >
              <span className="inline-flex items-center gap-1">
                <FileText aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{f.filename}</span>
                <span className="text-muted-foreground">({formatFileSize(f.size)})</span>
              </span>
            </Chip>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <HiddenValue name={name} label={label} value={hiddenValue} json />
    </div>
  )
}

export default FileUploadInput
