/**
 * Lazy chunk: the command palette (cmdk via components/ui/command). Opened by
 * Ctrl/Cmd+K, the header search button and window.aiui.openCommandPalette().
 * Items: the commands registered through `registerCommand` (@aiui/sdk),
 * first-party ones included (builtin.chat's "New chat"), every page, and the
 * three colour modes.
 */
import { useMemo } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import type { ShellPage } from '@/sdk/manifest'
import { notify } from '@/sdk/notify'
import { useCommands, type ShellCommand } from '@/sdk/services'
import { footerPages, groupPages } from './nav'
import { paletteFilter } from './paletteFilter'
import { PageIcon } from './PageIcon'
import { navigate } from './router'

const DEFAULT_COMMAND_GROUP = 'Commands'

/** Registered commands by palette heading, in registration order. */
function groupCommands(commands: readonly ShellCommand[]): { name: string; commands: ShellCommand[] }[] {
  const groups = new Map<string, ShellCommand[]>()
  for (const c of commands) {
    const name = c.group || DEFAULT_COMMAND_GROUP
    let list = groups.get(name)
    if (!list) groups.set(name, (list = []))
    list.push(c)
  }
  return [...groups.entries()].map(([name, list]) => ({ name, commands: list }))
}

/** Run a plugin command; a throw or rejection becomes a toast, never a broken palette. */
function runCommand(command: ShellCommand) {
  const failed = (err: unknown) => {
    console.error(`[aiui shell] command '${command.id}' failed`, err)
    void notify(`“${command.title}” failed`, {
      type: 'error',
      description: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    const result = command.run()
    if (result && typeof result.then === 'function') result.then(undefined, failed)
  } catch (err) {
    failed(err)
  }
}

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

export default function CommandPalette({
  open,
  onOpenChange,
  pages,
  activeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: readonly ShellPage[]
  activeId: string
}) {
  const { theme, setTheme } = useTheme()
  const groups = useMemo(() => {
    const g = groupPages(pages)
    const footer = footerPages(pages)
    return footer.length ? [...g, { name: 'More', pages: footer }] : g
  }, [pages])
  const registered = useCommands()
  const commandGroups = useMemo(() => groupCommands(registered), [registered])

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search pages and commands"
      showCloseButton={false}
      filter={paletteFilter}
      className="top-[15%] translate-y-0 sm:max-w-xl"
    >
      <CommandInput placeholder="Search pages and commands…" aria-label="Search pages and commands" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No matching pages or commands.</CommandEmpty>
        {commandGroups.map((group) => (
          <CommandGroup key={`commands:${group.name}`} heading={group.name}>
            {group.commands.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.title} ${c.id}`}
                keywords={c.keywords ? [...c.keywords] : undefined}
                data-command-id={c.id}
                onSelect={() => run(() => runCommand(c))}
              >
                {c.icon ? <c.icon /> : <span aria-hidden="true" className="size-4 shrink-0" />}
                <span className="truncate">{c.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {groups.map((group) => (
          <CommandGroup key={group.name} heading={group.name}>
            {group.pages.map((p) => (
              <CommandItem
                key={p.id}
                // The value starts with the title (paletteFilter ranks a title
                // prefix first); the id keeps it unique. Group and description
                // are keywords: they match only by word prefix, never fuzzily.
                value={`${p.title} ${p.id}`}
                keywords={[p.id, group.name, ...(p.description ? [p.description] : [])]}
                onSelect={() => run(() => navigate(p.id))}
              >
                <PageIcon page={p} />
                <span className="truncate">{p.title}</span>
                {p.id === activeId && <CommandShortcut>Current</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandGroup heading="Theme">
          {THEMES.map((t) => (
            <CommandItem
              key={t.value}
              value={`${t.label} mode`}
              keywords={['theme', 'appearance']}
              onSelect={() => run(() => setTheme(t.value))}
            >
              <t.icon />
              <span>{t.label} mode</span>
              {theme === t.value && <Check className="ml-auto" aria-label="Active" />}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
