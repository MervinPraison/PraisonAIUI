// The lazy lucide icon loader (scripts/lib/lucide-icons.mjs, a Vite plugin).
declare module 'virtual:aiui-icons' {
    /** One icon's drawing (`[tag, attrs][]`), or undefined for a name lucide does not have. */
    const loadIcon: (name: string) => Promise<[string, Record<string, string>][] | undefined>
    export default loadIcon
}

// Every lucide-react icon, drawn into the importing chunk (scripts/lib/lucide-icons.mjs).
// The docs App imports its icons from here, never from lucide-react.
declare module 'virtual:aiui-icons/inline' {
    export * from 'lucide-react'
}
