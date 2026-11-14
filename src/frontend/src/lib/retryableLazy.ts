/**
 * React.lazy() that can try again. React.lazy caches a rejected import
 * forever, so one failed chunk load (a Wi-Fi drop, a deploy in progress)
 * would break every later mount of that component until a full reload.
 *
 * A failed lazy keeps failing until retryFailedLazies() is called, so the
 * error reaches the nearest error boundary (swapping in a fresh lazy right
 * away would make React re-render into a new import on every rejection and
 * never show the error). The shell's page boundary calls it for Try again
 * and whenever another page mounts; the next render then imports again.
 */
import { createElement, lazy, type ComponentType, type LazyExoticComponent } from 'react'

const failed = new Set<() => void>()

/** Let every lazy whose import failed import again on its next render. */
export function retryFailedLazies(): void {
  const resets = [...failed]
  failed.clear()
  for (const reset of resets) reset()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function retryableLazy<P extends Record<string, any>>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  let current: LazyExoticComponent<ComponentType<P>>
  const reset = () => {
    current = fresh()
  }
  const fresh = () =>
    lazy(() =>
      load().catch((err: unknown) => {
        failed.add(reset)
        throw err
      }),
    )
  current = fresh()
  function RetryableLazy(props: P) {
    return createElement(current, props)
  }
  return RetryableLazy
}
