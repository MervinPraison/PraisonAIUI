// CommandDialog (components/ui/command.tsx): what it leaves in the page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandDialog, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

test('a closed CommandDialog renders nothing: its sr-only title lives inside the content', () => {
  const html = renderToStaticMarkup(
    <CommandDialog open={false} title="Command palette" description="Search pages and commands">
      <CommandInput />
      <CommandList>
        <CommandItem>Logs</CommandItem>
      </CommandList>
    </CommandDialog>,
  )
  assert.equal(html, '', 'no stray heading or paragraph next to the closed dialog')
})
