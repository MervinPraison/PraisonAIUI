/**
 * Utility classes on docs pages: `className="…"` (or `class`) on component tags
 * and raw HTML. Only the classes below work. Before the sanitizer runs,
 * `rehypeDocsClasses` renames each allowed class `x` to `aiui:x`; the sanitizer
 * keeps no other class from a page (DOCS_CLASS_RULES), and docs/utilities.css
 * draws exactly these, `!important` so a page's class beats the component's own
 * look. The prefix keeps a page's classes off the site chrome and off the
 * components' inner parts, which use the same utility names.
 *
 * The patterns are mirrored, word for word, in docs/utilities.css
 * (`@source inline`) and compiler/docs_classes.py (`aiui validate` 7022);
 * tests keep the three in step. `{a,b}` expands like a shell brace.
 */
import { DOCS_ALLOWED_ELEMENTS } from '../markdown/docsTags'

/** Element (or `*`) → attribute rules, as the docs <Markdown> takes them (`allowElements`). */
type AllowedElements = Readonly<Record<string, readonly (string | readonly unknown[])[]>>

export const CLASS_PATTERNS: readonly string[] = [
    '{,sm:,md:,lg:}{block,inline-block,inline,flex,inline-flex,grid,hidden}',
    'dark:{block,inline-block,inline,flex,grid,hidden}',
    '{,sm:,md:,lg:}{flex-row,flex-col,grid-cols-1,grid-cols-2,grid-cols-3,grid-cols-4,text-left,text-center,text-right,w-full,w-1/2,w-1/3,w-2/3}',
    '{flex-wrap,flex-1,flex-none,shrink-0,items-start,items-center,items-end,items-baseline,justify-start,justify-center,justify-end,justify-between,self-start,self-center,self-end,col-span-2,col-span-3,col-span-full}',
    '{gap,gap-x,gap-y}-{0,1,2,3,4,6,8}',
    '{m,mx,my,mt,mb,p,px,py,pt,pb}-{0,1,2,3,4,6,8,12}',
    'mx-auto',
    'text-{xs,sm,base,lg,xl,2xl,3xl}',
    'font-{normal,medium,semibold,bold,mono}',
    '{italic,underline,no-underline,uppercase,truncate,whitespace-nowrap,break-words,leading-tight,leading-normal,leading-relaxed,tracking-tight,tracking-wide}',
    'text-{foreground,muted-foreground,primary,primary-foreground,destructive,success,warning,info}',
    'bg-{background,card,muted,accent,primary,secondary}',
    '{border,border-0,border-2,border-t,border-b,border-dashed,border-border,border-primary}',
    'rounded{,-none,-sm,-md,-lg,-xl,-full}',
    '{w-auto,w-fit,w-1/4,w-3/4,h-auto,min-w-0,aspect-video,aspect-square,object-cover,object-contain,overflow-hidden,overflow-x-auto,opacity-50,opacity-75}',
    'max-w-{xs,sm,md,lg,xl,2xl,full,prose}',
]

/** `a{b,c}d{e,f}` → abde, abdf, acde, acdf (no nesting). */
export function expandBraces(pattern: string): string[] {
    const m = /\{([^{}]*)\}/.exec(pattern)
    if (!m) return [pattern]
    const [head, tail] = [pattern.slice(0, m.index), pattern.slice(m.index + m[0].length)]
    return m[1].split(',').flatMap((alt) => expandBraces(head + alt + tail))
}

/** Every class a docs page may use. */
export const DOCS_CLASSES: ReadonlySet<string> = new Set(CLASS_PATTERNS.flatMap(expandBraces))

/** What the sanitizer keeps from a page: renamed utilities only. */
const RENAMED = /^aiui:/

/**
 * Sanitizer rules (Markdown `allowElements`): `className` on any element, renamed
 * utilities only. Elements with their own class rule in the base schema (footnotes,
 * task lists, code languages) keep those classes too; markdown.test.tsx checks
 * the list against the schema.
 */
export const DOCS_CLASS_RULES: Readonly<Record<string, readonly (readonly unknown[])[]>> = {
    '*': [['className', RENAMED]],
    a: [['className', 'data-footnote-backref', RENAMED]],
    code: [['className', /^language-./, RENAMED]],
    h2: [['className', 'sr-only', RENAMED]],
    li: [['className', 'task-list-item', RENAMED]],
    ol: [['className', 'contains-task-list', RENAMED]],
    ul: [['className', 'contains-task-list', RENAMED]],
    section: [['className', 'footnotes', RENAMED]],
    img: [['className', RENAMED]],
}

/** The docs page's sanitizer rules: the component elements and their attributes, plus classes. */
export const DOCS_PAGE_ELEMENTS: AllowedElements = { ...DOCS_ALLOWED_ELEMENTS, ...DOCS_CLASS_RULES }

type HastNode = { type: string; properties?: Record<string, unknown>; children?: HastNode[] }

/** Renames the allowed classes on every element; the sanitizer then drops the rest. */
function renameClasses(node: HastNode) {
    const props = node.properties
    if (props) {
        // `className="…"` written in raw HTML parses as its own attribute.
        const written = [props.className, props.classname].flatMap((v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s+/) : []))
        delete props.classname
        if (written.length) props.className = written.map((c) => (DOCS_CLASSES.has(String(c)) ? `aiui:${c}` : c))
    }
    node.children?.forEach(renameClasses)
}

/** A rehype plugin for the docs <Markdown> (`beforeSanitize`). */
export const rehypeDocsClasses = () => renameClasses

/** A component's own class plus the page's (`className` on its tag, already renamed). */
export const cx = (own: string, page?: string) => (page ? `${own} ${page}` : own)
