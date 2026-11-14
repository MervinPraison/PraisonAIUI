// The shell's default colour mode follows <html data-aiui-theme-default>.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shellDefaultTheme } from './defaultTheme'

const root = (v: string | null) => ({ getAttribute: () => v }) as unknown as HTMLElement

test('light and dark are honoured; anything else follows the system', () => {
  assert.equal(shellDefaultTheme(root('light')), 'light')
  assert.equal(shellDefaultTheme(root('dark')), 'dark')
  assert.equal(shellDefaultTheme(root(null)), 'system')
  assert.equal(shellDefaultTheme(root('auto')), 'system')
})
