// cn(): clsx + tailwind-merge extended with the theme's own scale values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cn } from '@/lib/utils'

test('the theme shadows merge as shadows, not as shadow colours', () => {
  assert.equal(cn('shadow-lg', 'shadow-float'), 'shadow-float')
  assert.equal(cn('shadow-float', 'shadow-overlay'), 'shadow-overlay')
  assert.equal(cn('shadow-float', 'shadow-red-500'), 'shadow-float shadow-red-500', 'a colour does not drop the shadow')
})

test('max-w-reading merges with other max-widths', () => {
  assert.equal(cn('max-w-full', 'max-w-reading'), 'max-w-reading')
  assert.equal(cn('max-w-[760px]', 'max-w-reading'), 'max-w-reading')
  assert.equal(cn('max-w-reading', 'max-w-none'), 'max-w-none')
})

test('stock behaviour is unchanged', () => {
  assert.equal(cn('px-2', 'px-4'), 'px-4')
  assert.equal(cn('text-sm', null, undefined, 'font-medium'), 'text-sm font-medium')
  assert.equal(cn('text-2xs', 'text-xs'), 'text-xs')
})
