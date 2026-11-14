/**
 * Lazy chunk: the settings dialog. It renders every settings section plugins
 * contribute (registerSettingsSection, a plugin's Python settings()) from its
 * field schema: text, multi-line text, number, switch and select. Opened from
 * the header button and the command palette.
 */
import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useSettingsSections, type NormalizedSettingsField, type SettingsSection } from '@/sdk/contributions'
import { notify } from '@/sdk/notify'
import { fieldErrorsOf, fromDraft, sameDraft, toDraft, type SettingsDraft } from './settingsForm'

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; saved: SettingsDraft }

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

function FieldControl({
  field,
  id,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  field: NormalizedSettingsField
  id: string
  value: string | boolean
  invalid: boolean
  describedBy?: string
  onChange: (v: string | boolean) => void
}) {
  const common = { id, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy }
  switch (field.type) {
    case 'boolean':
      return <Switch {...common} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
    case 'select':
      return (
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger {...common} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'text':
      return <Textarea {...common} rows={3} value={String(value)} onChange={(e) => onChange(e.target.value)} />
    default:
      return (
        <Input
          {...common}
          type={field.type === 'number' ? 'number' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

function SectionForm({ section }: { section: SettingsSection }) {
  const baseId = useId()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [draft, setDraft] = useState<SettingsDraft>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    section.load().then(
      (values) => {
        if (!alive) return
        const saved = toDraft(section.fields, values ?? {})
        setDraft(saved)
        setLoad({ status: 'ready', saved })
      },
      (err: unknown) => {
        if (alive) setLoad({ status: 'error', message: messageOf(err) })
      },
    )
    return () => {
      alive = false
    }
  }, [section, attempt])

  if (load.status === 'loading') {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={`Loading ${section.title}`}>
        {section.fields.map((f) => (
          <Skeleton key={f.key} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (load.status === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-muted-foreground">Could not load these settings: {load.message}</p>
        <Button variant="outline" size="sm" onClick={() => { setLoad({ status: 'loading' }); setAttempt((n) => n + 1) }}>
          Retry
        </Button>
      </div>
    )
  }

  const dirty = !sameDraft(draft, load.saved)
  const save = async () => {
    const parsed = fromDraft(section.fields, draft)
    setErrors(parsed.errors)
    setFormError('')
    if (Object.keys(parsed.errors).length) return
    setSaving(true)
    try {
      const result = await section.save(parsed.values)
      const saved = toDraft(section.fields, result ?? parsed.values)
      setDraft(saved)
      setLoad({ status: 'ready', saved })
      void notify(`${section.title} saved`, { type: 'success' })
    } catch (err) {
      const fields = fieldErrorsOf(err)
      setErrors(fields)
      setFormError(Object.keys(fields).length ? 'Some values were not accepted.' : messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      {section.fields.map((f) => {
        const id = `${baseId}-${f.key}`
        const helpId = f.description ? `${id}-help` : undefined
        const errorId = errors[f.key] ? `${id}-error` : undefined
        return (
          <div
            key={f.key}
            data-settings-field={f.key}
            className={cn('flex flex-col gap-2', f.type !== 'text' && 'sm:flex-row sm:items-start sm:justify-between sm:gap-6')}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={id}>{f.label}</Label>
              {f.description && (
                <p id={helpId} className="text-xs text-muted-foreground">
                  {f.description}
                </p>
              )}
            </div>
            <div className={cn('flex flex-col gap-1', f.type !== 'text' && 'sm:w-56 sm:shrink-0', f.type === 'boolean' && 'sm:items-end')}>
              <FieldControl
                field={f}
                id={id}
                value={draft[f.key] ?? ''}
                invalid={!!errors[f.key]}
                describedBy={[helpId, errorId].filter(Boolean).join(' ') || undefined}
                onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
              />
              {errors[f.key] && (
                <p id={errorId} className="text-xs text-destructive">
                  {errors[f.key]}
                </p>
              )}
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {formError && (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => { setDraft(load.saved); setErrors({}); setFormError('') }}>
          Reset
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || saving}>
          {saving && <Spinner />}
          Save
        </Button>
      </div>
    </form>
  )
}

export default function SettingsDialog({
  open,
  onOpenChange,
  initialSectionId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSectionId: string | null
}) {
  const sections = useSettingsSections()
  const [picked, setPicked] = useState<string | null>(initialSectionId)
  // A new open request may name another section: follow it.
  const [lastInitial, setLastInitial] = useState(initialSectionId)
  if (lastInitial !== initialSectionId) {
    setLastInitial(initialSectionId)
    setPicked(initialSectionId)
  }
  const active = sections.find((s) => s.id === picked) ?? sections[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-aiui-settings-dialog="" className="flex max-h-[min(90dvh,680px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-base">Plugin settings</DialogTitle>
          <DialogDescription>Options that installed plugins add to this app.</DialogDescription>
        </DialogHeader>
        {sections.length === 0 || !active ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">No plugin adds settings.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav
              aria-label="Settings sections"
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-b-0"
            >
              {sections.map((s) => (
                <Button
                  key={s.id}
                  variant={s.id === active.id ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-current={s.id === active.id ? 'true' : undefined}
                  data-settings-section={s.id}
                  onClick={() => setPicked(s.id)}
                  className="justify-start"
                >
                  <span className="truncate">{s.title}</span>
                </Button>
              ))}
            </nav>
            <section aria-labelledby={`aiui-settings-${active.id}`} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <h3 id={`aiui-settings-${active.id}`} className="text-sm font-semibold text-foreground">
                {active.title}
              </h3>
              {active.description && <p className="mt-1 text-sm text-muted-foreground">{active.description}</p>}
              <div className="mt-5">
                <SectionForm key={active.id} section={active} />
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
