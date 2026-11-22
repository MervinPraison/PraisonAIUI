/**
 * Submitting a `form` / `filter_bar` to the page action: on the submit
 * button, and on change (the whole form with `submit_on_change`, or inputs
 * marked `data-auto-submit`). Text is debounced; an automatic submit whose
 * values equal the last one posted is skipped; a change made while a submit
 * is in flight posts once more when it settles, so the page ends on the
 * latest values.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useBlockContext } from './context'
import { AUTO_SUBMIT_EVENTS, DEBOUNCE_MS, autoSubmitKind, collectFormValues } from './formState'

type Patch = Record<string, unknown>

export interface FormSubmitter {
  formRef: RefObject<HTMLFormElement | null>
  busy: boolean
  /** Post the form's values, with `patch` on top. `auto` skips a repeat of the last post. */
  submit(patch?: Patch, auto?: boolean): Promise<void>
}

export function useFormSubmit(label: string, submitOnChange: boolean): FormSubmitter {
  const ctx = useBlockContext()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [busy, setBusy] = useState(false)
  const st = useRef<{ last: string; running: boolean; queued: Patch | null; timer?: ReturnType<typeof setTimeout> }>({
    last: '',
    running: false,
    queued: null,
  })

  const submit = useCallback(
    async (patch?: Patch, auto = false): Promise<void> => {
      const s = st.current
      clearTimeout(s.timer)
      const form = formRef.current
      if (!form) return
      if (s.running) {
        s.queued = { ...s.queued, ...patch }
        return
      }
      const body = { ...collectFormValues(form), ...patch }
      const key = JSON.stringify(body)
      if (auto && key === s.last) return
      s.last = key
      s.running = true
      setBusy(true)
      try {
        await ctx.runAction({ body, label })
      } finally {
        s.running = false
        setBusy(false)
        const next = s.queued
        s.queued = null
        if (next) void submit(next, true)
      }
    },
    [ctx, label],
  )

  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const s = st.current
    const onEvent = (e: Event) => {
      const kind = autoSubmitKind(e, submitOnChange)
      if (!kind) return
      clearTimeout(s.timer)
      if (kind === 'debounce') s.timer = setTimeout(() => void submit(undefined, true), DEBOUNCE_MS)
      else void submit(undefined, true)
    }
    for (const t of AUTO_SUBMIT_EVENTS) form.addEventListener(t, onEvent)
    return () => {
      clearTimeout(s.timer)
      for (const t of AUTO_SUBMIT_EVENTS) form.removeEventListener(t, onEvent)
    }
  }, [submit, submitOnChange])

  return { formRef, busy, submit }
}
