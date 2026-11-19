// The page, its feedback settings and the server's vote endpoint for the code-block flags (PageFooter.tsx FlaggedPre); null: none.
import { createContext } from 'react'
import type { DocsFeedbackConfig } from './feedback'

export const CodeFeedback = createContext<{ path: string; cfg: DocsFeedbackConfig; server?: string | null } | null>(null)
