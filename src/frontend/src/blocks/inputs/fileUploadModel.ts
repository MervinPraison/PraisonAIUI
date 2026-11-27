/**
 * Pure helpers for the `file_upload` block (validation, size formatting, handle sanitization).
 */
import { isRecord, str } from '../normalize'

export interface UploadedFileHandle {
  id: string
  filename: string
  content_type: string
  size: number
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function validateUploadCandidate(file: { name: string; size: number }, maxSizeMb: number): string | null {
  const limitBytes = maxSizeMb * 1024 * 1024
  if (file.size > limitBytes) {
    return `${file.name} exceeds the ${maxSizeMb} MB limit (${formatFileSize(file.size)}).`
  }
  return null
}

const EXT_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** Infer MIME type from file.type or filename extension (browsers often omit type for .md/.csv). */
export function inferUploadMimeType(file: { name: string; type?: string }): string {
  if (file.type) return file.type
  const dot = file.name.lastIndexOf('.')
  if (dot >= 0) {
    const ext = file.name.slice(dot).toLowerCase()
    if (EXT_MIME[ext]) return EXT_MIME[ext]
  }
  return 'application/octet-stream'
}

/** Extract safe attachment handle fields from `/api/chat/attachments` response JSON. */
export function parseUploadResponse(data: unknown, fallbackName: string): UploadedFileHandle | null {
  if (!isRecord(data)) return null
  const id = str(data.id)
  if (!id) return null
  return {
    id,
    filename: str(data.filename) || fallbackName,
    content_type: str(data.content_type) || 'application/octet-stream',
    size: typeof data.size === 'number' && Number.isFinite(data.size) ? data.size : 0,
  }
}
