/**
 * Lazy chunk: the command palette (cmdk via components/ui/command). Opened by
 * Ctrl/Cmd+K, the header search button and window.aiui.openCommandPalette().
 * Items: the commands registered through `registerCommand` (@aiui/sdk),
 * first-party ones included (builtin.chat's "New chat"), every page, the
 * three colour modes, plugin theme presets and the plugin settings dialog.
 */
import { useMemo, useState } from 'react'
import { Check, Monitor, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react'
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
import { useSettingsSections, useThemePresets } from '@/sdk/contributions'
import { footerPages, groupPages, type NavGroupsConfig } from './nav'
import { paletteFilter, rankSections } from './paletteFilter'
import { PageIcon } from './PageIcon'
import { createFocusReturn } from './focusReturn'
import { useCommandPaletteQuery } from './palette'
import { navigate } from './router'
import { openSettingsDialog } from './settingsForm'
import { setThemePreset, useThemePresetChoice } from './themePresets'

const DEFAULT_COMMAND_GROUP = 'Commands'

/**
 * Registered command groups listed after the pages, with the palette's own
 * Preferences and Theme sections (commands in those two groups join them).
 * How the app looks is not what most opens of the palette are for: six
 * "Switch layout" rows used to fill the first screen ahead of every page.
 * A query still ranks every section by its best match (rankSections).
 */
const TRAILING_COMMAND_GROUPS: ReadonlySet<string> = new Set(['Preferences', 'Layout', 'Theme'])

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
  groups: groupConfig,
  activeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: readonly ShellPage[]
  /** The manifest's `layout.groups` (navGroups()), so pages list in sidebar order. */
  groups?: NavGroupsConfig
  activeId: string
}) {
  const { theme, setTheme } = useTheme()
  const groups = useMemo(() => {
    const g = groupPages(pages, groupConfig)
    const footer = footerPages(pages)
    return footer.length ? [...g, { name: 'More', pages: footer }] : g
  }, [pages, groupConfig])
  const registered = useCommands()
  const settingsSections = useSettingsSections()
  const presets = useThemePresets()
  const presetChoice = useThemePresetChoice()
  const activePreset = presets.some((p) => p.id === presetChoice) ? presetChoice : null
  // Plugin presets (registerThemePreset / a plugin's themes()), plus the app's own.
  const presetItems = presets.length
    ? [{ id: null, label: 'Default' }, ...presets.map((p) => ({ id: p.id as string | null, label: p.label }))]
    : []
  const commandGroups = useMemo(() => groupCommands(registered), [registered])
  // openCommandPalette({ query }) prefills the search (a layout's command bar).
  const query = useCommandPaletteQuery()
  const [search, setSearch] = useState(() => (open ? query : ''))
  // The palette stays mounted after its first open: every open starts with an
  // empty query, or the one it was opened with (reset while rendering the
  // reopen, so closing never flashes the unfiltered list), however it was
  // closed (Esc, a choice, Ctrl+K). A new query while open replaces the text.
  const [seen, setSeen] = useState({ open, query })
  if (seen.open !== open || (open && seen.query !== query)) {
    setSeen({ open, query })
    if (open) setSearch(query)
  }
  // No Dialog.Trigger: put focus back where it was (the composer, a button),
  // or on the new page's main region after navigating, never on <body>.
  const [focus] = useState(createFocusReturn)

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }
  const commandItem = (c: ShellCommand) => ({
    key: c.id,
    value: `${c.title} ${c.id}`,
    keywords: c.keywords ? [...c.keywords] : undefined,
    node: (
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
    ),
  })
  const commandSection = (group: { name: string; commands: ShellCommand[] }) => ({
    key: `commands:${group.name}`,
    heading: group.name,
    items: group.commands.map(commandItem),
  })
  const registeredByGroup = new Map(commandGroups.map((g) => [g.name, g.commands]))
  // Registered groups that follow the pages, except the two merged into the palette's own sections.
  const trailingGroups = commandGroups.filter((g) => TRAILING_COMMAND_GROUPS.has(g.name) && g.name !== 'Preferences' && g.name !== 'Theme')
  const settingsKeywords = ['settings', 'preferences', 'options', ...settingsSections.map((x) => x.title)]
  const preferenceItems = [
    ...(registeredByGroup.get('Preferences') ?? []).map(commandItem),
    ...(settingsSections.length
      ? [
          {
            key: 'plugin-settings',
            value: 'Plugin settings',
            keywords: settingsKeywords,
            node: (
              <CommandItem key="plugin-settings" value="Plugin settings" keywords={settingsKeywords} onSelect={() => run(() => openSettingsDialog())}>
                <SlidersHorizontal />
                <span>Plugin settings</span>
              </CommandItem>
            ),
          },
        ]
      : []),
  ]
  const goTo = (pageId: string) => {
    if (pageId !== activeId) focus.toMain()
    run(() => navigate(pageId))
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search pages and commands"
      showCloseButton={false}
      filter={paletteFilter}
      loop
      onOpenAutoFocus={focus.capture}
      onCloseAutoFocus={focus.restore}
      className="top-[15%] translate-y-0 sm:max-w-xl"
    >
      <CommandInput
        placeholder="Search pages and commands…"
        aria-label="Search pages and commands"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No matching pages or commands.</CommandEmpty>
        {rankSections(
          [
            ...commandGroups.filter((g) => !TRAILING_COMMAND_GROUPS.has(g.name)).map(commandSection),
            ...groups.map((group) => ({
              key: group.name,
              heading: group.name,
              items: group.pages.map((p) => {
                // The value starts with the title (paletteFilter ranks a title
                // prefix first); the id keeps it unique. Group and description
                // are keywords: they match only by word prefix, never fuzzily.
                const value = `${p.title} ${p.id}`
                const keywords = [p.id, group.name, ...(p.description ? [p.description] : [])]
                return {
                  key: p.id,
                  value,
                  keywords,
                  node: (
                    <CommandItem key={p.id} value={value} keywords={keywords} onSelect={() => goTo(p.id)}>
                      <PageIcon page={p} />
                      <span className="truncate">{p.title}</span>
                      {p.id === activeId && <CommandShortcut>Current</CommandShortcut>}
                    </CommandItem>
                  ),
                }
              }),
            })),
            ...(preferenceItems.length ? [{ key: 'preferences', heading: 'Preferences', items: preferenceItems }] : []),
            ...trailingGroups.map(commandSection),
            {
              key: 'theme',
              heading: 'Theme',
              items: [
                ...(registeredByGroup.get('Theme') ?? []).map(commandItem),
                ...presetItems.map((p) => ({
                  key: `preset:${p.id ?? ''}`,
                  value: `${p.label} theme`,
                  keywords: ['theme', 'appearance', 'preset', 'colours', 'colors'],
                  node: (
                    <CommandItem
                      key={`preset:${p.id ?? ''}`}
                      value={`${p.label} theme`}
                      keywords={['theme', 'appearance', 'preset', 'colours', 'colors']}
                      data-theme-preset={p.id ?? ''}
                      onSelect={() => run(() => setThemePreset(p.id))}
                    >
                      <Palette />
                      <span>{p.label} theme</span>
                      {activePreset === p.id && <Check className="ml-auto" aria-label="Active" />}
                    </CommandItem>
                  ),
                })),
                ...THEMES.map((t) => ({
                  key: t.value,
                  value: `${t.label} mode`,
                  keywords: ['theme', 'appearance'],
                  node: (
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
                  ),
                })),
              ],
            },
          ],
          search,
        ).map((section) => (
          <CommandGroup key={section.key} heading={section.heading}>
            {section.items.map((item) => item.node)}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
