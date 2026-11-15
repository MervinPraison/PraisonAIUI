/**
 * Test fixtures for the artifact rules: the "Compare sorting algorithms"
 * conversation of the Chat and Canvas design (Canvas.dc.html), which must
 * yield "Comparison table" v2 and "sort_demo.py" v1. Imported only by tests
 * (never by the app), so it is not in any chunk.
 */
import type { DeriveMessage } from './derive'

export const T0 = Date.UTC(2026, 10, 15, 10, 42)

let seq = 0
export const user = (text: string, at = T0): DeriveMessage => ({ id: `u${++seq}`, role: 'user', createdAt: at, parts: [{ type: 'text', text }] })
export const reply = (text: string, at = T0, extra: Partial<DeriveMessage> = {}): DeriveMessage => ({
  id: `a${++seq}`,
  role: 'assistant',
  createdAt: at,
  completedAt: at + 1000,
  agentName: 'Researcher',
  parts: [{ type: 'text', text }],
  ...extra,
})

export const TABLE_V1 = `**Comparison table**

| Algorithm | Average | Worst |
|---|---|---|
| Quicksort | \`O(n log n)\` | \`O(n²)\` |
| Mergesort | \`O(n log n)\` | \`O(n log n)\` |
| Timsort | \`O(n log n)\` | \`O(n log n)\` |`

export const TABLE_V2 = `**Comparison table**

| Algorithm | Average | Worst | Stable |
|:--|:--|:--|:-:|
| Quicksort | \`O(n log n)\` | \`O(n²)\` | No |
| Mergesort | \`O(n log n)\` | \`O(n log n)\` | Yes |
| Timsort | \`O(n log n)\` | \`O(n log n)\` | Yes |`

export const CODE = `\`\`\`python title="sort_demo.py"
import random

data = [random.randint(0, 99) for _ in range(8)]
result = sorted(data)  # timsort
print(result)
\`\`\``

/** The "Compare sorting algorithms" conversation of the Chat and Canvas design. */
export function sortingConversation(): DeriveMessage[] {
  return [
    user('Compare quicksort, mergesort and timsort, with a code sample'),
    reply(`Here is how the three compare on speed.\n\n${TABLE_V1}\n\nA runnable sample:\n\n${CODE}`, T0 + 60_000),
    user('Add whether each one is stable', T0 + 90_000),
    reply(`I added the Stable column.\n\n${TABLE_V2}\n\n**Recommendation: use \`sorted()\`.**`, T0 + 120_000),
  ]
}

