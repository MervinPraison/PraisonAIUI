/**
 * A and D for the keyboard approval strip (./KeyboardGate). The keys act on
 * the newest open gate, and never while focus is in a text field, a dialog
 * or a menu, or with a modifier held. Pure apart from one window listener,
 * held only while a gate is open.
 */

export type GateAct = (approved: boolean) => void

/** Open keyboard gates, oldest first: the keys go to the last one. */
const gates: { current: GateAct }[] = []

type KeyLike = Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>

const BUSY_TARGET =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** True when a key press belongs to something else (typing, a dialog, a shortcut). */
export function ignoreKey(e: KeyLike): boolean {
  if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return true
  const t = e.target as (Element & { isContentEditable?: boolean }) | null
  if (!t || typeof t.closest !== 'function') return false
  return Boolean(t.isContentEditable) || t.closest(BUSY_TARGET) !== null
}

/** The decision a key asks for: true (A), false (D), or null. */
export function keyDecision(key: string): boolean | null {
  const k = key.toLowerCase()
  return k === 'a' ? true : k === 'd' ? false : null
}

/** Route one key press to the newest gate. Returns true when it was handled. */
export function handleGateKey(e: KeyLike & { preventDefault(): void }): boolean {
  const decision = keyDecision(e.key)
  const top = gates[gates.length - 1]
  if (decision === null || !top || ignoreKey(e)) return false
  e.preventDefault()
  top.current(decision)
  return true
}

function onKey(e: KeyboardEvent) {
  handleGateKey(e)
}

/** Register a gate for the A/D keys while it is mounted. Returns the remover. */
export function holdKeys(act: { current: GateAct }): () => void {
  gates.push(act)
  if (gates.length === 1) window.addEventListener('keydown', onKey)
  return () => {
    const i = gates.indexOf(act)
    if (i < 0) return
    gates.splice(i, 1)
    if (gates.length === 0) window.removeEventListener('keydown', onKey)
  }
}
