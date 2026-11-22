import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/components/ui', 'src/spike', 'dev']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // `inLayoutOnly(Page)` (src/app-pages/shared.tsx) wraps a page component
      // in another component, so `export default inLayoutOnly(Page)` exports a
      // component that Fast Refresh can handle.
      'react-refresh/only-export-components': ['error', { allowConstantExport: true, customHOCs: ['inLayoutOnly'] }],
    },
  },
  {
    // The docs App draws its first-screen icons into its own chunk
    // (virtual:aiui-icons/inline, scripts/lib/lucide-icons.mjs): an icon from
    // lucide-react that the app shell also uses becomes one more request on every
    // docs page. The lazy docs chunks (search, Ask AI, Try it) keep lucide-react:
    // importing the inline icons would make them import from the docs App chunk.
    files: ['src/docs/**/*.{ts,tsx}', 'src/Header.tsx', 'src/Sidebar.tsx', 'src/Toc.tsx'],
    ignores: [
      '**/*.test.{ts,tsx}',
      'src/docs/lucide-icons.d.ts',
      'src/docs/DocsSearch.tsx',
      'src/docs/AskAi.tsx',
      'src/docs/ApiPlayground.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'lucide-react', message: "Import docs icons from 'virtual:aiui-icons/inline'." }] }],
    },
  },
])
