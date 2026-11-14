/** The PhoneSheet body chunk (radix dialog), loaded on first open. */
export const loadPhoneSheetBody = () => import('./PhoneSheetBody')

/** Warm the sheet chunk (pointer-enter or focus on the menu button). */
export function preloadPhoneSheet(): void {
  void loadPhoneSheetBody().catch(() => {
    /* retried on open */
  })
}
