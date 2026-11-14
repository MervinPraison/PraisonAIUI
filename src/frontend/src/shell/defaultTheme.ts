/**
 * The app's colour mode for a viewer with no stored choice: the server puts
 * set_theme(dark_mode=...) / YAML site.theme on <html data-aiui-theme-default>
 * (the inline theme bootstrap reads the same attribute before first paint).
 */
export function shellDefaultTheme(root: HTMLElement = document.documentElement): 'light' | 'dark' | 'system' {
  const v = root.getAttribute('data-aiui-theme-default')
  return v === 'light' || v === 'dark' ? v : 'system'
}
