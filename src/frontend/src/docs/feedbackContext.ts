// The page and its feedback settings for the code-block flags (PageFooter.tsx FlaggedPre); null: none.
import { createContext } from 'react'
import type { DocsFeedbackConfig } from './feedback'

export const CodeFeedback = createContext<{ path: string; cfg: DocsFeedbackConfig } | null>(null)
